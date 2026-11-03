import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  envOverrides, overriddenNames, overrideWarning, parseDotEnv, refusedTokenMessage, tokenFromEnvironment,
} from './env-override.js'

const TOKEN = 'token-from-dotenv-0123456789'
const OTHER = 'token-from-the-shell-98765432'

test('the same value in the environment and .env is not listed', () => {
  assert.deepEqual(overriddenNames({ HUB_TOKEN: TOKEN }, `HUB_TOKEN=${TOKEN}\n`), [])
})

test('a different value is listed by name only, and no value reaches the warning', () => {
  const names = overriddenNames({ HUB_TOKEN: OTHER }, `HUB_TOKEN=${TOKEN}\n`)
  assert.deepEqual(names, ['HUB_TOKEN'])
  const text = overrideWarning(names[0]!)
  assert.match(text, /HUB_TOKEN/)
  assert.doesNotMatch(text, /token-from/)
  assert.match(text, /Remove-Item Env:HUB_TOKEN/)
  assert.match(text, /unset HUB_TOKEN/)
})

test('a name set in only one of the two places is not listed', () => {
  assert.deepEqual(overriddenNames({ HUB_PORT: '7791' }, `HUB_TOKEN=${TOKEN}\n`), [])
  assert.deepEqual(overriddenNames({}, `HUB_PORT=7790\n`), [])
})

test('a missing .env lists nothing', () => {
  assert.deepEqual(overriddenNames({ HUB_TOKEN: OTHER, HUB_PORT: '1' }, undefined), [])
})

test('quoted values in .env are compared without their quotes', () => {
  assert.deepEqual(overriddenNames({ HUB_TOKEN: TOKEN }, `HUB_TOKEN="${TOKEN}"\n`), [])
  assert.deepEqual(overriddenNames({ HUB_PORT: '7790' }, `HUB_PORT='7790'\n`), [])
  assert.deepEqual(overriddenNames({ HUB_PORT: '7791' }, `HUB_PORT='7790'\n`), ['HUB_PORT'])
  assert.deepEqual(overriddenNames({ HUB_TOKEN: OTHER }, `HUB_TOKEN="${TOKEN}"\n`), ['HUB_TOKEN'])
})

test('the parser handles export, comments, inline comments and the last line of a name', () => {
  const v = parseDotEnv('# HUB_PORT=1\nexport HUB_PORT=1111 # note\nHUB_PORT=7790\r\nHUB_URL="http://127.0.0.1:7790"\n')
  assert.equal(v.get('HUB_PORT'), '7790')
  assert.equal(v.get('HUB_URL'), 'http://127.0.0.1:7790')
  assert.deepEqual(overriddenNames({ HUB_PORT: '7790', HUB_URL: 'http://127.0.0.1:7790' }, 'export HUB_PORT=1111 # note\nHUB_PORT=7790\nHUB_URL="http://127.0.0.1:7790"\n'), [])
})

test('an empty value in the environment counts as not set', () => {
  assert.deepEqual(overriddenNames({ HUB_URL: '   ' }, 'HUB_URL=http://127.0.0.1:7790\n'), [])
  assert.deepEqual(overriddenNames({ HUB_TOKEN: OTHER }, 'HUB_TOKEN=\n'), [])
})

test('only HUB_TOKEN, HUB_PORT and HUB_URL are checked, in that order', () => {
  const env = { HUB_ROLE: 'leader', HUB_MAILBOX: 'x', HUB_URL: 'http://a', HUB_PORT: '1', HUB_TOKEN: OTHER }
  const dot = `HUB_ROLE=deployer\nHUB_MAILBOX=y\nHUB_URL=http://b\nHUB_PORT=2\nHUB_TOKEN=${TOKEN}\n`
  assert.deepEqual(overriddenNames(env, dot), ['HUB_TOKEN', 'HUB_PORT', 'HUB_URL'])
})

test('envOverrides reads agent-hub\'s .env in the given root, and lists nothing without one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'c119-env-'))
  try {
    writeFileSync(join(dir, '.env'), `HUB_PORT=7790\nHUB_TOKEN="${TOKEN}"\n`)
    assert.deepEqual(envOverrides(dir, { HUB_PORT: '7791', HUB_TOKEN: TOKEN }), ['HUB_PORT'])
    assert.deepEqual(envOverrides(join(dir, 'missing'), { HUB_PORT: '7791' }), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('tokenFromEnvironment is true only for a non-empty value', () => {
  assert.equal(tokenFromEnvironment({ HUB_TOKEN: TOKEN }), true)
  assert.equal(tokenFromEnvironment({ HUB_TOKEN: '  ' }), false)
  assert.equal(tokenFromEnvironment({}), false)
})

test('the 401 message names the environment when the token came from there, and .env otherwise', () => {
  const fromEnv = refusedTokenMessage(true)
  assert.match(fromEnv, /environment/)
  assert.match(fromEnv, /Remove-Item Env:HUB_TOKEN/)
  assert.doesNotMatch(fromEnv, /\.env does not match/)
  assert.equal(refusedTokenMessage(false), "the Hub refused the token (HUB_TOKEN in agent-hub's .env)")
})
