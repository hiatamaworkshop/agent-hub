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

export interface Verified { version: Version; section: string }

// The highest Claude Code version named in the headings of design.md §6.1 (§6.1, §6.1b … §6.1x; §6.2 is not a verification).
// Only versions after "Claude Code" count, so other versions in a heading (Docker 29.8.2) are not taken.
// Returns null when no heading names one.
export function lastVerified(design: string): Verified | null {
  let best: Verified | null = null
  for (const line of design.split(/\r?\n/)) {
    const heading = /^### (6\.1[a-z]*) /.exec(line)
    if (!heading) continue
    const named = /Claude Code ((?:\d+\.\d+\.\d+)(?: (?:or|to) \d+\.\d+\.\d+)*)/.exec(line)
    if (!named) continue
    for (const m of named[1]!.matchAll(/\d+\.\d+\.\d+/g)) {
      const version = parseVersion(m[0])!
      if (!best || compareVersions(version, best.version) > 0) best = { version, section: heading[1]! }
    }
  }
  return best
}

// The warning for a Claude Code newer than the last verified one. Null when it is not newer, or either version is unknown.
// The start is not stopped; the warning says what it means
export function versionWarning(running: Version | null, verified: Verified | null): string | null {
  if (!running || !verified || compareVersions(running, verified.version) <= 0) return null
  const v = verified.version.join('.')
  const r = running.join('.')
  return `Claude Code ${r} is newer than the last verified ${v} (design.md §${verified.section}). Its behaviour is outside the verified envelope`
}

export interface VersionCheck {
  warning: string | null
  // The last verified version and its §6.1 section, or the reason none is known (design.md unreadable or no version named)
  lastVerified: string | null
  verifiedSection: string | null
  verifiedNote: string | null
}

// Compare `claude --version` (its output, or null if unknown) with design.md §6.1, read from `root`
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
    return { warning: null, lastVerified: null, verifiedSection: null, verifiedNote: 'no Claude Code version named in the headings of design.md §6.1' }
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

// What a start did, for its result line. A role is `started` once its tab is open and it attached (or, without a token, once its tab is open:
// the attach is then not checked); `failed` carries the reason; `aborted` says why the start stopped before or between roles
export interface RoleRef { role: string; mailbox: string }
export interface StartOutcome {
  started: RoleRef[]
  skipped: RoleRef[]
  failed: (RoleRef & { reason: string })[]
  aborted: string | null
}
export function emptyOutcome(): StartOutcome {
  return { started: [], skipped: [], failed: [], aborted: null }
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
    failed: outcome.failed,
    aborted: outcome.aborted,
  }
}

// Append the result line. Written on every start, with or without warnings. A failed write prints a warning and returns; the start is not stopped
export function recordResult(start: string, projectDir: string, outcome: StartOutcome, file = startLogPath()): string | null {
  const err = appendStartRecord(buildResultRecord(start, projectDir, outcome, new Date().toISOString()), file)
  if (err) console.warn(`WARNING: could not write the start result (${file}): ${err}`)
  return err
}
