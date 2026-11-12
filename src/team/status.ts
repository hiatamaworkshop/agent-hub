// `npm run team -- status --project <dir>` (roadmap C108): what the Hub says about a project's Mailboxes, and its newest report to the human.
// `status --item C<n>` (C139) prints that item's thread, and plain `status` adds the items with a request in flight and whether the ledger
// changed after the index the Hub holds was sent. All of it is read from GET /mailboxes, GET /messages and GET /indexes; nothing is posted and no cursor moves.
// It does not derive the card states again: those are made in the page (cardState in public/index.html), so this prints what they are derived from.
// The connection is the same as docs:index's: HUB_URL, else HUB_PORT on 127.0.0.1, and HUB_TOKEN (the environment, else agent-hub's .env).
// The ledger is compared on the host, where status runs: the Hub does not read the working tree (design.md §3.8).
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { envOverrides, overrideWarning, refusedTokenMessage, tokenFromEnvironment } from '../shared/env-override.js'
import { normalizeProjectPath } from '../shared/types.js'
import { quoteForPlatform } from './quote.js'
import { envSetting, ROOT } from './env.js'

export interface StatusAddress { type: string; id: string; count?: number; oldestSeq?: number | null; seqs?: number[] }
export interface StatusMailbox {
  name: string
  role: string | null
  project: string | null
  attachment?: unknown
  unread?: number
  unconfirmed?: number
  backlog?: {
    awaitingReply?: { count: number; oldestSeq: number | null; seqs?: number[] }
    outgoing?: { count: number; to?: StatusAddress[] }
    unconfirmed?: { count: number }
    lastEvent?: { kind: string; ts: string } | null
  }
}
export interface StatusMessage {
  id: string
  seq: number
  ts: string
  kind: string
  from: { type: string; id: string }
  to: { type: string; id: string }
  body: string
  replyTo?: string | null
  meta?: Record<string, unknown> | null
}
// One entry of GET /indexes (protocol.md §3): the index the Hub holds for a ledger of a project, and when it was received
export interface StatusIndex { project: string; source: string; updatedAt: string }

// A Mailbox belongs to a project when its last attach came from that folder (the same comparison as the page and projectChanged, C72, C103)
export function inProject(mb: StatusMailbox, projectDir: string): boolean {
  return mb.project !== null && mb.project !== undefined && normalizeProjectPath(mb.project) === normalizeProjectPath(projectDir)
}

