// The per-project setting for the ledger that is sent as the roadmap index (C107, design.md §3.15 "Where the index lives").
// One file in the project's root, `.agent-hub.json`, read by `hub-team` / `npm run team` (team start), `npm run docs:index`
// (without --file) and the post-commit hook (through `docs:index --if-touched`). A project with no file, or no `ledger` key, keeps docs/roadmap.md.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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
  const source = normalizeSource(value)
  if (source.startsWith('/') || /^[A-Za-z]:/.test(source) || source.split('/').includes('..')) return bad('must be a path inside the project (relative, without ..)')
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

// Paths as git and the setting write them: `/` separators and no leading `./`
export function normalizeSource(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '')
}

// The post-commit hook's test (C107): did this commit change the ledger? `changed` is the list of paths from `git diff-tree`
export function touchesLedger(changed: readonly string[], source: string): boolean {
  const want = normalizeSource(source)
  return changed.some((p) => normalizeSource(p) === want)
}
