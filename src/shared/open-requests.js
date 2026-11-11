// @ts-check
// The open requests of a Mailbox, as the text a session reads again after a context reset (design.md §3.13, C129).
// One copy: the shim's open_requests tool and the SessionStart hook (tools/hooks/session-restore.mjs) both call it.
// Pointers only, no bodies. The text goes into the new context as it is, so every value that a sender controls is printed
// only in the shape the Hub produces (anything else is dropped): a newline or a long string cannot add a line.
// The data is the Mailbox as GET /mailboxes returns it; the message lookup is the caller's (a read). No Node APIs.

/** Most requests listed by number in one text. Beyond it the text says how many more are open. */
export const MAX_LISTED = 20

// The shapes the Hub produces (protocol.md §1, src/shared/types.ts, src/hub/ids.ts). Kept here so this file has no imports
/** A message id: m_ and a ULID (26 Crockford base-32 characters). */
const MESSAGE_ID_RE = /^m_[0-9A-HJKMNP-TV-Z]{26}$/
/** A Mailbox, role, topic or user name (the same rule as NAME_RE in src/shared/types.ts). */
const NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/
/** A roadmap item id, the rule the shim applies to meta.item (src/shim/main.ts). */
const ITEM_RE = /^C[1-9][0-9]*$/
/** The address types a message can be sent to, and the sender types. */
const ADDRESS_TYPES = ['mailbox', 'role', 'topic', 'user']
const SENDER_TYPES = ['mailbox', 'user']

/** @param {unknown} v @returns {v is number} */
const isSeq = (v) => Number.isSafeInteger(v) && /** @type {number} */ (v) >= 1

/**
 * Which requests are open for a Mailbox, from its backlog. `owed` is the requests this Mailbox owes a reply to: the count,
 * the oldest seq, and `seqs` (every owed seq, sorted, from `awaitingReply.seqs`; `null` for a Hub without it, which gives
 * only the oldest). `awaiting` is the requests it sent and awaits a reply to, one entry per seq, with the addresses they
 * went to (from `outgoing.to[].seqs`, sorted by seq).
 * @param {any} mailbox
 * @returns {{ owed: { count: number, oldestSeq: number, seqs: number[] | null } | null, awaiting: { seq: number, to: { type: string, id: string }[] }[] }}
 */
export function openRequestsOf(mailbox) {
  const backlog = mailbox && mailbox.backlog ? mailbox.backlog : {}
  const ar = backlog.awaitingReply
  // The Hub's awaitingReply.seqs (C129). Ignored when it is not a list of seqs, or has none while count > 0 (an older Hub)
  const named = ar && Array.isArray(ar.seqs) ? ar.seqs.filter(isSeq).sort((/** @type {number} */ x, /** @type {number} */ y) => x - y) : []
  /** @type {{ count: number, oldestSeq: number, seqs: number[] | null } | null} */
  const owed = ar && Number.isSafeInteger(ar.count) && ar.count > 0 && isSeq(ar.oldestSeq)
    ? { count: ar.count, oldestSeq: ar.oldestSeq, seqs: named.length ? named : null }
    : null

  /** @type {Map<number, { type: string, id: string }[]>} */
  const bySeq = new Map()
  const addresses = (backlog.outgoing && Array.isArray(backlog.outgoing.to)) ? backlog.outgoing.to : []
  for (const a of addresses) {
    // seqs is the seq of each open request for this address (a Hub from C78 on). Without it, only the oldest is known
    const seqs = Array.isArray(a.seqs) ? a.seqs : (isSeq(a.oldestSeq) ? [a.oldestSeq] : [])
    for (const seq of seqs) {
      if (!isSeq(seq)) continue
      const list = bySeq.get(seq) ?? []
      list.push({ type: a.type, id: a.id })
      bySeq.set(seq, list)
    }
  }
  const awaiting = [...bySeq.keys()].sort((x, y) => x - y).map((seq) => ({ seq, to: bySeq.get(seq) ?? [] }))
  return { owed, awaiting }
}

/**
 * The lookup of one message by seq, over GET /messages?after=<seq-1>&limit=1 (read-only). It tells three outcomes apart:
 * `found` (a 2xx answer with that message), `missing` (a 2xx answer without it: the message is gone), and `failed` (the request
 * threw: an error, a timeout, a non-2xx answer, or an answer that is not a message list). A failed read is not a deletion.
 * @param {(path: string) => Promise<unknown>} get
 * @returns {(seq: number) => Promise<{ kind: 'found', message: any } | { kind: 'missing' } | { kind: 'failed' }>}
 */
export function messageLookup(get) {
  return async (seq) => {
    if (!isSeq(seq)) return { kind: 'missing' }
    let r
    try {
      r = await get(`/messages?after=${seq - 1}&limit=1`)
    } catch {
      return { kind: 'failed' }
    }
    const list = r && typeof r === 'object' ? /** @type {any} */ (r).messages : undefined
    if (!Array.isArray(list)) return { kind: 'failed' }
    const m = list[0]
    return m && m.seq === seq ? { kind: 'found', message: m } : { kind: 'missing' }
  }
}