// One line for a Mailbox: name, role, connected or not, unread, awaiting reply, outgoing with its targets, handed but unconfirmed, the last Event
export function mailboxLine(mb: StatusMailbox): string {
  const b = mb.backlog ?? {}
  const aw = b.awaitingReply
  const awaiting = aw ? `awaiting reply ${aw.count}${aw.count > 0 && aw.oldestSeq !== null && aw.oldestSeq !== undefined ? ` (oldest #${aw.oldestSeq})` : ''}` : 'awaiting reply ?'
  const out = b.outgoing
  const targets = (out?.to ?? []).map((a) => `${a.type}:${a.id} (${a.count ?? 0})`)
  const outgoing = `outgoing ${out?.count ?? 0}${targets.length ? ` → ${targets.join(', ')}` : ''}`
  const unconfirmed = `handed unconfirmed ${b.unconfirmed?.count ?? mb.unconfirmed ?? 0}`
  const last = b.lastEvent ? `last event ${b.lastEvent.kind} at ${b.lastEvent.ts}` : 'last event none'
  return [mb.name, mb.role ?? 'no role', mb.attachment ? 'connected' : 'not connected', `unread ${mb.unread ?? 0}`, awaiting, outgoing, unconfirmed, last].join(' · ')
}

// The newer of two Messages, when the message is a report to the human from one of the project's Mailboxes (names). Pure
export function pickReport(best: StatusMessage | null, m: StatusMessage, names: ReadonlySet<string>): StatusMessage | null {
  const ours = m.from.type === 'mailbox' && names.has(m.from.id) && m.to.type === 'user'
  if (!ours) return best
  return !best || m.seq > best.seq ? m : best
}

// meta.item (set by the UI or the shim on a request built from a roadmap item, protocol.md §2). Only a string id counts
export interface ItemRef { id: string; project: string | null }
export function itemOf(m: StatusMessage): ItemRef | null {
  const it = m.meta?.item
  if (typeof it !== 'object' || it === null) return null
  const { id, project } = it as { id?: unknown; project?: unknown }
  if (typeof id !== 'string') return null
  return { id, project: typeof project === 'string' ? project : null }
}

// The item belongs to this project when its meta.item.project is the same folder. An item without a project matches nothing
function itemInProject(ref: ItemRef, projectDir: string): boolean {
  return ref.project !== null && normalizeProjectPath(ref.project) === normalizeProjectPath(projectDir)
}

const addr = (a: { type: string; id: string }): string => `${a.type}:${a.id}`
const firstLine = (body: string): string => body.split(/\r?\n/)[0] ?? ''

// `status --item C<n>` (C139): the requests carrying meta.item C<n> of this project, and the replies under them (replyTo), in seq order.
// Each line: seq, kind, sender, addressee and the first line of the body. A reply is indented under its request. Pure; messages are oldest first
export function itemThreadLines(messages: StatusMessage[], item: string, projectDir: string): string[] {
  const requestIds = new Set<string>()
  const picked: StatusMessage[] = []
  for (const m of messages) {
    if (m.kind === 'request') {
      const ref = itemOf(m)
      if (ref && ref.id === item && itemInProject(ref, projectDir)) {
        requestIds.add(m.id)
        picked.push(m)
      }
    } else if (m.kind === 'reply' && m.replyTo && requestIds.has(m.replyTo)) {
      picked.push(m)
    }
  }
  if (picked.length === 0) return [`No message carries meta.item ${item} for this project (${projectDir}).`]
  const requests = picked.filter((m) => m.kind === 'request').length
  const lines = [`${item} in ${projectDir}: ${requests} request${requests === 1 ? '' : 's'}, ${picked.length - requests} repl${picked.length - requests === 1 ? 'y' : 'ies'}`]
  for (const m of picked.sort((a, b) => a.seq - b.seq)) {
    lines.push(`${m.kind === 'reply' ? '  ' : ''}#${m.seq} ${m.kind} ${addr(m.from)} → ${addr(m.to)}: ${firstLine(m.body)}`)
  }
  return lines
}

// Plain `status` (C139): one line per item that has a request in flight, naming the holder of every in-flight request of the item (with its seqs) and when the oldest one was sent.
// In flight means the Hub counts it as awaiting a reply: a Mailbox owes it (backlog.awaitingReply.seqs, C129) or its sender waits on it (outgoing.to[].seqs).
// `requests` are the requests carrying meta.item (any project; the project is checked here). Pure
export function itemsInFlightLines(requests: StatusMessage[], mailboxes: StatusMailbox[], projectDir: string): string[] {
  const owed = new Map<number, string[]>()
  const sent = new Set<number>()
  let anySeqs = false
  for (const mb of mailboxes) {
    const seqs = mb.backlog?.awaitingReply?.seqs
    if (Array.isArray(seqs)) {
      anySeqs = true
      for (const s of seqs) owed.set(s, [...(owed.get(s) ?? []), mb.name])
    }
    for (const to of mb.backlog?.outgoing?.to ?? []) for (const s of to.seqs ?? []) sent.add(s)
  }
  // Every in-flight request of an item, oldest first. Each holder is named once, with the seqs it holds (a Mailbox that owes two requests of
  // the item appears once); a request nobody owes is held by its addressee
  const inFlight = requests
    .filter((m) => {
      const ref = itemOf(m)
      return ref !== null && itemInProject(ref, projectDir) && (owed.has(m.seq) || sent.has(m.seq))
    })
    .sort((a, b) => a.seq - b.seq)
  const byItem = new Map<string, { oldest: StatusMessage; holders: Map<string, number[]>; count: number }>()
  for (const m of inFlight) {
    const id = itemOf(m)!.id
    const cur = byItem.get(id) ?? { oldest: m, holders: new Map<string, number[]>(), count: 0 }
    cur.count += 1
    const names = (owed.get(m.seq) ?? []).map((n) => `mailbox:${n}`)
    for (const h of names.length ? names : [addr(m.to)]) cur.holders.set(h, [...(cur.holders.get(h) ?? []), m.seq])
    byItem.set(id, cur)
  }
  if (byItem.size === 0) {
    // With no Hub that gives seqs (before C129) the in-flight state cannot be read, and that is said rather than shown as "none"
    const hasItemRequest = requests.some((m) => itemOf(m) !== null && itemInProject(itemOf(m)!, projectDir))
    if (hasItemRequest && !anySeqs) return ['The items with a request in flight cannot be read: this Hub does not return awaitingReply.seqs (C129).']
    return ['No item has a request in flight.']
  }
  return [...byItem.entries()]
    .sort((a, b) => a[1].oldest.seq - b[1].oldest.seq)
    .map(([id, v]) => {
      const held = [...v.holders].map(([h, seqs]) => `${h} (${seqs.map((s) => `#${s}`).join(', ')})`).join(', ')
      return `${id} · held by ${held} · waiting since ${v.oldest.ts} (#${v.oldest.seq})${v.count > 1 ? ` · ${v.count} requests in flight` : ''}`
    })
}

// The command that sends a ledger's index again (docs:index, run from agent-hub, with the project and the file named), quoted for the platform
export function docsIndexCommand(projectDir: string, source?: string): string {
  const style = process.platform === 'win32' ? 'powershell' : 'posix'
  const file = source === undefined ? '' : ` --file ${quoteForPlatform(source, style)}`
  return `npm --prefix ${quoteForPlatform(ROOT, style)} run docs:index -- --project ${quoteForPlatform(projectDir, style)}${file}`
}

// For each ledger index the Hub holds for this project: whether the ledger file changed after the index was received (C138, the index's updatedAt).
// `mtimeOf` gives the file's modification time, or null when the file is not there (injected for tests). Pure apart from that call
export function ledgerIndexLines(indexes: StatusIndex[], projectDir: string, mtimeOf: (path: string) => Date | null): string[] {
  const mine = indexes.filter((ix) => normalizeProjectPath(ix.project) === normalizeProjectPath(projectDir))
  if (mine.length === 0) return [`No ledger index of this project is on the Hub. Send it with: ${docsIndexCommand(projectDir)}`]
  const lines: string[] = []
  for (const ix of mine) {
    const mtime = mtimeOf(join(projectDir, ix.source))
    if (!mtime) {
      lines.push(`${ix.source}: not in ${projectDir}, so it is not compared with the index sent at ${ix.updatedAt}`)
    } else if (mtime.getTime() > Date.parse(ix.updatedAt)) {
      lines.push(`${ix.source} changed at ${mtime.toISOString()}, after the index the Hub holds was sent at ${ix.updatedAt}. Send it again: ${docsIndexCommand(projectDir, ix.source)}`)
    } else {
      lines.push(`${ix.source}: not changed since the index was sent at ${ix.updatedAt}`)
    }
  }
  return lines
}

// tokenFromEnv: the token came from the environment (C119), so a refusal says so
export interface HubConn { hubUrl: string; token: string; tokenFromEnv?: boolean }
export interface StatusResult { code: number; lines: string[] }
export type MtimeOf = (path: string) => Date | null

const defaultMtimeOf: MtimeOf = (p) => {
  try {
    return statSync(p).mtime
  } catch {
    return null
  }
}

export type Get = (path: string) => Promise<{ ok: true; json: unknown } | { ok: false; reason: string }>

// GET against the Hub with the token. Every reader of the status goes through it, so each one fails the same way (one line of reason).
// Exported for `reports` (C135), which reads the same way
export function hubGet(conn: HubConn, fetchFn: typeof fetch): Get {
  return async (path) => {
    let res: Response
    try {
      res = await fetchFn(`${conn.hubUrl}${path}`, { headers: { authorization: `Bearer ${conn.token}` }, signal: AbortSignal.timeout(5000) })
    } catch (e) {
      return { ok: false, reason: `Hub not reachable (${conn.hubUrl}): ${e instanceof Error ? e.message : String(e)}` }
    }
    if (res.status === 401) return { ok: false, reason: refusedTokenMessage(!!conn.tokenFromEnv) }
    if (!res.ok) return { ok: false, reason: `the Hub answered ${res.status} for ${path}` }
    return { ok: true, json: await res.json() }
  }
}

// GET /messages is oldest first, in pages of 1000; visit each Message. Returns the reason when a page cannot be read
async function eachMessage(get: Get, visit: (m: StatusMessage) => void): Promise<string | null> {
  let after = 0
  for (;;) {
    const page = await get(`/messages?after=${after}&limit=1000`)
    if (!page.ok) return page.reason
    const messages = (page.json as { messages: StatusMessage[] }).messages
    for (const m of messages) visit(m)
    if (messages.length < 1000) return null
    after = messages[messages.length - 1]!.seq
  }
}

// Reads the Hub and returns what to print. code 0 when read; 1 with one line of reason when the Hub cannot be read or refuses the token
export async function readStatus(projectDir: string, conn: HubConn, fetchFn: typeof fetch = fetch, mtimeOf: MtimeOf = defaultMtimeOf): Promise<StatusResult> {
  if (!conn.token) return { code: 1, lines: ['HUB_TOKEN is not set (the environment or agent-hub\'s .env), so the Hub cannot be read'] }
  const get = hubGet(conn, fetchFn)
  const list = await get('/mailboxes')
  if (!list.ok) return { code: 1, lines: [list.reason] }
  const all = (list.json as { mailboxes: StatusMailbox[] }).mailboxes ?? []
  const mine = all.filter((m) => inProject(m, projectDir))
  const names = new Set(mine.map((m) => m.name))
  const lines = [`Project ${projectDir}: ${mine.length} Mailbox${mine.length === 1 ? '' : 'es'} on the Hub`]
  if (!mine.length) lines.push('No Mailbox of this project is on the Hub.')
  for (const m of mine) lines.push(mailboxLine(m))
  let best: StatusMessage | null = null
  const itemRequests: StatusMessage[] = []
  const failed = await eachMessage(get, (m) => {
    best = pickReport(best, m, names)
    if (m.kind === 'request' && itemOf(m)) itemRequests.push(m)
  })
  if (failed) return { code: 1, lines: [...lines, failed] }
  if (!best) lines.push('No report to the human from a Mailbox of this project yet.')
  else {
    const report = best as StatusMessage
    lines.push(`Latest report to the human: #${report.seq} from ${report.from.type}:${report.from.id} at ${report.ts}`, report.body)
  }
  const idx = await get('/indexes')
  if (!idx.ok) return { code: 1, lines: [...lines, idx.reason] }
  lines.push(...itemsInFlightLines(itemRequests, all, projectDir))
  lines.push(...ledgerIndexLines((idx.json as { indexes: StatusIndex[] }).indexes ?? [], projectDir, mtimeOf))
  return { code: 0, lines }
}

// `status --item C<n>` (C139): the item's thread in this project, read from GET /messages. Pure reading; posts nothing
export async function readItemThread(projectDir: string, item: string, conn: HubConn, fetchFn: typeof fetch = fetch): Promise<StatusResult> {
  if (!conn.token) return { code: 1, lines: ['HUB_TOKEN is not set (the environment or agent-hub\'s .env), so the Hub cannot be read'] }
  const get = hubGet(conn, fetchFn)
  // Requests with an item and every reply can be the thread; the replies are kept only when they answer one of those requests
  const relevant: StatusMessage[] = []
  const failed = await eachMessage(get, (m) => {
    if ((m.kind === 'request' && itemOf(m) !== null) || (m.kind === 'reply' && m.replyTo)) relevant.push(m)
  })
  if (failed) return { code: 1, lines: [failed] }
  return { code: 0, lines: itemThreadLines(relevant, item, projectDir) }
}

// The command the team start's summary names (C108), quoted for the platform as hookWarning quotes its command
export function statusCommand(projectDir: string): string {
  return `npm run team -- status --project ${quoteForPlatform(projectDir, process.platform === 'win32' ? 'powershell' : 'posix')}`
}

// `team status`: the Hub from the environment or agent-hub's .env, as docs:index reads it. Prints to stdout, errors to stderr.
// With `item` (C<n>), prints that item's thread only
export async function runStatus(projectDir: string, root = ROOT, item?: string): Promise<number> {
  const port = envSetting('HUB_PORT', '7777', root)
  const hubUrl = (envSetting('HUB_URL', '', root) || `http://127.0.0.1:${port}`).replace(/\/+$/, '')
  // A variable in this terminal that overrides agent-hub's .env (C119): one warning each, names only
  for (const name of envOverrides(root)) console.error(`WARNING: ${overrideWarning(name)}`)
  const conn = { hubUrl, token: envSetting('HUB_TOKEN', '', root), tokenFromEnv: tokenFromEnvironment() }
  const r = item === undefined ? await readStatus(projectDir, conn) : await readItemThread(projectDir, item, conn)
  for (const line of r.lines) {
    if (r.code) console.error(line)
    else console.log(line)
  }
  return r.code
}
