// `npm run team -- status --project <dir>` (roadmap C108): what the Hub says about a project's Mailboxes, and its newest report to the human.
// It reads the Hub's delivery facts (GET /mailboxes and GET /messages) and prints them. It does not derive the card states again: those are
// made in the page (cardState in public/index.html), so this prints what they are derived from.
// The connection is the same as docs:index's: HUB_URL, else HUB_PORT on 127.0.0.1, and HUB_TOKEN (the environment, else agent-hub's .env).
import { normalizeProjectPath } from '../shared/types.js'
import { quoteForPlatform } from './quote.js'
import { envSetting, ROOT } from './env.js'

export interface StatusAddress { type: string; id: string; count?: number; oldestSeq?: number | null }
export interface StatusMailbox {
  name: string
  role: string | null
  project: string | null
  attachment?: unknown
  unread?: number
  unconfirmed?: number
  backlog?: {
    awaitingReply?: { count: number; oldestSeq: number | null }
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
}

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

export interface HubConn { hubUrl: string; token: string }
export interface StatusResult { code: number; lines: string[] }

// Reads the Hub and returns what to print. code 0 when read; 1 with one line of reason when the Hub cannot be read or refuses the token
export async function readStatus(projectDir: string, conn: HubConn, fetchFn: typeof fetch = fetch): Promise<StatusResult> {
  if (!conn.token) return { code: 1, lines: ['HUB_TOKEN is not set (the environment or agent-hub\'s .env), so the Hub cannot be read'] }
  const get = async (path: string): Promise<{ ok: true; json: unknown } | { ok: false; reason: string }> => {
    let res: Response
    try {
      res = await fetchFn(`${conn.hubUrl}${path}`, { headers: { authorization: `Bearer ${conn.token}` }, signal: AbortSignal.timeout(5000) })
    } catch (e) {
      return { ok: false, reason: `Hub not reachable (${conn.hubUrl}): ${e instanceof Error ? e.message : String(e)}` }
    }
    if (res.status === 401) return { ok: false, reason: 'the Hub refused the token (HUB_TOKEN in agent-hub\'s .env)' }
    if (!res.ok) return { ok: false, reason: `the Hub answered ${res.status} for ${path}` }
    return { ok: true, json: await res.json() }
  }
  const list = await get('/mailboxes')
  if (!list.ok) return { code: 1, lines: [list.reason] }
  const mine = ((list.json as { mailboxes: StatusMailbox[] }).mailboxes ?? []).filter((m) => inProject(m, projectDir))
  const names = new Set(mine.map((m) => m.name))
  const lines = [`Project ${projectDir}: ${mine.length} Mailbox${mine.length === 1 ? '' : 'es'} on the Hub`]
  if (!mine.length) lines.push('No Mailbox of this project is on the Hub.')
  for (const m of mine) lines.push(mailboxLine(m))
  // GET /messages is oldest first, in pages; keep only the newest report
  let best: StatusMessage | null = null
  let after = 0
  for (;;) {
    const page = await get(`/messages?after=${after}&limit=1000`)
    if (!page.ok) return { code: 1, lines: [...lines, page.reason] }
    const messages = (page.json as { messages: StatusMessage[] }).messages
    for (const m of messages) best = pickReport(best, m, names)
    if (messages.length < 1000) break
    after = messages[messages.length - 1]!.seq
  }
  if (!best) lines.push('No report to the human from a Mailbox of this project yet.')
  else lines.push(`Latest report to the human: #${best.seq} from ${best.from.type}:${best.from.id} at ${best.ts}`, best.body)
  return { code: 0, lines }
}

// The command the team start's summary names (C108), quoted for the platform as hookWarning quotes its command
export function statusCommand(projectDir: string): string {
  return `npm run team -- status --project ${quoteForPlatform(projectDir, process.platform === 'win32' ? 'powershell' : 'posix')}`
}

// `team status`: the Hub from the environment or agent-hub's .env, as docs:index reads it. Prints to stdout, errors to stderr
export async function runStatus(projectDir: string, root = ROOT): Promise<number> {
  const port = envSetting('HUB_PORT', '7777', root)
  const hubUrl = (envSetting('HUB_URL', '', root) || `http://127.0.0.1:${port}`).replace(/\/+$/, '')
  const r = await readStatus(projectDir, { hubUrl, token: envSetting('HUB_TOKEN', '', root) })
  for (const line of r.lines) {
    if (r.code) console.error(line)
    else console.log(line)
  }
  return r.code
}
