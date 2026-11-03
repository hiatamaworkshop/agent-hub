// The 401 messages of `status` and of the team start's UI line, when HUB_TOKEN came from the environment (C119)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildResultRecord, emptyOutcome } from './startlog.js'
import { chooseStartNames, printUiUrl } from './team.js'
import { readStatus } from './status.js'

const TOKEN = 'token-from-the-shell-98765432'
const unauthorized = async (): Promise<Response> => new Response(null, { status: 401 })

test('the result line keeps warnings only when they are set (a start that stopped before its pre-start line)', () => {
  const base = emptyOutcome()
  assert.equal('warnings' in buildResultRecord('s', 'p', base, 't'), false)
  const withWarnings = buildResultRecord('s', 'p', { ...base, warnings: ['HUB_PORT is set in this terminal\'s environment'] }, 't')
  assert.deepEqual(withWarnings.warnings, ['HUB_PORT is set in this terminal\'s environment'])
  assert.equal('warnings' in buildResultRecord('s', 'p', { ...base, warnings: [] }, 't'), false)
})

test('the mailbox list that cannot be read names the environment when the token came from there', async () => {
  const unreadable = async () => null
  await assert.rejects(chooseStartNames(['leader'], 'C:\\work\\cairn', TOKEN, unreadable, true), (e: Error) => {
    assert.match(e.message, /environment/)
    assert.match(e.message, /Remove-Item Env:HUB_TOKEN/)
    assert.doesNotMatch(e.message, /HUB_TOKEN in \.env/)
    assert.doesNotMatch(e.message, new RegExp(TOKEN))
    return true
  })
  await assert.rejects(chooseStartNames(['leader'], 'C:\\work\\cairn', TOKEN, unreadable, false), /HUB_TOKEN in \.env/)
})

test('status: a refused token from the environment says so, not ".env"', async () => {
  const r = await readStatus('C:\\work\\cairn', { hubUrl: 'http://127.0.0.1:7790', token: TOKEN, tokenFromEnv: true }, unauthorized)
  assert.equal(r.code, 1)
  const text = r.lines.join('\n')
  assert.match(text, /environment/)
  assert.match(text, /Remove-Item Env:HUB_TOKEN/)
  assert.doesNotMatch(text, /\.env does not match/)
  assert.doesNotMatch(text, /HUB_TOKEN in agent-hub's \.env\)/)
  assert.doesNotMatch(text, new RegExp(TOKEN))
})

test('status: a refused token from .env keeps the .env wording', async () => {
  const r = await readStatus('C:\\work\\cairn', { hubUrl: 'http://127.0.0.1:7790', token: TOKEN }, unauthorized)
  assert.equal(r.code, 1)
  assert.match(r.lines.join('\n'), /HUB_TOKEN in agent-hub's \.env/)
})

test('team UI line: a refused token from the environment is reported as such, and the token is not printed', async () => {
  const realFetch = globalThis.fetch
  const realWarn = console.warn
  const realLog = console.log
  const warnings: string[] = []
  const logs: string[] = []
  globalThis.fetch = (async () => new Response(null, { status: 401 })) as unknown as typeof fetch
  console.warn = (...a: unknown[]) => { warnings.push(a.join(' ')) }
  console.log = (...a: unknown[]) => { logs.push(a.join(' ')) }
  try {
    await printUiUrl('http://127.0.0.1:7790', TOKEN, 'C:\\work\\cairn', true)
  } finally {
    globalThis.fetch = realFetch
    console.warn = realWarn
    console.log = realLog
  }
  const all = [...warnings, ...logs].join('\n')
  assert.equal(warnings.length, 1)
  assert.match(all, /environment/)
  assert.match(all, /Remove-Item Env:HUB_TOKEN/)
  assert.doesNotMatch(all, /\.env does not match/)
  assert.doesNotMatch(all, new RegExp(TOKEN))
})

test('team UI line: a refused token from .env keeps the .env wording', async () => {
  const realFetch = globalThis.fetch
  const realWarn = console.warn
  const warnings: string[] = []
  globalThis.fetch = (async () => new Response(null, { status: 401 })) as unknown as typeof fetch
  console.warn = (...a: unknown[]) => { warnings.push(a.join(' ')) }
  try {
    await printUiUrl('http://127.0.0.1:7790', TOKEN, 'C:\\work\\cairn')
  } finally {
    globalThis.fetch = realFetch
    console.warn = realWarn
  }
  assert.equal(warnings.length, 1)
  assert.match(warnings[0]!, /\.env does not match/)
})
