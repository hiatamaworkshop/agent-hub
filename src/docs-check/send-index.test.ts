import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { sendStartIndex } from '../team/team.js'
import { caseOnlyRealName, sendLedgerIndex } from './send-index.js'

const TOKEN = 'test-token-0123456789'
const ROADMAP = ['### C1. 一つ目', '', '#### Done when', '- [ ] a', ''].join('\n')

// A stand-in Hub: records each PUT /indexes and answers with the status the test sets
let server: Server
let hubUrl: string
let nextStatus = 200
const puts: { auth: string | undefined; body: unknown }[] = []
// What GET /indexes answers (project and source of each index the stand-in Hub holds)
let held: { project: string; source: string }[] = []

function handle(req: IncomingMessage, res: ServerResponse) {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    if (req.method === 'PUT' && req.url === '/indexes') {
      puts.push({ auth: req.headers.authorization, body: JSON.parse(raw) })
    }
    if (req.method === 'GET' && req.url === '/indexes') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ indexes: held }))
      return
    }
    res.statusCode = nextStatus
    res.setHeader('content-type', 'application/json')
    res.end(nextStatus === 200 ? '{"ok":true}' : '{"error":"nope"}')
  })
}

before(async () => {
  server = createServer(handle)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()))
  hubUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => new Promise<void>((done) => server.close(() => done())))

// A project folder with the ledger at `source`
function project(source: string | null, text = ROADMAP): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-hub-send-index-'))
  if (source !== null) {
    mkdirSync(join(dir, source, '..'), { recursive: true })
    writeFileSync(join(dir, source), text)
  }
  return dir
}

test('sends the ledger the setting names, with the token and the project, and reports the item count', async () => {
  puts.length = 0
  nextStatus = 200
  const dir = project('docs/items.md')
  const r = await sendLedgerIndex({ project: dir, source: 'docs/items.md', hubUrl, token: TOKEN })
  assert.equal(r.sent, true)
  if (!r.sent) return
  assert.equal(r.items, 1)
  assert.equal(r.source, 'docs/items.md')
  assert.equal(puts.length, 1)
  assert.equal(puts[0]!.auth, `Bearer ${TOKEN}`)
  const body = puts[0]!.body as { project: string; source: string; items: { id: string }[] }
  assert.equal(body.project, dir)
  assert.equal(body.source, 'docs/items.md')
  assert.deepEqual(body.items.map((i) => i.id), ['C1'])
})

test('a missing ledger file is not sent, and says which file and folder', async () => {
  puts.length = 0
  const dir = project(null)
  const r = await sendLedgerIndex({ project: dir, source: 'docs/items.md', hubUrl, token: TOKEN })
  assert.equal(r.sent, false)
  if (r.sent) return
  assert.match(r.reason, /docs\/items\.md does not exist in /)
  assert.equal(puts.length, 0)
})

test('a Hub that is not reachable is a reason, not a throw', async () => {
  const dir = project('docs/roadmap.md')
  // a port that nothing listens on: open one, note it, close it
  const probe = createServer()
  await new Promise<void>((done) => probe.listen(0, '127.0.0.1', () => done()))
  const port = (probe.address() as AddressInfo).port
  await new Promise<void>((done) => probe.close(() => done()))
  const r = await sendLedgerIndex({ project: dir, source: 'docs/roadmap.md', hubUrl: `http://127.0.0.1:${port}`, token: TOKEN })
  assert.equal(r.sent, false)
  if (!r.sent) assert.match(r.reason, /Hub not reachable/)
})

test('a refused token and an old Hub without /indexes are reasons', async () => {
  const dir = project('docs/roadmap.md')
  nextStatus = 401
  const refused = await sendLedgerIndex({ project: dir, source: 'docs/roadmap.md', hubUrl, token: 'wrong' })
  assert.equal(refused.sent, false)
  if (!refused.sent) assert.match(refused.reason, /refused the token/)
  nextStatus = 404
  const old = await sendLedgerIndex({ project: dir, source: 'docs/roadmap.md', hubUrl, token: TOKEN })
  assert.equal(old.sent, false)
  if (!old.sent) assert.match(old.reason, /no \/indexes/)
  nextStatus = 200
})

test('team start: the summary line says what was sent, and why nothing was, without throwing', async () => {
  nextStatus = 200
  const dir = project('docs/items.md')
  const sent = await sendStartIndex(dir, 'docs/items.md', hubUrl, TOKEN)
  assert.equal(sent, `sent docs/items.md (1 items) to ${hubUrl}`)
  const none = await sendStartIndex(project(null), 'docs/roadmap.md', hubUrl, TOKEN)
  assert.match(none, /^not sent: docs\/roadmap\.md does not exist/)
})

