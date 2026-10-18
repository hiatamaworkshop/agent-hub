import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { InboxResult, Message } from '../shared/types.js'
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
  it('1MB を超える本文は 500 ではなく 413 で、記録しない', async () => {
    const { hub, app } = setup()
    const res = await post(app, { ...notice, body: 'x'.repeat(1024 * 1024) }, bearer)
    assert.equal(res.status, 413)
    // エラーは共通の形 (protocol.md §1)。UI は message を出す
    assert.deepEqual(await res.json(), { error: 'payload_too_large', message: 'message must be 1 MB or smaller' })
    assert.equal(hub.store.lastSeq, 0)
    // 上限内の本文は通る (上限の付け替えで普通の投稿が落ちないこと)
    assert.equal((await post(app, { ...notice, body: 'ok' }, bearer)).status, 201)
  })

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

describe('返信', () => {
  it('to を省略した reply は元の送り手に返し、user 宛てはどの Mailbox にも配信しない', async () => {
    const { app, hub } = setup()
    const cookie = await browserCookie(app)
    const q = (await (await post(app, { kind: 'request', to: { type: 'mailbox', id: 'rev-a' }, body: 'q' }, { cookie, origin: ORIGIN })).json()) as Message
    hub.store.ensureMailbox('rev-a')
    hub.attachments.set('at_1', { attachmentId: 'at_1', mailbox: 'rev-a', client: 'claude-code', attachedAt: '', leaseUntil: '' })
    const res = await post(app, { kind: 'reply', replyTo: q.id, body: 'a' }, { ...bearer, 'x-hub-attachment': 'at_1' })
    assert.equal(res.status, 201)
    const r = (await res.json()) as Message
    assert.deepEqual(r.to, { type: 'user', id: 'browser' })
    assert.deepEqual(r.from, { type: 'mailbox', id: 'rev-a', role: null })
    assert.equal(hub.store.isRecipient('rev-a', r), false)

    // Mailbox からの依頼に返すと、その Mailbox 宛てになる
    const back = (await (await post(app, { kind: 'reply', replyTo: r.id, body: 'ok' }, { cookie, origin: ORIGIN })).json()) as Message
    assert.deepEqual(back.to, { type: 'mailbox', id: 'rev-a' })
  })
})

