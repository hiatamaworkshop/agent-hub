import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Message } from '../shared/types.js'
import { createApp } from './app.js'
import { COOKIE_NAME } from './auth.js'
import { Hub } from './hub.js'
import { Store } from './store.js'

const TOKEN = 'test-token-0123456789'
const ORIGIN = 'http://localhost' // app.request() の既定オリジン
const bearer = { authorization: `Bearer ${TOKEN}` }

function setup(heartbeatMs?: number) {
  const hub = new Hub(new Store())
  const app = createApp({ hub, token: TOKEN, uiHtml: async () => '<html>ui</html>', heartbeatMs })
  return { hub, app }
}

const notice = { kind: 'notice', to: { type: 'topic', id: 'user.message' }, body: 'hi' }

function post(app: ReturnType<typeof setup>['app'], body: unknown, headers: Record<string, string>) {
  return app.request('/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

async function browserCookie(app: ReturnType<typeof setup>['app']): Promise<string> {
  const res = await app.request(`/?token=${TOKEN}`)
  const set = res.headers.get('set-cookie') ?? ''
  return set.split(';')[0]!
}

describe('認証', () => {
  it('トークンなし・不正は 401', async () => {
    const { app } = setup()
    assert.equal((await app.request('/messages')).status, 401)
    assert.equal((await app.request('/messages', { headers: { authorization: 'Bearer nope' } })).status, 401)
    assert.equal((await app.request('/messages', { headers: { authorization: TOKEN } })).status, 401)
    assert.equal((await app.request('/stream')).status, 401)
    assert.equal((await app.request('/messages', { headers: bearer })).status, 200)
  })

  it('?token= で cookie を設定し、URL からトークンを消してリダイレクトする', async () => {
    const { app } = setup()
    assert.equal((await app.request('/?token=wrong')).status, 401)
    const res = await app.request(`/?token=${TOKEN}`)
    assert.equal(res.status, 302)
    assert.equal(res.headers.get('location'), '/')
    const set = res.headers.get('set-cookie') ?? ''
    assert.match(set, new RegExp(`^${COOKIE_NAME}=`))
    assert.match(set, /HttpOnly/)
    assert.match(set, /SameSite=Strict/)
    assert.ok(!set.includes(TOKEN), 'cookie にトークンそのものを入れない')
  })

  it('UI の HTML は認証なしで返す', async () => {
    const { app } = setup()
    const res = await app.request('/')
    assert.equal(res.status, 200)
    assert.equal(await res.text(), '<html>ui</html>')
  })

  it('cookie で GET でき、状態変更は同一オリジンのみ', async () => {
    const { app } = setup()
    const cookie = await browserCookie(app)
    assert.equal((await app.request('/messages', { headers: { cookie } })).status, 200)
    assert.equal((await post(app, notice, { cookie })).status, 403)
    assert.equal((await post(app, notice, { cookie, origin: 'http://evil.example' })).status, 403)
    const res = await post(app, notice, { cookie, origin: ORIGIN })
    assert.equal(res.status, 201)
    assert.deepEqual(((await res.json()) as Message).from, { type: 'user', id: 'browser', role: null })
  })

  it('誤った Bearer は正しい cookie があっても 401', async () => {
    const { app } = setup()
    const cookie = await browserCookie(app)
    assert.equal((await app.request('/messages', { headers: { cookie, authorization: 'Bearer nope' } })).status, 401)
  })
})

describe('POST /messages', () => {
  it('from はリクエストから受け取らず Hub が付与する', async () => {
    const { app, hub } = setup()
    const forged = { ...notice, from: { type: 'mailbox', id: 'admin', role: 'root' } }
    const cli = (await (await post(app, forged, bearer)).json()) as Message
    assert.deepEqual(cli.from, { type: 'user', id: 'cli', role: null })

    hub.store.ensureMailbox('rev-a', 'reviewer')
    hub.attachments.set('at_1', { attachmentId: 'at_1', mailbox: 'rev-a', client: 'claude-code', attachedAt: '', leaseUntil: '' })
    const res = await post(app, forged, { ...bearer, 'x-hub-attachment': 'at_1' })
    assert.deepEqual(((await res.json()) as Message).from, { type: 'mailbox', id: 'rev-a', role: 'reviewer' })
    assert.equal((await post(app, notice, { ...bearer, 'x-hub-attachment': 'at_none' })).status, 404)
  })

  it('kind と replyTo を検証する', async () => {
    const { app } = setup()
    assert.equal((await post(app, { ...notice, kind: 'chat' }, bearer)).status, 400)
    assert.equal((await post(app, { ...notice, kind: 'reply' }, bearer)).status, 400)
    assert.equal((await post(app, { ...notice, kind: 'reply', replyTo: 'm_none' }, bearer)).status, 400)
    const first = (await (await post(app, notice, bearer)).json()) as Message
    assert.equal((await post(app, { ...notice, kind: 'reply', replyTo: first.id }, bearer)).status, 201)
    const bad = await app.request('/messages', { method: 'POST', headers: { ...bearer, 'content-type': 'application/json' }, body: '{' })
    assert.equal(bad.status, 400)
  })
})

describe('GET /messages', () => {
  it('after と limit で履歴を返す', async () => {
    const { app } = setup()
    for (let i = 0; i < 3; i++) await post(app, notice, bearer)
    const res = await app.request('/messages?after=1&limit=1', { headers: bearer })
    const json = (await res.json()) as { messages: Message[]; lastSeq: number }
    assert.deepEqual(json.messages.map((m) => m.seq), [2])
    assert.equal(json.lastSeq, 3)
    assert.equal((await app.request('/messages?limit=0', { headers: bearer })).status, 400)
    assert.equal((await app.request('/messages?after=-1', { headers: bearer })).status, 400)
  })
})

describe('GET /stream', () => {
  it('新着メッセージを SSE で流し、heartbeat を送る', async () => {
    const { app } = setup(20)
    const res = await app.request('/stream', { headers: bearer })
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let text = ''
    const created = (await (await post(app, notice, bearer)).json()) as Message
    const deadline = Date.now() + 2000
    while (!(text.includes('event: message') && text.includes(': ping')) && Date.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
    }
    await reader.cancel()
    assert.match(text, /event: message\ndata: .*"id":"m_/)
    assert.ok(text.includes(created.id))
    assert.ok(text.includes(': ping'))
  })
})
