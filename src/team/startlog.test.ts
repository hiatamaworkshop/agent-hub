import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  appendStartRecord, buildResultRecord, buildStartRecord, checkClaudeVersion, compareVersions, emptyOutcome, lastVerified, parseVersion,
  recordResult, recordStart, splitByConnection, versionWarning,
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

test('lastVerified: the highest version named after "Claude Code" in a §6.1 heading', () => {
  const design = [
    '# Design',
    '### 6.1 Verified (2026-10-16, checked against the official Channels reference)',
    '### 6.1c Confirmed on a real machine (2026-10-16, Claude Code 2.1.301 / Windows 11 / Pro)',
    '### 6.1l The Hub in Docker Desktop (2026-10-18, Docker 29.8.2 / Windows 11)',
    '### 6.1r A request (2026-10-26, Claude Code 2.1.309 or 2.1.310; looking afterwards, it had auto-updated to 2.1.312)',
    'Claude Code 2.1.399 in a body line does not count.',
    '### 6.2 Unverified (Claude Code 2.1.400)',
  ].join('\n')
  assert.deepEqual(lastVerified(design), { version: [2, 1, 310], section: '6.1r' })
})

test('lastVerified: null when no §6.1 heading names a version', () => {
  assert.equal(lastVerified('### 6.1 Verified (2026-10-16)\n### 6.1b Verified (Docker 29.8.2)'), null)
})

test('versionWarning: only a version newer than the last verified one', () => {
  const verified = { version: [2, 1, 310] as [number, number, number], section: '6.1r' }
  const w = versionWarning([2, 1, 311], verified)
  assert.ok(w)
  assert.match(w, /2\.1\.311/)
  assert.match(w, /2\.1\.310/)
  assert.match(w, /§6\.1r/)
  assert.equal(versionWarning([2, 1, 310], verified), null)
  assert.equal(versionWarning([2, 1, 309], verified), null)
  assert.equal(versionWarning(null, verified), null)
  assert.equal(versionWarning([2, 1, 311], null), null)
})

test('checkClaudeVersion: the real design.md names a last verified version', () => {
  const r = checkClaudeVersion(null)
  assert.equal(r.verifiedNote, null)
  assert.match(r.lastVerified ?? '', /^\d+\.\d+\.\d+$/)
  assert.match(r.verifiedSection ?? '', /^6\.1[a-z]*$/)
  assert.equal(r.warning, null)
})

test('checkClaudeVersion: a newer claude is a warning, an unknown one is not', () => {
  assert.ok(checkClaudeVersion('99.0.0 (Claude Code)').warning)
  assert.equal(checkClaudeVersion(null).warning, null)
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
