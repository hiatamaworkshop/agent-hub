// `npm run team -- reports --follow --project <dir>` (roadmap C135): prints the reports the project's Mailboxes send to the human, as they arrive.
// A report is a Message to user:browser whose sender is a Mailbox of the project (the Mailbox's project, as GET /mailboxes gives it).
// It only reads: GET /mailboxes, GET /messages and GET /stream. It posts nothing and moves no cursor, so no Mailbox's unread state changes.
// The planning session is not a Hub role (design.md §3.15). This is a plain reader that any agent or tool can run in the background;
// team start, the hooks and the shim never start it (opt-in, usage.md).
// Order of reading: the stream is answered first (the Hub subscribes before it answers), then the history after the last seq printed.
// A Message that arrives in between is in one of the two, so none is missed. A Message already printed is skipped by its seq,
// so a reconnect prints no duplicates.
import { envOverrides, overrideWarning, refusedTokenMessage, tokenFromEnvironment } from '../shared/env-override.js'
import { envSetting, ROOT } from './env.js'
import { hubGet, inProject, itemOf, type HubConn, type StatusMailbox, type StatusMessage } from './status.js'

export interface ReportsOptions {
  projectDir: string
  conn: HubConn
  // --json: one line per report, the Message as GET /messages returns it
  json: boolean
  // --since: print the reports after this seq first; 0 (the default) is the whole history
  since?: number
  fetchFn?: typeof fetch
  out?: (line: string) => void
  err?: (line: string) => void
  // Stops the command (the caller's Ctrl-C or a test)
  signal?: AbortSignal
  // Wait before reconnecting after the stream ends or fails (default 2 seconds)
  retryMs?: number
  // A stream with no bytes for this long is taken as lost. The Hub sends a comment every 30 seconds (app.ts), so 90 seconds is three of them
  idleMs?: number
}

const ITEM_ID = /^C[1-9][0-9]*$/
const addr = (a: { type: string; id: string }): string => `${a.type}:${a.id}`
const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// A Message the reader is about: from a Mailbox, to the human (user:browser). Whether the Mailbox belongs to the project is decided by the caller. Pure
export function isReportCandidate(m: StatusMessage): boolean {
  return m.from.type === 'mailbox' && m.to.type === 'user' && m.to.id === 'browser'
}

// The header line of a report: #seq, the sender, kind, the item (only when its id has the shape C<n>), and the time. Pure
export function reportHeader(m: StatusMessage): string {
  const id = itemOf(m)?.id
  const item = id !== undefined && ITEM_ID.test(id) ? ` item ${id}` : ''
  return `#${m.seq} ${addr(m.from)} ${m.kind}${item} ${m.ts}`
}

// The prefix of every body line in text mode (C135, changed by C165). Two spaces, a visible mark, and a space: `  | `. The header is the
// only line without it. A view that strips leading whitespace still shows the mark, so a body line cannot read as a header; a blank
// body line is `  | ` (trailing space; a view that trims it still shows `  |`)
export const BODY_PREFIX = '  | '

