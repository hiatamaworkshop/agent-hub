// Sends a project's roadmap index to the Hub (PUT /indexes, design.md §3.15). Used by `npm run docs:index` and by team start (C107).
// It never throws: a failure comes back as { sent: false, reason }, so a start or a commit is not stopped by it.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkRoadmap, parseRoadmap } from '../shared/roadmap.js'

export interface SendOptions {
  project: string
  source: string
  hubUrl: string
  token: string
}

export type SendResult =
  | { sent: true; source: string; items: number; warnings: string[] }
  | { sent: false; source: string; reason: string }

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
  if (res.status === 401) return { sent: false, source: o.source, reason: 'the Hub refused the token (HUB_TOKEN in agent-hub\'s .env)' }
  // 404 は /indexes を持たない古い Hub
  if (res.status === 404) return { sent: false, source: o.source, reason: 'the Hub has no /indexes (an old Hub; restart it)' }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { sent: false, source: o.source, reason: `the Hub answered ${res.status}${body ? `: ${body}` : ''}` }
  }
  return { sent: true, source: o.source, items: items.length, warnings }
}
