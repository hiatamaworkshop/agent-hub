import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { sendStartIndex } from '../team/team.js'
import { sendLedgerIndex } from './send-index.js'

const TOKEN = 'test-token-0123456789'
const ROADMAP = ['### C1. 一つ目', '', '#### Done when', '- [ ] a', ''].join('\n')

// A stand-in Hub: records each PUT /indexes and answers with the status the test sets
let server: Server
let hubUrl: string
let nextStatus = 200
const puts: { auth: string | undefined; body: unknown }[] = []

function handle(req: IncomingMessage, res: ServerResponse) {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    if (req.method === 'PUT' && req.url === '/indexes') {
      puts.push({ auth: req.headers.authorization, body: JSON.parse(raw) })
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
