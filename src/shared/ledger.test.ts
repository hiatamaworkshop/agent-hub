import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { canonicalPath, DEFAULT_LEDGER, LEDGER_SETTING_FILE, parseLedgerSetting, readLedgerSetting, touchesLedger } from './ledger.js'

test('canonicalPath: every spelling of one file is one form (C126)', () => {
  for (const spelling of ['docs/items.md', 'docs/./items.md', 'docs//items.md', './docs/items.md', 'docs\\items.md', ' docs/items.md ', 'docs/items.md/', './docs//./items.md']) {
    assert.equal(canonicalPath(spelling), 'docs/items.md', spelling)
  }
  assert.equal(canonicalPath('docs/台帳.md'), 'docs/台帳.md')
  assert.equal(canonicalPath('docs/sub/../items.md'), 'docs/items.md')
})

test('canonicalPath: a value that cannot be put in the form is null', () => {
  for (const bad of ['', '   ', '.', './', '..', '../x.md', 'docs/../../x.md', '/etc/x.md', 'C:/x.md', 'C:\\x.md']) {
    assert.equal(canonicalPath(bad), null, JSON.stringify(bad))
  }
})

test('the setting is read in the same form, so docs/./items.md and docs//items.md name docs/items.md (C126)', () => {
  assert.deepEqual(parseLedgerSetting('{"ledger": "docs/./items.md"}'), { source: 'docs/items.md', from: 'file' })
  assert.deepEqual(parseLedgerSetting('{"ledger": "docs//items.md"}'), { source: 'docs/items.md', from: 'file' })
  assert.deepEqual(parseLedgerSetting('{"ledger": "docs/台帳.md"}'), { source: 'docs/台帳.md', from: 'file' })
  assert.equal(parseLedgerSetting('{"ledger": "."}').from, 'default')
  assert.match(parseLedgerSetting('{"ledger": "."}').warning ?? '', /inside the project/)
})

test('no setting keeps docs/roadmap.md, without a warning', () => {
  assert.deepEqual(parseLedgerSetting(null), { source: DEFAULT_LEDGER, from: 'default' })
  assert.deepEqual(parseLedgerSetting('{}'), { source: DEFAULT_LEDGER, from: 'default' })
  assert.deepEqual(parseLedgerSetting('{"other": 1}'), { source: DEFAULT_LEDGER, from: 'default' })
})

test('a ledger path names the file, with / separators and no leading ./', () => {
  assert.deepEqual(parseLedgerSetting('{"ledger": "docs/items.md"}'), { source: 'docs/items.md', from: 'file' })
  // in JSON a backslash is written doubled: the file holds ./docs\\items.md
  assert.deepEqual(parseLedgerSetting('{"ledger": "./docs\\\\items.md"}'), { source: 'docs/items.md', from: 'file' })
})

test('a setting that cannot be used warns and falls back to docs/roadmap.md', () => {
  const cases: [string, RegExp][] = [
    ['{not json', /not valid JSON/],
    ['[]', /must be a JSON object/],
    ['"docs/items.md"', /must be a JSON object/],
    ['{"ledger": 3}', /non-empty string/],
    ['{"ledger": "  "}', /non-empty string/],
    ['{"ledger": "/etc/x.md"}', /inside the project/],
    ['{"ledger": "C:/x.md"}', /inside the project/],
    ['{"ledger": "../x.md"}', /inside the project/],
    ['{"ledger": "docs/../../x.md"}', /inside the project/],
  ]
  for (const [text, why] of cases) {
    const s = parseLedgerSetting(text)
    assert.equal(s.source, DEFAULT_LEDGER, text)
    assert.equal(s.from, 'default', text)
    assert.match(s.warning ?? '', why, text)
    assert.match(s.warning ?? '', /docs\/roadmap\.md is used/, text)
  }
})

test('readLedgerSetting reads .agent-hub.json in the project folder, and nothing when it is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-hub-ledger-'))
  assert.deepEqual(readLedgerSetting(dir), { source: DEFAULT_LEDGER, from: 'default' })
  writeFileSync(join(dir, LEDGER_SETTING_FILE), '{"ledger": "docs/items.md"}')
  assert.deepEqual(readLedgerSetting(dir), { source: 'docs/items.md', from: 'file' })
  writeFileSync(join(dir, LEDGER_SETTING_FILE), '{broken')
  assert.equal(readLedgerSetting(dir).source, DEFAULT_LEDGER)
  assert.match(readLedgerSetting(dir).warning ?? '', /not valid JSON/)
})

// The post-commit hook's path test: it sends only when the commit changed the ledger the setting names
test('touchesLedger: a commit that changed the ledger path (in git\'s form) sends', () => {
  assert.equal(touchesLedger(['docs/items.md'], 'docs/items.md'), true)
  assert.equal(touchesLedger(['src/a.ts', 'docs/items.md'], 'docs/items.md'), true)
  assert.equal(touchesLedger(['./docs/items.md'], 'docs/items.md'), true)
  assert.equal(touchesLedger(['docs\\items.md'], 'docs/items.md'), true)
  // git's paths for a non-ASCII name (-z gives them unquoted); a setting in a non-canonical spelling still matches
  assert.equal(touchesLedger(['docs/台帳.md'], 'docs/台帳.md'), true)
  assert.equal(touchesLedger(['docs/台帳.md'], 'docs//台帳.md'), true)
  assert.equal(touchesLedger(['docs/items.md'], 'docs/./items.md'), true)
})

test('touchesLedger: the spelling must match git\'s (case included), so Docs/Items.md does not match docs/items.md', () => {
  assert.equal(touchesLedger(['docs/items.md'], 'Docs/items.md'), false)
})

test('touchesLedger: a commit that changed only other files does not send', () => {
  assert.equal(touchesLedger(['docs/roadmap.md'], 'docs/items.md'), false)
  assert.equal(touchesLedger(['docs/items.md.bak', 'docs/items'], 'docs/items.md'), false)
  assert.equal(touchesLedger(['src/docs/items.md'], 'docs/items.md'), false)
  assert.equal(touchesLedger([], 'docs/items.md'), false)
  assert.equal(touchesLedger(['.agent-hub.json'], 'docs/roadmap.md'), false)
})

test('the default ledger: docs/roadmap.md is sent after a commit that changed it, and not otherwise', () => {
  assert.equal(touchesLedger(['docs/roadmap.md'], DEFAULT_LEDGER), true)
  assert.equal(touchesLedger(['docs/items.md'], DEFAULT_LEDGER), false)
  assert.equal(canonicalPath(' docs\\roadmap.md '), 'docs/roadmap.md')
})
