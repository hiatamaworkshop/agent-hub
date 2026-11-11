// Sends a project's roadmap index to the Hub (PUT /indexes, design.md §3.15). Used by `npm run docs:index` and by team start (C107).
// It never throws: a failure comes back as { sent: false, reason }, so a start or a commit is not stopped by it.
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join, relative } from 'node:path'
import { refusedTokenMessage } from '../shared/env-override.js'
import { checkRoadmap, parseRoadmap } from '../shared/roadmap.js'
import { normalizeProjectPath } from '../shared/types.js'

export interface SendOptions {
  project: string
  source: string
  hubUrl: string
  token: string
  // the token came from the environment, so a refusal says so (C119)
  tokenFromEnv?: boolean
  // the name a path really has on disk (C131). Injectable, so a test can simulate a case-insensitive disk without making one
  realPath?: (path: string) => string
}

export type SendResult =
  | { sent: true; source: string; items: number; warnings: string[] }
  | { sent: false; source: string; reason: string }

// The name the file really has, when it differs from the configured one only by letter case. On Windows and macOS the default
// docs/roadmap.md opens docs/ROADMAP.md (C131). Undefined when the names match, or when they differ in more than case (e.g. a missing file)
export function caseOnlyRealName(o: { project: string; source: string }, realPath: (p: string) => string = realpathSync.native): string | undefined {
  let real: string
  try {
    real = realPath(join(o.project, o.source))
  } catch {
    return undefined
  }
  let root = o.project
  try {
    root = realPath(o.project)
  } catch {
    // the project folder did not resolve: compare against the folder as configured
  }
  const rel = relative(root, real).replace(/\\/g, '/')
  if (rel === o.source || rel.toLowerCase() !== o.source.toLowerCase()) return undefined
  return rel
}

export async function sendLedgerIndex(o: SendOptions): Promise<SendResult> {
  const path = join(o.project, o.source)
  if (!existsSync(path)) return { sent: false, source: o.source, reason: `${o.source} does not exist in ${o.project}` }
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (e) {
    return { sent: false, source: o.source, reason: `${path} cannot be read: ${(e as Error).message}` }
  }
  // 規則の崩れは知らせるが、送るのは止めない (崩れた項目も索引には出したほうが直しやすい)
  const warnings = checkRoadmap(text).filter((p) => p.level === 'error').map((p) => `${path}:${p.line}: ${p.message}`)
  // 予定の並びと閉じた行も送る (Hub は作業ツリーを読まない。design.md §3.15)
  const { items, plan, closed } = parseRoadmap(text)
  // A ledger with no items is sent only to clear an index of the same file the Hub already holds. Otherwise it is most likely
  // the default file of a project whose ledger is elsewhere, and sending it would put an empty index beside the real one (2026-11-02, cairn)
  if (items.length === 0 && !(await hubHolds(o))) {
    // A file that differs from the configured name only by letter case is named, so the reason says which file was read (C131)
    const real = caseOnlyRealName(o, o.realPath)
    const opened = real ? `${o.source} opened ${real} (letter case differs), which` : o.source
    return { sent: false, source: o.source, reason: `${opened} has no \`### C<n>.\` items, so nothing was sent. If the ledger is another file, name it in .agent-hub.json ({ "ledger": "docs/items.md" })` }
  }
  let res: Response
  try {
    res = await fetch(`${o.hubUrl}/indexes`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${o.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ project: o.project, source: o.source, items, plan, closed }),
      signal: AbortSignal.timeout(5000),
    })
  } catch (e) {
    return { sent: false, source: o.source, reason: `Hub not reachable (${o.hubUrl}): ${(e as Error).message}` }
  }
  if (res.status === 401) return { sent: false, source: o.source, reason: refusedTokenMessage(!!o.tokenFromEnv) }
  // 404 は /indexes を持たない古い Hub
  if (res.status === 404) return { sent: false, source: o.source, reason: 'the Hub has no /indexes (an old Hub; restart it)' }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { sent: false, source: o.source, reason: `the Hub answered ${res.status}${body ? `: ${body}` : ''}` }
  }
  return { sent: true, source: o.source, items: items.length, warnings }
}

// Whether the Hub already holds an index of this project and file. An unreadable list counts as not held (nothing is sent)
async function hubHolds(o: SendOptions): Promise<boolean> {
  try {
    const r = await fetch(`${o.hubUrl}/indexes`, { headers: { authorization: `Bearer ${o.token}` }, signal: AbortSignal.timeout(5000) })
    if (!r.ok) return false
    const { indexes } = (await r.json()) as { indexes: { project: string; source: string }[] }
    const me = normalizeProjectPath(o.project)
    return indexes.some((ix) => ix.source === o.source && normalizeProjectPath(ix.project) === me)
  } catch {
    return false
  }
}
