// The record of a start's warnings (roadmap C85). When a start (`team`, or `agent` started on its own) has warnings,
// one JSONL line goes to logs/start-warnings.jsonl. It holds the environment and the warnings shown at the start.
// Changes and decisions are not recorded here: git keeps them. The Hub is not involved.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runGit } from './checks.js'
import { ROOT } from './env.js'

export type Version = [number, number, number]

// The first x.y.z in a line of text (e.g. `claude --version`'s output), or null
export function parseVersion(text: string | null): Version | null {
  const m = text ? /(\d+)\.(\d+)\.(\d+)/.exec(text) : null
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!
  return 0
}

// The section of design.md with the list of Claude Code behaviours delivery depends on, and the record of its runs (C172)
export const CHECKS_SECTION = '6.3'

// `date` and `os` are the run's, as written in its row
export interface Verified { version: Version; section: string; date: string; os: string }

// The highest Claude Code version the list of design.md §6.3 was run with: a row of that section's table of runs,
// `| YYYY-MM-DD | x.y.z | OS | result |` (C172). A version named in a §6.1 heading does not count: an entry that observed one
// unrelated behaviour on a newer version would move it for all of them. Returns null when the section has no such row.
export function lastVerified(design: string): Verified | null {
  let best: Verified | null = null
  let inside = false
  for (const line of design.split(/\r?\n/)) {
    if (/^#{2,3} /.test(line)) inside = line.startsWith(`### ${CHECKS_SECTION} `)
    if (!inside) continue
    const row = /^\| *(\d{4}-\d{2}-\d{2}) *\| *(?:Claude Code )?(\d+\.\d+\.\d+) *\| *([^|]+?) *\|/.exec(line)
    if (!row) continue
    const version = parseVersion(row[2]!)!
    if (!best || compareVersions(version, best.version) > 0) best = { version, section: CHECKS_SECTION, date: row[1]!, os: row[3]! }
  }
  return best
}

const NEVER_RUN = 'has no verified version to compare with: '

// The warning for a Claude Code newer than the last one the list was run with, or for any Claude Code when no run is recorded.
// Null when it is not newer, or the running version is unknown. The start is not stopped; the warning says what it means
// and where the checks to run again are (C172)
export function versionWarning(running: Version | null, verified: Verified | null): string | null {
  if (!running) return null
  const r = running.join('.')
  const todo = `Its behaviour is outside the verified envelope: run the checks listed in design.md §${CHECKS_SECTION} and record the run there`
  if (!verified) return `Claude Code ${r} ${NEVER_RUN}design.md §${CHECKS_SECTION} records no run of the delivery checks. ${todo}`
  if (compareVersions(running, verified.version) <= 0) return null
  const v = verified.version.join('.')
  return `Claude Code ${r} is newer than the last verified ${v} (the delivery checks of design.md §${verified.section}, run ${verified.date} on ${verified.os}). ${todo}`
}

// Whether an earlier start in the log already warned about this running version (C111). The warning is loud (WARNING) only on the first
// start with a version; later starts print it as one plain line in the summary. Starts with warnings are recorded in the log, so the log
// is the record and no other state is kept. A missing or unreadable log counts as not warned
export function versionWarnedBefore(running: Version, file = startLogPath()): boolean {
  const prefixes = [`Claude Code ${running.join('.')} is newer than the last verified `, `Claude Code ${running.join('.')} ${NEVER_RUN}`]
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return false
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    let r: Partial<StartRecord>
    try {
      r = JSON.parse(line) as Partial<StartRecord>
    } catch {
      continue
    }
    if (r.kind === 'start' && (r.warnings ?? []).some((w) => prefixes.some((p) => w.startsWith(p)))) return true
  }
  return false
}

export interface VersionCheck {
  warning: string | null
  // The last version the delivery checks were run with and the section that records the run (design.md §6.3), or the reason
  // none is known (design.md unreadable, or no run recorded)
  lastVerified: string | null
  verifiedSection: string | null
  verifiedNote: string | null
}

// Compare `claude --version` (its output, or null if unknown) with the runs recorded in design.md §6.3, read from `root`
export function checkClaudeVersion(output: string | null, root = ROOT): VersionCheck {
  const file = join(root, 'docs', 'design.md')
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return { warning: null, lastVerified: null, verifiedSection: null, verifiedNote: `cannot read ${file}` }
  }
  const verified = lastVerified(text)
  if (!verified) {
    return { warning: versionWarning(parseVersion(output), null), lastVerified: null, verifiedSection: null, verifiedNote: `no run of the delivery checks recorded in design.md §${CHECKS_SECTION}` }
  }
  return {
    warning: versionWarning(parseVersion(output), verified),
    lastVerified: verified.version.join('.'),
    verifiedSection: verified.section,
    verifiedNote: null,
  }
}