// Control characters that a terminal acts on (C135, the second review finding): C0 except tab, \n and \r (which split lines), DEL,
// C1 (incl. NEL U+0085), and the line and paragraph separators U+2028 / U+2029. Each is shown as \uXXXX (lower-case hex), so ESC
// cannot move the cursor and a backspace cannot overwrite the indent. A body with a literal backslash-u text reads the same as an escape
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/g
export function escapeControl(s: string): string {
  return s.replace(CONTROL, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

// The lines printed for one report. Text mode: the header at column 0, then every body line with BODY_PREFIX (blank lines too). The body's
// content is not changed, only split on its line breaks (\n, \r\n, and a lone \r, which a terminal also breaks on) and escaped (escapeControl)
// before the prefix is added. Every body line starts with the prefix, so a body line that itself starts with `| ` is `  | | …` and cannot
// start a report. With --json: one line, the Message as GET /messages returns it. Pure
export function reportLines(m: StatusMessage, json: boolean): string[] {
  if (json) return [JSON.stringify(m)]
  return [escapeControl(reportHeader(m)), ...m.body.split(/\r\n|\r|\n/).map((line) => BODY_PREFIX + escapeControl(line))]
}

// The data of one SSE `message` event, as a Message, or null when it is not one
function parseMessage(data: string): StatusMessage | null {
  let v: unknown
  try {
    v = JSON.parse(data)
  } catch {
    return null
  }
  if (typeof v !== 'object' || v === null) return null
  const m = v as Partial<StatusMessage>
  if (typeof m.seq !== 'number' || typeof m.from !== 'object' || m.from === null || typeof m.to !== 'object' || m.to === null) return null
  return m as StatusMessage
}

// Rejects when nothing arrives for `ms`. Each read gets its own timer, so a stream that stays open but silent is taken as lost
function withIdle<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const idle = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no data for ${ms / 1000} seconds`)), ms)
  })
  return Promise.race([p, idle]).finally(() => clearTimeout(timer))
}

// Reads the SSE body and hands each `message` event to `visit`. Returns why it stopped (the stream ended, broke, or visit gave a reason)
async function readEvents(body: ReadableStream<Uint8Array>, visit: (m: StatusMessage) => Promise<string | null>, idleMs: number): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let event = 'message'
  let data: string[] = []
  try {
    for (;;) {
      const r = await withIdle(reader.read(), idleMs)
      if (r.done) return 'the stream ended'
      buf += decoder.decode(r.value, { stream: true })
      for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
        const line = buf.slice(0, nl).replace(/\r$/, '')
        buf = buf.slice(nl + 1)
        if (line === '') {
          // A blank line ends an event. Comments (": ping") and other fields are ignored
          const isMessage = event === 'message' && data.length > 0
          const payload = data.join('\n')
          event = 'message'
          data = []
          if (isMessage) {
            const m = parseMessage(payload)
            if (m) {
              const reason = await visit(m)
              if (reason) return reason
            }
          }
        } else if (line.startsWith('event:')) {
          event = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''))
        }
      }
    }
  } catch (e) {
    return `the stream broke: ${msgOf(e)}`
  } finally {
    reader.cancel().catch(() => {})
  }
}

// Follows the Hub's reports for the project until `signal` stops it. Returns 0 when stopped; 1 with one line when the Hub cannot be reached or refuses the token at start
export async function followReports(o: ReportsOptions): Promise<number> {
  const fetchFn = o.fetchFn ?? fetch
  const out = o.out ?? ((l: string) => console.log(l))
  const err = o.err ?? ((l: string) => console.error(l))
  const retryMs = o.retryMs ?? 2000
  const idleMs = o.idleMs ?? 90_000
  const get = hubGet(o.conn, fetchFn)
  let last = o.since ?? 0
  let started = false
  let names = new Set<string>()

  const stopped = () => o.signal?.aborted === true

  // The Mailboxes whose project is this folder, from GET /mailboxes
  const refresh = async (): Promise<string | null> => {
    const r = await get('/mailboxes')
    if (!r.ok) return r.reason
    const list = (r.json as { mailboxes: StatusMailbox[] }).mailboxes
    names = new Set(list.filter((mb) => inProject(mb, o.projectDir)).map((mb) => mb.name))
    return null
  }

  // One Message, in seq order. A Message from a Mailbox this reader has not seen yet makes it ask GET /mailboxes again.
  // A reason returns without moving the cursor, so the Message is read again after the reconnect
  const visit = async (m: StatusMessage): Promise<string | null> => {
    if (m.seq <= last) return null
    const candidate = isReportCandidate(m)
    if (candidate && !names.has(m.from.id)) {
      const reason = await refresh()
      if (reason) return reason
    }
    last = m.seq
    if (candidate && names.has(m.from.id)) for (const line of reportLines(m, o.json)) out(line)
    return null
  }

  // The history after the last seq printed, page by page (GET /messages is oldest first)
  const catchUp = async (): Promise<string | null> => {
    for (;;) {
      const r = await get(`/messages?after=${last}&limit=1000`)
      if (!r.ok) return r.reason
      const page = (r.json as { messages: StatusMessage[] }).messages
      for (const m of page) {
        const reason = await visit(m)
        if (reason) return reason
      }
      if (page.length < 1000) return null
    }
  }

  // One connection to /stream, then the history, then the live events. Returns why it ended, always as one line
  const connectOnce = async (): Promise<string> => {
    const ac = new AbortController()
    const stop = () => ac.abort()
    o.signal?.addEventListener('abort', stop, { once: true })
    try {
      let res: Response
      try {
        res = await fetchFn(`${o.conn.hubUrl}/stream`, { headers: { authorization: `Bearer ${o.conn.token}`, accept: 'text/event-stream' }, signal: ac.signal })
      } catch (e) {
        return `Hub not reachable (${o.conn.hubUrl}): ${msgOf(e)}`
      }
      if (res.status === 401) return refusedTokenMessage(!!o.conn.tokenFromEnv)
      if (!res.ok || !res.body) return `the Hub answered ${res.status} for /stream`
      const reason = await catchUp()
      if (reason) return reason
      started = true
      return await readEvents(res.body, visit, idleMs)
    } finally {
      o.signal?.removeEventListener('abort', stop)
      ac.abort()
    }
  }

  const first = await refresh()
  if (first) {
    err(first)
    return 1
  }
  for (;;) {
    const reason = await connectOnce()
    if (stopped()) return 0
    if (!started) {
      err(reason)
      return 1
    }
    err(`reports: ${reason}; reconnecting after #${last}`)
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, retryMs)
      o.signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
    })
    if (stopped()) return 0
  }
}

// `reports` from the command line: the Hub's address and token the same way as `status` (C108, C139)
export async function runReports(projectDir: string, root = ROOT, opts: { json: boolean; since?: number }): Promise<number> {
  const port = envSetting('HUB_PORT', '7777', root)
  const hubUrl = (envSetting('HUB_URL', '', root) || `http://127.0.0.1:${port}`).replace(/\/+$/, '')
  for (const name of envOverrides(root)) console.error(`WARNING: ${overrideWarning(name)}`)
  const conn = { hubUrl, token: envSetting('HUB_TOKEN', '', root), tokenFromEnv: tokenFromEnvironment() }
  return followReports({ projectDir, conn, json: opts.json, since: opts.since })
}