test('a ledger with no items is not sent unless the Hub already holds an index of that file (2026-11-02, cairn)', async () => {
  const dir = project('docs/roadmap.md', '# Roadmap\n\nNothing here.\n')
  nextStatus = 200
  held = []
  const before = puts.length
  const r = await sendLedgerIndex({ project: dir, source: 'docs/roadmap.md', hubUrl, token: TOKEN })
  assert.equal(r.sent, false)
  assert.match(r.sent ? '' : r.reason, /has no `### C<n>\.` items.*\.agent-hub\.json/)
  assert.equal(puts.length, before, 'nothing was PUT')
  // The same file already on the Hub: the empty index is sent, so a ledger whose last item closed does not stay stale
  held = [{ project: dir, source: 'docs/roadmap.md' }]
  const again = await sendLedgerIndex({ project: dir, source: 'docs/roadmap.md', hubUrl, token: TOKEN })
  assert.equal(again.sent, true)
  assert.equal(puts.length, before + 1)
  held = []
})

// C131: a file that differs from the configured name only by letter case is named in the reason. The real names are injected, so
// these tests run the same on a case-sensitive disk (Linux CI): no file that differs only by case is made
const CASE_ONLY = (p: string) => p.replace(/roadmap\.md$/, 'ROADMAP.md') // the disk gives docs\ROADMAP.md for docs\roadmap.md

test('caseOnlyRealName: the real name when it differs only by case, and nothing otherwise (C131)', () => {
  assert.equal(caseOnlyRealName({ project: '/work/x', source: 'docs/roadmap.md' }, CASE_ONLY), 'docs/ROADMAP.md')
  // the same name: no difference
  assert.equal(caseOnlyRealName({ project: '/work/x', source: 'docs/roadmap.md' }, (p) => p), undefined)
  // a missing file does not resolve: no name to give
  assert.equal(caseOnlyRealName({ project: '/work/x', source: 'docs/roadmap.md' }, () => { throw new Error('ENOENT') }), undefined)
  // a different name, not only by case: not this case
  assert.equal(caseOnlyRealName({ project: '/work/x', source: 'docs/roadmap.md' }, (p) => p.replace(/roadmap\.md$/, 'other.md')), undefined)
})

test('a case-only difference: the no-items reason names the file that was read (C131)', async () => {
  const dir = project('docs/roadmap.md', '# Roadmap\n\nNothing here.\n')
  held = []
  const before = puts.length
  const r = await sendLedgerIndex({ project: dir, source: 'docs/roadmap.md', hubUrl, token: TOKEN, realPath: CASE_ONLY })
  assert.equal(r.sent, false)
  assert.match(r.sent ? '' : r.reason, /^docs\/roadmap\.md opened docs\/ROADMAP\.md \(letter case differs\), which has no `### C<n>\.` items, so nothing was sent\./)
  assert.equal(puts.length, before, 'nothing was PUT')
})

test('no difference: the no-items reason is unchanged (C131)', async () => {
  const dir = project('docs/roadmap.md', '# Roadmap\n\nNothing here.\n')
  held = []
  const r = await sendLedgerIndex({ project: dir, source: 'docs/roadmap.md', hubUrl, token: TOKEN, realPath: (p) => p })
  assert.equal(r.sent, false)
  assert.equal(r.sent ? '' : r.reason.startsWith('docs/roadmap.md has no `### C<n>.` items, so nothing was sent.'), true)
  assert.doesNotMatch(r.sent ? '' : r.reason, /opened/)
})

test('a missing file: the reason is unchanged, and no name is given (C131)', async () => {
  const dir = project(null)
  held = []
  const r = await sendLedgerIndex({ project: dir, source: 'docs/roadmap.md', hubUrl, token: TOKEN, realPath: CASE_ONLY })
  assert.equal(r.sent, false)
  assert.match(r.sent ? '' : r.reason, /^docs\/roadmap\.md does not exist in /)
})

test('team start: the summary line passes the same reason on (C131)', async () => {
  const dir = project('docs/roadmap.md', '# Roadmap\n\nNothing here.\n')
  held = []
  const summary = await sendStartIndex(dir, 'docs/roadmap.md', hubUrl, TOKEN, CASE_ONLY)
  assert.match(summary, /^not sent: docs\/roadmap\.md opened docs\/ROADMAP\.md \(letter case differs\), which has no `### C<n>\.` items/)
})