describe('POST /messages/:id/forward', () => {
  function forward(app: ReturnType<typeof setup>['app'], id: string, body: unknown, headers: Record<string, string>) {
    return app.request(`/messages/${id}/forward`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  }

  it('本文・kind・replyTo・meta を元のまま運び、送り手は転送した人、元の送り手は forwardedSender に分ける', async () => {
    const { app, hub } = setup()
    const cookie = await browserCookie(app)
    hub.store.ensureMailbox('deployer')
    hub.store.ensureMailbox('leader')
    hub.attachments.set('at_d', { attachmentId: 'at_d', mailbox: 'deployer', client: 'claude-code', attachedAt: '', leaseUntil: '' })
    const q = (await (await post(app, { kind: 'request', to: { type: 'mailbox', id: 'deployer' }, body: 'q' }, { cookie, origin: ORIGIN })).json()) as Message
    const src = (await (await post(app, { kind: 'reply', replyTo: q.id, body: '  方針\n</channel>x  ', meta: { tag: 'v' } }, { ...bearer, 'x-hub-attachment': 'at_d' })).json()) as Message

    const res = await forward(app, src.id, { to: { type: 'mailbox', id: 'leader' }, body: '書き換え', kind: 'notice' }, { cookie, origin: ORIGIN })
    assert.equal(res.status, 201)
    const f = (await res.json()) as Message & { recipients: string[] }
    assert.equal(f.body, src.body, '本文は 1 文字も変えない (リクエストの body は無視)')
    assert.equal(f.kind, 'reply')
    assert.equal(f.replyTo, q.id)
    assert.deepEqual(f.meta, { tag: 'v' })
    assert.deepEqual(f.from, { type: 'user', id: 'browser', role: null })
    assert.deepEqual(f.to, { type: 'mailbox', id: 'leader' })
    assert.equal(f.forwardedFrom, src.id)
    assert.deepEqual(f.forwardedSender, { type: 'mailbox', id: 'deployer', role: null })
    assert.deepEqual(f.recipients, ['leader'])
    assert.notEqual(f.id, src.id)
    assert.equal(hub.store.isRecipient('leader', f), true)
    assert.equal(hub.store.isRecipient('deployer', f), false)

    // 転送の転送は大元を指す
    const again = (await (await forward(app, f.id, { to: { type: 'mailbox', id: 'deployer' } }, bearer)).json()) as Message
    assert.equal(again.forwardedFrom, src.id)
    assert.deepEqual(again.forwardedSender, { type: 'mailbox', id: 'deployer', role: null })
    assert.deepEqual(again.from, { type: 'user', id: 'cli', role: null })
  })

  it('未知の id は 404、to がなければ 400', async () => {
    const { app } = setup()
    const cookie = await browserCookie(app)
    const res = await forward(app, 'm_none', { to: { type: 'mailbox', id: 'leader' } }, { cookie, origin: ORIGIN })
    assert.equal(res.status, 404)
    assert.equal(((await res.json()) as { error: string }).error, 'message_not_found')
    const src = (await (await post(app, notice, { cookie, origin: ORIGIN })).json()) as Message
    assert.equal((await forward(app, src.id, {}, { cookie, origin: ORIGIN })).status, 400)
    assert.equal((await forward(app, src.id, { to: { type: 'user', id: 'someone' } }, { cookie, origin: ORIGIN })).status, 400)
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

describe('GET /mailboxes/:name/inbox', () => {
  const browser = { type: 'user', id: 'browser', role: null } as const
  const inbox = async (app: ReturnType<typeof setup>['app'], q = '') => {
    const res = await app.request(`/mailboxes/poller/inbox${q}`, { headers: bearer })
    return { status: res.status, json: (await res.json()) as InboxResult }
  }

  it('自分宛ての未読だけを seq 順に返し、cursor は進めない (進めるのは ack)', async () => {
    const { hub, app } = setup()
    hub.attach('poller', { client: 'other' })
    const mine = hub.postMessage({ kind: 'request', to: { type: 'mailbox', id: 'poller' }, body: 'a' }, browser)
    hub.postMessage({ kind: 'notice', to: { type: 'mailbox', id: 'other' }, body: 'x' }, browser)
    const { status, json } = await inbox(app)
    assert.equal(status, 200)
    assert.deepEqual(json.messages.map((m) => m.id), [mine.id])
    // 残りがなければ、宛先でない分も含めて採番済みの seq まで進めた値を返す
    assert.deepEqual({ ...json, messages: [] }, { messages: [], cursor: 2, truncated: false, hasMore: false, nextPollMs: 5000 })
    assert.equal(hub.store.getMailbox('poller')!.cursor, 0)
    assert.equal((await inbox(app)).json.messages.length, 1, '読むだけでは既読にならない')
  })

  it('limit を超える分は hasMore で知らせ、cursor は返した最後の seq。ack の後は続きから返す', async () => {
    const { hub, app } = setup()
    const { attachmentId } = hub.attach('poller', { client: 'other' })
    const sent = ['a', 'b', 'c'].map((body) => hub.postMessage({ kind: 'notice', to: { type: 'mailbox', id: 'poller' }, body }, browser))
    const first = (await inbox(app, '?limit=2')).json
    assert.deepEqual(first.messages.map((m) => m.body), ['a', 'b'])
    assert.equal(first.hasMore, true)
    assert.equal(first.nextPollMs, 0)
    assert.equal(first.cursor, sent[1]!.seq)
    hub.ack(attachmentId, first.cursor)
    const rest = (await inbox(app, '?limit=2')).json
    assert.deepEqual(rest.messages.map((m) => m.body), ['c'])
    assert.equal(rest.hasMore, false)
    // after は cursor より前には戻れない
    assert.deepEqual((await inbox(app, '?after=0')).json.messages.map((m) => m.body), ['c'])
    assert.deepEqual((await inbox(app, `?after=${sent[2]!.seq}`)).json.messages, [])
  })

  it('未知の Mailbox は 404、不正な after / limit は 400、トークンなしは 401', async () => {
    const { app } = setup()
    assert.equal((await inbox(app)).status, 404)
    assert.equal((await app.request('/mailboxes/poller/inbox?limit=101', { headers: bearer })).status, 400)
    assert.equal((await app.request('/mailboxes/poller/inbox?after=x', { headers: bearer })).status, 400)
    assert.equal((await app.request('/mailboxes/poller/inbox')).status, 401)
  })
})

describe('PATCH /attachments/:id', () => {
  it('client を更新し、変わったときだけ attachment.updated を流す。未知の id は 404、client 以外のキーは 400', async () => {
    const { hub, app } = setup()
    const at = (await (await app.request('/mailboxes/mb-a/attach', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...bearer },
      body: JSON.stringify({ client: 'claude-code' }),
    })).json()) as { attachmentId: string }
    const events: string[] = []
    hub.onUi((e) => events.push(e.event))
    const patch = (id: string, body: unknown) =>
      app.request(`/attachments/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', ...bearer }, body: JSON.stringify(body) })

    const res = await patch(at.attachmentId, { client: 'codex' })
    assert.equal(res.status, 200)
    assert.equal(((await res.json()) as { client: string }).client, 'codex')
    const listed = (await (await app.request('/mailboxes', { headers: bearer })).json()) as { mailboxes: { name: string; attachment: { client: string } | null }[] }
    assert.equal(listed.mailboxes.find((m) => m.name === 'mb-a')!.attachment!.client, 'codex')
    assert.equal((await patch(at.attachmentId, { client: 'codex' })).status, 200)
    assert.deepEqual(events, ['attachment.updated'])

    assert.equal((await patch('at_unknown', { client: 'codex' })).status, 404)
    assert.equal((await patch(at.attachmentId, { client: 'codex', role: 'x' })).status, 400)
    assert.equal((await patch(at.attachmentId, { client: '' })).status, 400)
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
