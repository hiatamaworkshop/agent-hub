// The per-project setting for the ledger that is sent as the roadmap index (C107, design.md §3.15 "Where the index lives").
// One file in the project's root, `.agent-hub.json`, read by `hub-team` / `npm run team` (team start), `npm run docs:index`
// (without --file) and the post-commit hook (through `docs:index --if-touched`). A project with no file, or no `ledger` key, keeps docs/roadmap.md.
import { existsSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'

export const LEDGER_SETTING_FILE = '.agent-hub.json'
export const DEFAULT_LEDGER = 'docs/roadmap.md'

export interface LedgerSetting {
  // The ledger path, relative to the project's root, with `/` separators
  source: string
  // 'file': the setting names it. 'default': no setting, or one that could not be used (then `warning` says why)
  from: 'file' | 'default'
  warning?: string
}

// Reads the text of `.agent-hub.json` (null when there is no file). A setting that cannot be used is a warning, not a stop:
// the default ledger is used so the start and the commit go on.
export function parseLedgerSetting(text: string | null): LedgerSetting {
  const fallback: LedgerSetting = { source: DEFAULT_LEDGER, from: 'default' }
  if (text === null) return fallback
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    return { ...fallback, warning: `${LEDGER_SETTING_FILE} is not valid JSON (${(e as Error).message}), so ${DEFAULT_LEDGER} is used` }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ...fallback, warning: `${LEDGER_SETTING_FILE} must be a JSON object, so ${DEFAULT_LEDGER} is used` }
  }
  if (!('ledger' in data)) return fallback
  const value = (data as { ledger: unknown }).ledger
  const bad = (why: string): LedgerSetting => ({ ...fallback, warning: `"ledger" in ${LEDGER_SETTING_FILE} ${why}, so ${DEFAULT_LEDGER} is used` })
  if (typeof value !== 'string' || value.trim() === '') return bad('must be a non-empty string')
  const source = canonicalPath(value)
  if (source === null) return bad('must be a path inside the project (relative, without ..)')
  return { source, from: 'file' }
}

// The setting of a project folder (the file is read here, nowhere else)
export function readLedgerSetting(projectDir: string): LedgerSetting {
  const file = join(projectDir, LEDGER_SETTING_FILE)
  if (!existsSync(file)) return parseLedgerSetting(null)
  try {
    return parseLedgerSetting(readFileSync(file, 'utf8'))
  } catch (e) {
    return { source: DEFAULT_LEDGER, from: 'default', warning: `${LEDGER_SETTING_FILE} cannot be read (${(e as Error).message}), so ${DEFAULT_LEDGER} is used` }
  }
}

// The one form of a project's path (C126): `/` separators, `.` segments and repeated `/` removed, no leading `./` and no trailing `/`,
// relative to the project. The setting, `docs:index --file` and the hook's comparison all use it, so one file has one `source`.
// Matching is by spelling as git writes it (case included). null when the value cannot be put in that form: empty, absolute,
// a drive letter, or leaving the project with `..`
export function canonicalPath(p: string): string | null {
  const s = p.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (s === '') return null
  const n = posix.normalize(s)
  if (n === '.' || n === '..' || n.startsWith('../') || n.startsWith('/') || /^[A-Za-z]:/.test(n)) return null
  return n
}

// The post-commit hook's test (C107): did this commit change the ledger? `changed` is the list of paths from `git diff-tree -z` (git's form)
export function touchesLedger(changed: readonly string[], source: string): boolean {
  const want = canonicalPath(source)
  if (want === null) return false
  return changed.some((p) => canonicalPath(p) === want)
}