// The pre-start line (written only with warnings) and the result line (written on every start) of one start share `time` (the start's
// time): the result's `start` is the pre-start line's `time` (C88)
export interface StartRecord {
  kind: 'start'
  time: string
  project: string
  head: string | null
  roles: string[]
  mailboxes: string[]
  claudeVersion: string | null
  lastVerified: string | null
  verifiedSection: string | null
  verifiedNote: string | null
  warnings: string[]
}

export interface StartInput {
  projectDir: string
  // The roles and Mailboxes that will be started (connected ones skipped without --force are not listed; C88)
  roles: string[]
  mailboxes: string[]
  claudeVersion: string | null
  check: VersionCheck
  warnings: string[]
  // The start's time, which the result line repeats. Defaults to now
  time?: string
}

// One record for a start. Pure: the time and HEAD are passed in
export function buildStartRecord(i: StartInput, time: string, head: string | null): StartRecord {
  return {
    kind: 'start',
    time,
    project: i.projectDir,
    head,
    roles: i.roles,
    mailboxes: i.mailboxes,
    claudeVersion: i.claudeVersion,
    lastVerified: i.check.lastVerified,
    verifiedSection: i.check.verifiedSection,
    verifiedNote: i.check.verifiedNote,
    warnings: i.warnings,
  }
}

export function startLogPath(root = ROOT): string {
  return join(root, 'logs', 'start-warnings.jsonl')
}

// Append one line. Returns the error message on failure instead of throwing: a failed write never stops a start
export function appendStartRecord(record: StartRecord | ResultRecord, file = startLogPath()): string | null {
  try {
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, `${JSON.stringify(record)}\n`)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

// Record a start if it has warnings. HEAD is read from the target project (null when it is not a git repository).
// Prints a warning and returns when the write fails; the start goes on
export async function recordStart(i: StartInput, file = startLogPath()): Promise<void> {
  if (i.warnings.length === 0) return
  const head = await runGit(i.projectDir, ['rev-parse', 'HEAD'])
  const record = buildStartRecord(i, i.time ?? new Date().toISOString(), head.code === 0 && head.out ? head.out : null)
  const err = appendStartRecord(record, file)
  if (err) console.warn(`WARNING: could not write the start record (${file}): ${err}`)
}

// Which roles a start will start, and which it skips because their Mailbox is already connected (without --force). Pure (C88)
export function splitByConnection(roles: string[], connected: ReadonlySet<string>, force: boolean): { start: string[]; skip: string[] } {
  const start: string[] = []
  const skip: string[] = []
  for (const role of roles) (!force && connected.has(role) ? skip : start).push(role)
  return { start, skip }
}

// What a start did, for its result line. A role is `started` once it attached to the Hub (C100). Without a token the attach cannot be
// checked: `team` then counts a role as started once its tab is open, and `agent` on its own once claude has spawned. With the `print`
// opener and no token nothing is opened, only the command is printed, so the role is `printed` (C100). `failed` carries the reason;
// `aborted` says why the start stopped before or between roles
export interface RoleRef { role: string; mailbox: string }
export interface StartOutcome {
  started: RoleRef[]
  skipped: RoleRef[]
  printed: RoleRef[]
  failed: (RoleRef & { reason: string })[]
  aborted: string | null
  // The start's warnings, set only while the pre-start line has not been written (a start that stops early). The result line then
  // keeps them, so a warning seen before the stop (e.g. C119's environment check) is in the record (C119)
  warnings?: string[]
}
export function emptyOutcome(): StartOutcome {
  return { started: [], skipped: [], printed: [], failed: [], aborted: null }
}

export interface ResultRecord extends StartOutcome {
  kind: 'result'
  time: string
  // The pre-start line's `time` for this start (the same value, so the two match)
  start: string
  project: string
}

// One result record. Pure: the time is passed in
export function buildResultRecord(start: string, project: string, outcome: StartOutcome, time: string): ResultRecord {
  return {
    kind: 'result',
    time,
    start,
    project,
    started: outcome.started,
    skipped: outcome.skipped,
    printed: outcome.printed,
    failed: outcome.failed,
    aborted: outcome.aborted,
    ...(outcome.warnings?.length ? { warnings: outcome.warnings } : {}),
  }
}

// Append the result line. Written on every start, with or without warnings. A failed write prints a warning and returns; the start is not stopped
export function recordResult(start: string, projectDir: string, outcome: StartOutcome, file = startLogPath()): string | null {
  const err = appendStartRecord(buildResultRecord(start, projectDir, outcome, new Date().toISOString()), file)
  if (err) console.warn(`WARNING: could not write the start result (${file}): ${err}`)
  return err
}