/** @param {unknown} v @returns {string | null} the message id if it has the Hub's shape */
const safeMessageId = (v) => (typeof v === 'string' && MESSAGE_ID_RE.test(v) ? v : null)
/** @param {unknown} v @returns {string | null} the name if it has the Hub's shape */
const safeName = (v) => (typeof v === 'string' && NAME_RE.test(v) ? v : null)
/** @param {any} a @returns {string | null} "type:id" for an address with the Hub's shape */
const safeAddress = (a) => (a && ADDRESS_TYPES.includes(a.type) && safeName(a.id) ? `${a.type}:${a.id}` : null)
/** @param {any} m @returns {string | null} "type:id" for a sender with the Hub's shape */
const safeSender = (m) => (m && m.from && SENDER_TYPES.includes(m.from.type) && safeName(m.from.id) ? `${m.from.type}:${m.from.id}` : null)
/** @param {any} m @returns {string | null} the roadmap item of a message, if it has the shape */
const safeItem = (m) => {
  const id = m && m.meta && m.meta.item ? m.meta.item.id : undefined
  return typeof id === 'string' && ITEM_RE.test(id) ? id : null
}

/**
 * The pointer of one request after its number: `who` (the sender of an owed request, or the addresses of an awaited one),
 * then the id and the item, each only if it has the Hub's shape. A missing or failed read says so instead of the details.
 * @param {any} m a stored message, or undefined
 * @param {'found' | 'missing' | 'failed'} kind what the lookup said
 * @param {string} who
 */
function pointerParts(m, kind, who) {
  if (kind === 'missing') return `${who ? `${who} ` : ''}(the message is no longer in the Hub's history)`
  if (kind === 'failed') return `${who ? `${who} ` : ''}(its message could not be read)`
  const parts = [who]
  const id = safeMessageId(m && m.id)
  if (id) parts.push(`id ${id}`)
  const item = safeItem(m)
  if (item) parts.push(`item ${item}`)
  return parts.filter((p) => p !== '').join(', ')
}

/**
 * The text of the open requests of a Mailbox: a header, then one line per request. Empty when nothing is open.
 * `lookup(seq)` is a messageLookup result (found / missing / failed).
 * Lines: `- owes a reply: #<seq> from <sender>, id <id>, item <C…>` for each owed seq (up to MAX_LISTED; a Hub without
 * `seqs` gives only the oldest, and the rest is counted), and `- awaits a reply: #<seq> to <address>[, <address>], id <id>,
 * item <C…>` for each request sent and still open. Requests past the limit are counted in a line of their own.
 * @param {any} mailbox a Mailbox from GET /mailboxes
 * @param {(seq: number) => Promise<{ kind: 'found', message: any } | { kind: 'missing' } | { kind: 'failed' }>} lookup
 * @returns {Promise<string>}
 */
export async function openRequestsText(mailbox, lookup) {
  const { owed, awaiting } = openRequestsOf(mailbox)
  if (!owed && awaiting.length === 0) return ''
  /** @type {string[]} */
  const lines = []
  let owedListed = 0
  if (owed) {
    // A Hub without seqs names only the oldest; with seqs, every owed request is named, up to the line limit
    const named = owed.seqs ?? [owed.oldestSeq]
    for (const seq of named.slice(0, MAX_LISTED)) {
      const r = await lookup(seq)
      const m = r.kind === 'found' ? r.message : undefined
      const sender = safeSender(m)
      lines.push(`- owes a reply: #${seq} ${pointerParts(m, r.kind, sender ? `from ${sender}` : '')}`)
      owedListed++
    }
    const rest = owed.count - owedListed
    if (rest > 0) {
      if (owed.seqs === null) lines.push(`- owes a reply to ${rest} more request(s), not listed by number (the Hub gives only the oldest)`)
      else lines.push(`- owes a reply to ${rest} more request(s), not listed by number${owed.seqs.length < owed.count ? ` (the Hub gives the numbers of ${owed.seqs.length} only)` : ''}`)
    }
  }
  const room = Math.max(0, MAX_LISTED - owedListed)
  for (const a of awaiting.slice(0, room)) {
    const r = await lookup(a.seq)
    const m = r.kind === 'found' ? r.message : undefined
    const addresses = a.to.map(safeAddress).filter((s) => s !== null)
    const who = `to ${addresses.length ? addresses.join(', ') : 'an address that is not shown'}`
    lines.push(`- awaits a reply: #${a.seq} ${pointerParts(m, r.kind, who)}`)
  }
  if (awaiting.length > room) lines.push(`- awaits a reply to ${awaiting.length - room} more request(s), not listed (more than ${MAX_LISTED} lines)`)
  const name = safeName(mailbox && mailbox.name)
  const header = name ? `Open requests of Mailbox "${name}" in agent-hub (pointers only; the bodies are not included):` : 'Open requests of this Mailbox in agent-hub (pointers only; the bodies are not included):'
  return [header, ...lines].join('\n')
}
