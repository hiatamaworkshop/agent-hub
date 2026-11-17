import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  appendStartRecord, buildResultRecord, buildStartRecord, checkClaudeVersion, compareVersions, emptyOutcome, lastVerified, parseVersion,
  recordResult, recordStart, splitByConnection, versionWarnedBefore, versionWarning,
} from './startlog.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'agent-hub-startlog-'))

test('parseVersion: the first x.y.z of the output, or null', () => {
  assert.deepEqual(parseVersion('2.1.310 (Claude Code)'), [2, 1, 310])
  assert.deepEqual(parseVersion('claude 10.0.2'), [10, 0, 2])
  assert.equal(parseVersion('no version here'), null)
  assert.equal(parseVersion(null), null)
})

test('compareVersions: numeric, not textual', () => {
  assert.ok(compareVersions([2, 1, 311], [2, 1, 310]) > 0)
  assert.ok(compareVersions([2, 1, 9], [2, 1, 10]) < 0)
  assert.equal(compareVersions([2, 1, 310], [2, 1, 310]), 0)
})

const RUNS = [
  '# Design',
  '### 6.1c Confirmed on a real machine (2026-10-16, Claude Code 2.1.301 / Windows 11 / Pro)',
  '| 2026-10-16 | 9.9.9 | a table row outside the section | does not count |',
  '### 6.3 Delivery behaviours of Claude Code to check again on a newer version (C172)',
  '| Date | Claude Code | OS | Result |',
  '|---|---|---|---|',
  '| 2026-11-20 | 2.1.330 | Windows 11 | all as recorded |',
  '| 2026-12-02 | 2.1.341 | Ubuntu 24.04 | B4 changed, see §6.1aj |',
  '| 2026-12-05 | 2.1.335 | Windows 11 | an older version run later does not lower it |',
  'Claude Code 2.1.399 in a body line does not count.',
].join('\n')

test('lastVerified: the highest version among the runs recorded in §6.3, with the run\'s date and OS (C172)', () => {
  assert.deepEqual(lastVerified(RUNS), { version: [2, 1, 341], section: '6.3', date: '2026-12-02', os: 'Ubuntu 24.04' })
})

test('lastVerified: a §6.1 entry with a newer version does not move it (C172)', () => {
  const design = `${RUNS}\n### 6.1zz One unrelated behaviour (2026-12-20, Claude Code 2.1.400 / Windows 11)\n| 2026-12-20 | 2.1.400 | Windows 11 | a row under another heading |\n### 6.2 Unverified (Claude Code 2.1.401)`
  assert.deepEqual(lastVerified(design)?.version, [2, 1, 341])
  // the same entry placed before §6.3 does not move it either
  assert.deepEqual(lastVerified(`### 6.1zz One unrelated behaviour (2026-12-20, Claude Code 2.1.400 / Windows 11)\n${RUNS}`)?.version, [2, 1, 341])
})

test('lastVerified: null when §6.3 records no run, or is not there', () => {
  assert.equal(lastVerified('### 6.3 Delivery behaviours\n| Date | Claude Code | OS | Result |\n|---|---|---|---|\n| B1 | a behaviour row | §6.1c (2.1.301) | step 2 |'), null)
  assert.equal(lastVerified('### 6.1c Confirmed on a real machine (2026-10-16, Claude Code 2.1.301 / Windows 11)'), null)
})

test('versionWarning: only a version newer than the last verified one, and it points to the list (C172)', () => {
  const verified = { version: [2, 1, 310] as [number, number, number], section: '6.3', date: '2026-11-20', os: 'Windows 11' }
  const w = versionWarning([2, 1, 311], verified)
  assert.ok(w)
  assert.match(w, /^Claude Code 2\.1\.311 is newer than the last verified 2\.1\.310 /)
  assert.match(w, /run 2026-11-20 on Windows 11/)
  assert.match(w, /run the checks listed in design\.md §6\.3 and record the run there/)
  assert.equal(versionWarning([2, 1, 310], verified), null)
  assert.equal(versionWarning([2, 1, 309], verified), null)
  assert.equal(versionWarning(null, verified), null)
})

test('versionWarning: with no recorded run, any known version is outside the envelope (C172)', () => {
  const w = versionWarning([2, 1, 311], null)
  assert.ok(w)
  assert.match(w, /^Claude Code 2\.1\.311 has no verified version to compare with: design\.md §6\.3 records no run/)
  assert.match(w, /run the checks listed in design\.md §6\.3/)
  assert.equal(versionWarning(null, null), null)
})

test('checkClaudeVersion: the real design.md has §6.3, and gives a run or the note that none is recorded', () => {
  const r = checkClaudeVersion(null)
  assert.equal(r.warning, null, 'an unknown running version is not a warning')
  if (r.lastVerified === null) {
    assert.match(r.verifiedNote ?? '', /^no run of the delivery checks recorded in design\.md §6\.3$/)
    assert.equal(r.verifiedSection, null)
  } else {
    assert.match(r.lastVerified, /^\d+\.\d+\.\d+$/)
    assert.equal(r.verifiedSection, '6.3')
    assert.equal(r.verifiedNote, null)
  }
})

