import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  appendStartRecord, buildStartRecord, checkClaudeVersion, compareVersions, lastVerified, parseVersion,
  recordStart, versionWarning,
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
  assert.deepEqual(Object.keys(rec), ['time', 'project', 'head', 'roles', 'mailboxes', 'claudeVersion', 'lastVerified', 'verifiedSection', 'verifiedNote', 'warnings'])
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