test('checkClaudeVersion: a newer claude is a warning, an unknown one is not', () => {
  assert.match(checkClaudeVersion('99.0.0 (Claude Code)').warning ?? '', /design\.md §6\.3/)
  assert.equal(checkClaudeVersion(null).warning, null)
})

test('checkClaudeVersion: runs are read from the design.md under root; without a run the warning says so', () => {
  const withRuns = tmp()
  mkdirSync(join(withRuns, 'docs'))
  writeFileSync(join(withRuns, 'docs', 'design.md'), RUNS)
  assert.deepEqual(checkClaudeVersion('2.1.341 (Claude Code)', withRuns), { warning: null, lastVerified: '2.1.341', verifiedSection: '6.3', verifiedNote: null })
  assert.match(checkClaudeVersion('2.1.342 (Claude Code)', withRuns).warning ?? '', /newer than the last verified 2\.1\.341/)
  const noRuns = tmp()
  mkdirSync(join(noRuns, 'docs'))
  writeFileSync(join(noRuns, 'docs', 'design.md'), '### 6.1c Confirmed (2026-10-16, Claude Code 2.1.301)\n### 6.3 Delivery behaviours\n')
  const r = checkClaudeVersion('2.1.301 (Claude Code)', noRuns)
  assert.match(r.warning ?? '', /has no verified version to compare with/)
  assert.equal(r.lastVerified, null)
})

test('checkClaudeVersion: a missing design.md is a note, not a warning', () => {
  const r = checkClaudeVersion('99.0.0', tmp())
  assert.equal(r.warning, null)
  assert.equal(r.lastVerified, null)
  assert.match(r.verifiedNote ?? '', /^cannot read /)
})

test('buildStartRecord: the fields, and one JSON line when written', () => {
  const check = { warning: null, lastVerified: '2.1.310', verifiedSection: '6.1r', verifiedNote: null }
  const rec = buildStartRecord({
    projectDir: 'C:\\work\\proj',
    roles: ['deployer'],
    mailboxes: ['proj.deployer'],
    claudeVersion: '2.1.310 (Claude Code)',
    check,
    warnings: ['git fetch failed'],
  }, '2026-10-31T00:00:00.000Z', 'abc123')
  assert.deepEqual(Object.keys(rec), ['kind', 'time', 'project', 'head', 'roles', 'mailboxes', 'claudeVersion', 'lastVerified', 'verifiedSection', 'verifiedNote', 'warnings'])
  assert.equal(rec.kind, 'start')
  assert.equal(rec.head, 'abc123')
  assert.deepEqual(rec.warnings, ['git fetch failed'])
  const dir = tmp()
  const file = join(dir, 'logs', 'start-warnings.jsonl')
  assert.equal(appendStartRecord(rec, file), null)
  assert.equal(appendStartRecord(rec, file), null)
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
  assert.equal(lines.length, 2)
  assert.deepEqual(JSON.parse(lines[1]!), rec)
})

test('appendStartRecord: a failed write is returned, not thrown', () => {
  const dir = tmp()
  const blocker = join(dir, 'file')
  writeFileSync(blocker, '')
  const rec = buildStartRecord({
    projectDir: dir, roles: [], mailboxes: [], claudeVersion: null,
    check: { warning: null, lastVerified: null, verifiedSection: null, verifiedNote: null }, warnings: ['x'],
  }, '2026-10-31T00:00:00.000Z', null)
  assert.equal(typeof appendStartRecord(rec, join(blocker, 'start-warnings.jsonl')), 'string')
})

test('recordStart: writes nothing without warnings, one line with them', async () => {
  const dir = tmp()
  const file = join(dir, 'logs', 'start-warnings.jsonl')
  const check = { warning: null, lastVerified: '2.1.310', verifiedSection: '6.1r', verifiedNote: null }
  await recordStart({ projectDir: dir, roles: ['leader'], mailboxes: ['x.leader'], claudeVersion: null, check, warnings: [] }, file)
  assert.equal(existsSync(file), false)
  await recordStart({ projectDir: dir, roles: ['leader'], mailboxes: ['x.leader'], claudeVersion: null, check, warnings: ['w'] }, file)
  const rec = JSON.parse(readFileSync(file, 'utf8').trim())
  assert.equal(rec.head, null)
  assert.deepEqual(rec.warnings, ['w'])
})

const T0 = '2026-10-31T01:00:00.000Z'
const T1 = '2026-10-31T01:00:05.000Z'
const noCheck = { warning: null, lastVerified: null, verifiedSection: null, verifiedNote: null }
const readLines = (file: string) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)

test('splitByConnection: a connected role is skipped without --force, and started with it (C88)', () => {
  const connected = new Set(['deployer'])
  assert.deepEqual(splitByConnection(['leader', 'deployer'], connected, false), { start: ['leader'], skip: ['deployer'] })
  assert.deepEqual(splitByConnection(['leader', 'deployer'], connected, true), { start: ['leader', 'deployer'], skip: [] })
  assert.deepEqual(splitByConnection(['leader'], new Set(), false), { start: ['leader'], skip: [] })
})

test('pre-start line: lists only the roles that will start, and its time is the start time the result repeats (C88)', async () => {
  const dir = tmp()
  const file = join(dir, 'logs', 'start-warnings.jsonl')
  const { start, skip } = splitByConnection(['leader', 'deployer'], new Set(['deployer']), false)
  await recordStart({ projectDir: dir, roles: start, mailboxes: start.map((r) => `x.${r}`), claudeVersion: null, check: noCheck, warnings: ['w'], time: T0 }, file)
  const [pre] = readLines(file)
  assert.equal(pre!.kind, 'start')
  assert.equal(pre!.time, T0)
  assert.deepEqual(pre!.roles, ['leader'], 'the connected deployer is left out')
  assert.deepEqual(pre!.mailboxes, ['x.leader'])
  assert.deepEqual(skip, ['deployer'], 'it is skipped, and the result line says so')
})

test('result line: started, skipped and failed with the reason, and the same start as the pre-start line (C88)', () => {
  const dir = tmp()
  const file = join(dir, 'logs', 'start-warnings.jsonl')
  const outcome = {
    ...emptyOutcome(),
    started: [{ role: 'leader', mailbox: 'x.leader' }],
    skipped: [{ role: 'deployer', mailbox: 'x.deployer' }],
    failed: [{ role: 'reviewer', mailbox: 'x.reviewer', reason: 'x.reviewer did not attach within 60 seconds' }],
  }
  assert.equal(recordResult(T0, dir, outcome, file), null)
  const [res] = readLines(file)
  assert.equal(res!.kind, 'result')
  assert.equal(res!.start, T0, 'matches the pre-start line by its time')
  assert.equal(typeof res!.time, 'string')
  assert.equal(res!.project, dir)
  assert.deepEqual(res!.started, outcome.started)
  assert.deepEqual(res!.skipped, outcome.skipped)
  assert.deepEqual(res!.failed, outcome.failed)
  assert.equal(res!.aborted, null)
  // The record builder agrees with what is written
  assert.deepEqual(buildResultRecord(T0, dir, outcome, T1), { ...res, time: T1 })
})

test('result line: without warnings it is still written, and an aborted start says why (C88)', () => {
  const dir = tmp()
  const file = join(dir, 'logs', 'start-warnings.jsonl')
  recordResult(T0, dir, { ...emptyOutcome(), aborted: 'The Hub did not start in time. Check its tab' }, file)
  const [res] = readLines(file)
  assert.equal(res!.kind, 'result')
  assert.deepEqual(res!.started, [])
  assert.equal(res!.aborted, 'The Hub did not start in time. Check its tab')
})

test('result line: a failed write returns the error and does not throw (the start goes on) (C88)', () => {
  const dir = tmp()
  const blocker = join(dir, 'file')
  writeFileSync(blocker, '')
  const err = recordResult(T0, dir, emptyOutcome(), join(blocker, 'start-warnings.jsonl'))
  assert.equal(typeof err, 'string')
})

test('version warning: loud only on the first start with a version; every start is still recorded (C111)', async () => {
  const dir = tmp()
  const file = join(dir, 'start-warnings.jsonl')
  const running: [number, number, number] = [99, 0, 1]
  const warning = 'Claude Code 99.0.1 is newer than the last verified 2.1.310 (design.md §6.1x). Its behaviour is outside the verified envelope'
  const check = { warning, lastVerified: '2.1.310', verifiedSection: '6.1x', verifiedNote: null }
  // no log yet: not warned before
  assert.equal(versionWarnedBefore(running, file), false)
  const input = { projectDir: dir, roles: ['leader'], mailboxes: ['x.leader'], claudeVersion: '99.0.1 (Claude Code)', check, warnings: [warning] }
  await recordStart(input, file)
  assert.equal(versionWarnedBefore(running, file), true)
  // another version has its own first start
  assert.equal(versionWarnedBefore([99, 0, 2], file), false)
  // a later start with the same version is recorded again, so the log keeps every start
  await recordStart(input, file)
  const lines = readFileSync(file, 'utf8').trim().split('\n')
  assert.equal(lines.length, 2)
  assert.equal(versionWarnedBefore(running, file), true)
  // a start whose warnings are other things does not count as a warning about this version
  const other = tmp()
  const otherFile = join(other, 'start-warnings.jsonl')
  await recordStart({ ...input, warnings: ['Hub hooks missing for Stop'] }, otherFile)
  assert.equal(versionWarnedBefore(running, otherFile), false)
  // the warning for "no run recorded" counts as a warning about that version too (C172)
  const never = versionWarning(running, null)!
  await recordStart({ ...input, warnings: [never] }, otherFile)
  assert.equal(versionWarnedBefore(running, otherFile), true)
  assert.equal(versionWarnedBefore([99, 0, 2], otherFile), false)
})
