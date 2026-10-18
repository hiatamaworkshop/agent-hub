import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Message } from '../shared/types.js'
import { createApp } from './app.js'
import { Hub, type AttachResult } from './hub.js'
import { Store } from './store.js'

const TOKEN = 'test-token-0123456789'
const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

function setup(hub = new Hub(new Store())) {
  const app = createApp({ hub, token: TOKEN, uiHtml: async () => null, heartbeatMs: 50 })
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(path, { method, headers: { ...auth, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const attach = async (name: string, body: unknown = { client: 'claude-code' }) =>
    (await (await call('POST', `/mailboxes/${name}/attach`, body)).json()) as AttachResult
  const send = async (to: unknown, body = 'b', headers: Record<string, string> = {}) =>
    (await (await call('POST', '/messages', { kind: 'request', to, body }, headers)).json()) as Message
  return { app, call, attach, send }
}

interface SseEvent {
  event: string
  data: string
}

// SSE を読み、until を満たすか stream が閉じるか timeout まで集める
async function collect(res: Response, until: (evs: SseEvent[]) => boolean, timeoutMs = 1000) {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  const events: SseEvent[] = []
  let buf = ''
  let closed = false
  const deadline = Date.now() + timeoutMs
  while (!until(events) && Date.now() < deadline) {
    const r = await Promise.race([
      reader.read(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), Math.max(0, deadline - Date.now()))),
    ])
    if (r === null) break
    if (r.done) {
      closed = true
      break
    }
    buf += decoder.decode(r.value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i)
      buf = buf.slice(i + 2)
      const ev = /^event: (.*)$/m.exec(block)?.[1]
      const data = /^data: (.*)$/m.exec(block)?.[1]
      if (ev && data !== undefined) events.push({ event: ev, data })
    }
  }
  if (!closed) await reader.cancel()
  return { events, closed }
}

const messages = (evs: SseEvent[]) => evs.filter((e) => e.event === 'message').map((e) => JSON.parse(e.data) as Message)

describe('attach', () => {
  it('Mailbox を作り、attach し直しても同じ Mailbox を使う', async () => {
    const { call, attach } = setup()
    const a = await attach('rev-a', { client: 'claude-code', role: 'reviewer', sessionId: 's1', cwd: 'C:/x' })
    assert.match(a.attachmentId, /^at_/)
    assert.equal(a.role, 'reviewer')
    assert.equal(a.cursor, 0)
    assert.equal(a.superseded, null)
    const b = await attach('rev-a')
    assert.equal(b.role, 'reviewer', 'role は指定時だけ変わる')
    assert.equal(b.superseded, a.attachmentId)
    const list = (await (await call('GET', '/mailboxes')).json()) as { mailboxes: { name: string; attachment: { attachmentId: string } }[] }
    assert.equal(list.mailboxes.length, 1)
    assert.equal(list.mailboxes[0]!.attachment.attachmentId, b.attachmentId)
  })

  it('名前と入力を検証する', async () => {
    const { call } = setup()
    assert.equal((await call('POST', '/mailboxes/Bad/attach', {})).status, 400)
    assert.equal((await call('POST', '/mailboxes/ok/attach', { role: 'Bad' })).status, 400)
    assert.equal((await call('POST', '/mailboxes/ok/attach')).status, 200, 'body なしでもよい')
  })
})

describe('購読', () => {
  it('PUT / DELETE で個別購読を変え、購読中のトピック宛てが stream に流れる', async () => {
    const { app, call, attach, send } = setup()
    const a = await attach('main')
    const put = await call('PUT', '/mailboxes/main/subscriptions/user.message')
    assert.deepEqual(((await put.json()) as { subscriptions: string[] }).subscriptions, ['user.message'])
    assert.equal((await call('PUT', '/mailboxes/none/subscriptions/x')).status, 404)

    const res = await app.request(`/attachments/${a.attachmentId}/stream`, { headers: auth })
    const m1 = await send({ type: 'topic', id: 'user.message' }, 'hello')
    await send({ type: 'topic', id: 'other' })
    const { events } = await collect(res, (evs) => messages(evs).length >= 1 && evs.some((e) => e.event === 'heartbeat'))
    assert.deepEqual(messages(events).map((m) => m.id), [m1.id])
    const hb = events.find((e) => e.event === 'heartbeat')
    assert.deepEqual(JSON.parse(hb!.data), { cursor: 0 })

    await call('DELETE', '/mailboxes/main/subscriptions/user.message')
    const res2 = await app.request(`/attachments/${a.attachmentId}/stream?after=${m1.seq}`, { headers: auth })
    await send({ type: 'topic', id: 'user.message' })
    assert.deepEqual(messages((await collect(res2, () => false, 150)).events), [])
  })
})

describe('配信先 (recipients)', () => {
  it('POST /messages の応答に配信先 Mailbox を含め、誰にも届かなければ空にする', async () => {
    const { call, attach } = setup()
    await attach('a', { client: 'claude-code', role: 'reviewer' })
    await attach('b')
    await call('PUT', '/mailboxes/b/subscriptions/user.message')
    const post = async (to: unknown) =>
      (await (await call('POST', '/messages', { kind: 'request', to, body: 'x' })).json()) as Message & { recipients: string[] }

    assert.deepEqual((await post({ type: 'mailbox', id: 'a' })).recipients, ['a'])
    assert.deepEqual((await post({ type: 'role', id: 'reviewer' })).recipients, ['a'])
    assert.deepEqual((await post({ type: 'topic', id: 'user.message' })).recipients, ['b'])
    assert.deepEqual((await post({ type: 'topic', id: 'nobody' })).recipients, [])
    assert.deepEqual((await post({ type: 'mailbox', id: 'none' })).recipients, [])
    assert.deepEqual((await post({ type: 'user', id: 'browser' })).recipients, [])

    const listed = (await (await call('GET', '/messages')).json()) as { messages: Record<string, unknown>[] }
    assert.ok(listed.messages.every((m) => !('recipients' in m)), 'Message 自体には含めない')
  })

  it('user 宛ては browser / cli だけを受理する', async () => {
    const { call } = setup()
    const post = (id: string) => call('POST', '/messages', { kind: 'request', to: { type: 'user', id }, body: 'x' })
    assert.equal((await post('browser')).status, 201)
    assert.equal((await post('cli')).status, 201)
    assert.equal((await post('agent-hub')).status, 400)
  })
})

describe('再送と ack', () => {
  it('ack 前に attach し直すと未読が再送され、ack 後は再送されない', async () => {
    const { app, call, attach, send } = setup()
    const a = await attach('rev-a')
    const m1 = await send({ type: 'mailbox', id: 'rev-a' }, 'one')

    const first = await collect(await app.request(`/attachments/${a.attachmentId}/stream`, { headers: auth }), (evs) => messages(evs).length >= 1)
    assert.deepEqual(messages(first.events).map((m) => m.body), ['one'])

    // ack しないまま交代
    const b = await attach('rev-a')
    const again = await collect(await app.request(`/attachments/${b.attachmentId}/stream`, { headers: auth }), (evs) => messages(evs).length >= 1)
    assert.deepEqual(messages(again.events).map((m) => m.id), [m1.id])

    const ack = await call('POST', `/attachments/${b.attachmentId}/ack`, { upTo: m1.seq })
    assert.deepEqual(await ack.json(), { cursor: m1.seq, received: 0 })

    const c = await attach('rev-a')
    assert.equal(c.cursor, m1.seq)
    const res = await app.request(`/attachments/${c.attachmentId}/stream`, { headers: auth })
    const m2 = await send({ type: 'mailbox', id: 'rev-a' }, 'two')
    const after = await collect(res, (evs) => messages(evs).length >= 1)
    assert.deepEqual(messages(after.events).map((m) => m.id), [m2.id])
  })

  it('ack の入力と Attachment を検証する', async () => {
    const { call, attach } = setup()
    const a = await attach('x')
    assert.equal((await call('POST', `/attachments/${a.attachmentId}/ack`, { upTo: -1 })).status, 400)
    assert.equal((await call('POST', '/attachments/at_none/ack', { upTo: 1 })).status, 404)
    assert.equal((await call('GET', '/attachments/at_none/stream')).status, 404)
  })

  it('cursor か received が進んだときだけ mailbox.acked を UI に流す', async () => {
    const hub = new Hub(new Store())
    const app = createApp({ hub, token: TOKEN, uiHtml: async () => null, heartbeatMs: 50 })
    const events: { event: string; data: unknown }[] = []
    hub.onUi((e) => events.push(e))
    const call = (method: string, path: string, body?: unknown) =>
      app.request(path, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) })
    const a = (await (await call('POST', '/mailboxes/x/attach', { client: 'claude-code' })).json()) as AttachResult
    const m1 = (await (await call('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'x' }, body: 'one' })).json()) as Message
    const acked = () => events.filter((e) => e.event === 'mailbox.acked')

    await call('POST', `/attachments/${a.attachmentId}/ack`, { upTo: m1.seq })
    assert.deepEqual(acked(), [{ event: 'mailbox.acked', data: { name: 'x', cursor: m1.seq, received: 0, unconfirmed: 1 } }])

    // 進まない ack (同じ値・後退) は流さない
    await call('POST', `/attachments/${a.attachmentId}/ack`, { upTo: m1.seq })
    await call('POST', `/attachments/${a.attachmentId}/ack`, { upTo: 0 })
    assert.equal(acked().length, 1)

    // cursor は進まなくても received が進めば流す
    await call('POST', `/attachments/${a.attachmentId}/ack`, { upTo: m1.seq, received: { first: m1.seq, last: m1.seq } })
    assert.deepEqual(acked()[1]?.data, { name: 'x', cursor: m1.seq, received: m1.seq, unconfirmed: 0 })
  })
})

describe('流し込み量の制御 (maxAgeMs / maxUnread)', () => {
  const to = { type: 'mailbox', id: 'x' }

  it('上限を超えた古い未読を放棄済みにして cursor を進め、新しい分だけ流す。UI には mailbox.acked', async () => {
    const hub = new Hub(new Store(), { unreadMax: 3 })
    const ui: { event: string; data: unknown }[] = []
    hub.onUi((e) => ui.push(e))
    const { app, call, attach, send } = setup(hub)
    const a = await attach('x')
    assert.equal(a.truncated, false)
    assert.equal(a.skipped, 0)
    await call('DELETE', `/attachments/${a.attachmentId}`)
    const sent = []
    for (const body of ['1', '2', '3', '4', '5']) sent.push(await send(to, body))

    const b = await attach('x')
    assert.equal(b.truncated, true)
    assert.equal(b.skipped, 2)
    assert.equal(b.cursor, sent[1]!.seq)
    assert.deepEqual(ui.filter((e) => e.event === 'mailbox.acked').map((e) => e.data), [{ name: 'x', cursor: sent[1]!.seq, received: sent[1]!.seq, unconfirmed: 0 }])
    const got = await collect(await app.request(`/attachments/${b.attachmentId}/stream`, { headers: auth }), (evs) => messages(evs).length >= 3)
    assert.deepEqual(messages(got.events).map((m) => m.body), ['3', '4', '5'])
    // ログには残る
    assert.equal(hub.store.listMessages().length, 5)
  })

  it('maxAgeMs より古い未読を省く (既定は 7 日)', async () => {
    let t = Date.parse('2026-10-01T00:00:00Z')
    const now = () => new Date(t)
    const { call, attach, send } = setup(new Hub(new Store({ now }), { now }))
    const a = await attach('x')
    await call('DELETE', `/attachments/${a.attachmentId}`)
    await send(to, 'old-1')
    await send(to, 'old-2')
    t += 7 * 24 * 60 * 60_000
    await send(to, 'new')
    t += 1
    const b = await attach('x')
    assert.equal(b.skipped, 2)
  })

  it('attach ごとに上書きでき、0 なら制限なし', async () => {
    const { call, attach, send } = setup(new Hub(new Store(), { unreadMax: 1 }))
    const a = await attach('x')
    await call('DELETE', `/attachments/${a.attachmentId}`)
    for (const body of ['1', '2', '3']) await send(to, body)
    assert.equal((await attach('x', { client: 'claude-code', maxUnread: 0 })).skipped, 0)
    assert.equal((await attach('x', { client: 'claude-code', maxUnread: 2 })).skipped, 1)
    assert.equal((await call('POST', '/mailboxes/x/attach', { client: 'claude-code', maxUnread: -1 })).status, 400)
  })
})

describe('takeover と detach', () => {
  it('新しい attach で旧 stream に terminated(superseded) を送って閉じる', async () => {
    const { app, attach } = setup()
    const a = await attach('rev-a')
    const res = await app.request(`/attachments/${a.attachmentId}/stream`, { headers: auth })
    const pending = collect(res, () => false)
    await new Promise((r) => setTimeout(r, 20))
    await attach('rev-a')
    const { events, closed } = await pending
    assert.ok(closed, 'stream は閉じる')
    const t = events.find((e) => e.event === 'terminated')
    assert.deepEqual(JSON.parse(t!.data), { reason: 'superseded' })
  })

  it('detach で stream を閉じ、以後その Attachment は 404。Mailbox は残る', async () => {
    const { app, call, attach, send } = setup()
    const a = await attach('rev-a')
    const res = await app.request(`/attachments/${a.attachmentId}/stream`, { headers: auth })
    const pending = collect(res, () => false)
    await new Promise((r) => setTimeout(r, 20))
    assert.equal((await call('DELETE', `/attachments/${a.attachmentId}`)).status, 200)
    const { events, closed } = await pending
    assert.ok(closed)
    assert.ok(!events.some((e) => e.event === 'terminated'), 'detach は自分から切ったので terminated は送らない')
    assert.equal((await call('POST', `/attachments/${a.attachmentId}/ack`, { upTo: 0 })).status, 404)
    assert.equal((await send({ type: 'mailbox', id: 'rev-a' }, 'b', { 'x-hub-attachment': a.attachmentId })).id, undefined)

    // detach 中に届いたものは未読に残る
    await send({ type: 'mailbox', id: 'rev-a' }, 'while-away')
    const b = await attach('rev-a')
    const back = await collect(await app.request(`/attachments/${b.attachmentId}/stream`, { headers: auth }), (evs) => messages(evs).length >= 1)
    assert.deepEqual(messages(back.events).map((m) => m.body), ['while-away'])
  })

  it('attach 済みの Attachment から送ると from が Mailbox になる', async () => {
    const { attach, send } = setup()
    const a = await attach('rev-a', { client: 'claude-code', role: 'reviewer' })
    const m = await send({ type: 'topic', id: 't' }, 'b', { 'x-hub-attachment': a.attachmentId })
    assert.deepEqual(m.from, { type: 'mailbox', id: 'rev-a', role: 'reviewer' })
  })
})

describe('リースと detached', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  interface Listed {
    name: string
    attachment: { attachmentId: string; leaseUntil: string } | null
    detached: { attachmentId: string; reason: string; detachedAt: string } | null
    takeover: { at: string; previous: { attachmentId: string; sessionId?: string } } | null
  }
  const listed = async (call: ReturnType<typeof setup>['call'], name: string) =>
    ((await (await call('GET', '/mailboxes')).json()) as { mailboxes: Listed[] }).mailboxes.find((mb) => mb.name === name)!

  it('heartbeat でリースを延ばし、応答に leaseUntil を返す。未知の Attachment は 404', async () => {
    let t = Date.parse('2026-10-17T00:00:00Z')
    const { call, attach } = setup(new Hub(new Store(), { now: () => new Date(t) }))
    const a = await attach('x')
    assert.equal(a.leaseUntil, '2026-10-17T00:02:00.000Z')
    t += 60_000
    const res = await call('POST', `/attachments/${a.attachmentId}/heartbeat`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { leaseUntil: '2026-10-17T00:03:00.000Z' })
    assert.equal((await listed(call, 'x')).attachment!.leaseUntil, '2026-10-17T00:03:00.000Z')
    const missing = await call('POST', '/attachments/at_missing/heartbeat')
    assert.equal(missing.status, 404)
    assert.equal(((await missing.json()) as { error: string }).error, 'attachment_not_found')
  })

  it('stream なしでリースが切れると detached (lease_expired) になり、未読は Mailbox に残る', async () => {
    const hub = new Hub(new Store(), { leaseMs: 80 })
    const ui: { event: string; data: unknown }[] = []
    hub.onUi((e) => ui.push(e))
    const { app, call, attach, send } = setup(hub)
    const a = await attach('x')
    await sleep(150)
    const mb = await listed(call, 'x')
    assert.equal(mb.attachment, null)
    assert.equal(mb.detached!.attachmentId, a.attachmentId)
    assert.equal(mb.detached!.reason, 'lease_expired')
    assert.ok(ui.some((e) => e.event === 'attachment.detached' && (e.data as { reason: string }).reason === 'lease_expired'))
    assert.equal((await call('POST', `/attachments/${a.attachmentId}/heartbeat`)).status, 404)

    await send({ type: 'mailbox', id: 'x' }, 'while-away')
    const b = await attach('x')
    assert.equal((await listed(call, 'x')).detached, null, 'attach し直すと detached は消える')
    const back = await collect(await app.request(`/attachments/${b.attachmentId}/stream`, { headers: auth }), (evs) => messages(evs).length >= 1)
    assert.deepEqual(messages(back.events).map((m) => m.body), ['while-away'])
  })

  it('heartbeat を続ければリースは切れない', async () => {
    const { call, attach } = setup(new Hub(new Store(), { leaseMs: 80 }))
    const a = await attach('x')
    for (let i = 0; i < 4; i++) {
      await sleep(40)
      assert.equal((await call('POST', `/attachments/${a.attachmentId}/heartbeat`)).status, 200)
    }
    assert.equal((await listed(call, 'x')).attachment!.attachmentId, a.attachmentId)
  })

  it('stream を開いている間は heartbeat がなくてもリースが切れない', async () => {
    const { app, call, attach } = setup(new Hub(new Store(), { leaseMs: 50 }))
    const a = await attach('x')
    const res = await app.request(`/attachments/${a.attachmentId}/stream`, { headers: auth })
    const { closed } = await collect(res, () => false, 200)
    assert.ok(!closed, 'stream は閉じない')
    // collect の終わりで stream を切ったので、ここからは切断の猶予 (既定 15 秒) の内にいる
    assert.equal((await listed(call, 'x')).attachment!.attachmentId, a.attachmentId)
  })

  it('detached の理由: DELETE は closed、stream が切れて猶予が過ぎたら disconnected', async () => {
    const { app, call, attach } = setup(new Hub(new Store(), { disconnectGraceMs: 30 }))
    const a = await attach('closed-mb')
    await call('DELETE', `/attachments/${a.attachmentId}`)
    assert.equal((await listed(call, 'closed-mb')).detached!.reason, 'closed')

    const b = await attach('lost-mb')
    await collect(await app.request(`/attachments/${b.attachmentId}/stream`, { headers: auth }), () => false, 50)
    await sleep(80)
    assert.equal((await listed(call, 'lost-mb')).detached!.reason, 'disconnected')
  })

  it('takeover で切り離された側は detached に残らず、takeover に旧 Attachment が出る', async () => {
    const { call, attach } = setup()
    const a = await attach('x', { client: 'claude-code', sessionId: 's-old' })
    assert.equal((await listed(call, 'x')).takeover, null, 'takeover でない attach では null')
    const b = await attach('x', { client: 'claude-code', sessionId: 's-new' })
    const mb = await listed(call, 'x')
    assert.equal(mb.attachment!.attachmentId, b.attachmentId)
    assert.equal(mb.detached, null)
    assert.equal(mb.takeover!.previous.attachmentId, a.attachmentId)
    assert.equal(mb.takeover!.previous.sessionId, 's-old')
    assert.ok(mb.takeover!.at)

    // takeover した Attachment が終わったら消え、detached に替わる
    await call('DELETE', `/attachments/${b.attachmentId}`)
    const after = await listed(call, 'x')
    assert.equal(after.takeover, null)
    assert.equal(after.detached!.attachmentId, b.attachmentId)
  })

  it('同じセッションの attach し直し (古い方が猶予中に残っていた) は takeover に出さない。sessionId がなければ出す', async () => {
    const { call, attach } = setup()
    await attach('x', { client: 'claude-code', sessionId: 's1' })
    await attach('x', { client: 'claude-code', sessionId: 's1' })
    assert.equal((await listed(call, 'x')).takeover, null)
    await attach('y', { client: 'other' })
    await attach('y', { client: 'other' })
    assert.ok((await listed(call, 'y')).takeover)
  })

  it('takeover の後継は購読と未読を引き継ぐ (受け入れ条件 3)', async () => {
    const { app, call, attach, send } = setup()
    const a = await attach('rev-a')
    assert.equal((await call('PUT', '/mailboxes/rev-a/subscriptions/review')).status, 200)
    const res = await app.request(`/attachments/${a.attachmentId}/stream`, { headers: auth })
    const pending = collect(res, () => false)
    await new Promise((r) => setTimeout(r, 20))
    await attach('rev-a')
    assert.ok((await pending).closed)

    // 旧が切り離された後に届いたトピック宛ても、後継の stream に出る
    const m = await send({ type: 'topic', id: 'review' }, 'after-takeover')
    const b = (await listed(call, 'rev-a')).attachment!
    const got = await collect(await app.request(`/attachments/${b.attachmentId}/stream`, { headers: auth }), (evs) => messages(evs).length >= 1)
    assert.deepEqual(messages(got.events).map((x) => x.id), [m.id])
  })
})

describe('Mailbox の削除', () => {
  it('トークンがなければ 401', async () => {
    const { app } = setup()
    assert.equal((await app.request('/mailboxes/x', { method: 'DELETE' })).status, 401)
  })

  it('接続していない Mailbox は消え、GET /mailboxes から外れる', async () => {
    const { call, attach } = setup()
    const at = await attach('x')
    assert.equal((await call('DELETE', `/attachments/${at.attachmentId}`)).status, 200)
    const res = await call('DELETE', '/mailboxes/x')
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), {})
    const list = (await (await call('GET', '/mailboxes')).json()) as { mailboxes: { name: string }[] }
    assert.equal(list.mailboxes.some((mb) => mb.name === 'x'), false)
  })

  it('接続中の Mailbox は 409 (mailbox_attached) で、削除されず残る', async () => {
    const { call, attach } = setup()
    await attach('x')
    const res = await call('DELETE', '/mailboxes/x')
    assert.equal(res.status, 409)
    const body = (await res.json()) as { error: string; message: string }
    assert.equal(body.error, 'mailbox_attached')
    assert.match(body.message, /detach/)
    const list = (await (await call('GET', '/mailboxes')).json()) as { mailboxes: { name: string; attachment: unknown }[] }
    const mb = list.mailboxes.find((x) => x.name === 'x')
    assert.ok(mb && mb.attachment !== null, 'still attached and present')
  })

  it('未知の名前は 404 で、エラーの形は他の route と同じ。不正な名前は 400', async () => {
    const { call } = setup()
    const res = await call('DELETE', '/mailboxes/nope')
    assert.equal(res.status, 404)
    const body = (await res.json()) as { error: string; message: string }
    assert.equal(body.error, 'mailbox_not_found')
    assert.equal(typeof body.message, 'string')
    assert.equal((await call('DELETE', '/mailboxes/Bad%20Name')).status, 400)
  })

  it('削除すると mailbox.deleted を UI に流す (payload は { name })', async () => {
    const hub = new Hub(new Store())
    const app = createApp({ hub, token: TOKEN, uiHtml: async () => null, heartbeatMs: 50 })
    const events: { event: string; data: unknown }[] = []
    hub.onUi((e) => events.push(e))
    const call = (method: string, path: string) => app.request(path, { method, headers: auth })
    const at = (await (await app.request('/mailboxes/x/attach', { method: 'POST', headers: auth, body: '{}' })).json()) as AttachResult
    await call('DELETE', `/attachments/${at.attachmentId}`)
    assert.equal((await call('DELETE', '/mailboxes/x')).status, 200)
    assert.deepEqual(events.filter((e) => e.event === 'mailbox.deleted'), [{ event: 'mailbox.deleted', data: { name: 'x' } }])
  })

  it('同名で作り直すと、削除前に届いていた直接宛ては再送されず、削除後の宛ては届く (topic 宛ても再送されない)', async () => {
    const { app, call, attach, send } = setup()
    const a1 = await attach('x')
    await call('PUT', '/mailboxes/x/subscriptions/news')
    await call('DELETE', `/attachments/${a1.attachmentId}`)
    const before = await send({ type: 'mailbox', id: 'x' }, 'before deletion')
    const topicBefore = await send({ type: 'topic', id: 'news' }, 'topic before deletion')
    assert.equal((await call('DELETE', '/mailboxes/x')).status, 200)
    const after = await send({ type: 'mailbox', id: 'x' }, 'after deletion')

    const a2 = await attach('x') // 作り直し (同名の自動作成)
    const res = await call('GET', `/attachments/${a2.attachmentId}/stream?after=0`)
    const first = await collect(res, (evs) => messages(evs).length >= 1, 300)
    assert.deepEqual(messages(first.events).map((m) => m.seq), [after.seq], 'only the post-deletion message is delivered')
    assert.ok(before.seq < after.seq && topicBefore.seq < after.seq)

    // 作り直したあとの宛ては届く (stream が開いたまま)
    const res2 = await call('GET', `/attachments/${a2.attachmentId}/stream?after=${after.seq}`)
    const live = collect(res2, (evs) => messages(evs).length >= 1, 800)
    const later = await send({ type: 'mailbox', id: 'x' }, 'after re-creation')
    assert.deepEqual(messages((await live).events).map((m) => m.seq), [later.seq])
  })
})

describe('受領の確認 (received / unconfirmed)', () => {
  const user = { type: 'user', id: 'browser', role: null } as const
  const toX = { type: 'mailbox', id: 'x' } as const

  it('渡しただけの ack は unconfirmed に数え、inbox の unconfirmed で取り直せる。received の ack で確認済みになる', () => {
    const hub = new Hub(new Store())
    const a = hub.attach('x', { client: 'claude-code' })
    const m1 = hub.postMessage({ kind: 'request', to: toX, body: 'one' }, user)
    const m2 = hub.postMessage({ kind: 'notice', to: toX, body: 'two' }, user)
    hub.ack(a.attachmentId, m2.seq)
    const mb = () => hub.describeMailboxes().find((d) => d.name === 'x')!
    assert.equal(mb().unread, 0)
    assert.equal(mb().unconfirmed, 2)

    assert.deepEqual(hub.inbox('x', 0, 20).messages, [], '既定では既読は返さない')
    const again = hub.inbox('x', 0, 20, true)
    assert.deepEqual(again.messages.map((m) => m.id), [m1.id, m2.id])
    assert.deepEqual(hub.ack(a.attachmentId, again.cursor, { first: m1.seq, last: m2.seq }), { cursor: m2.seq, received: m2.seq })
    assert.equal(mb().unconfirmed, 0)
  })

  it('返した範囲が received の直後から続いていなければ received を進めない (確認のない分を飛び越えない)', () => {
    const hub = new Hub(new Store())
    const a = hub.attach('x', { client: 'claude-code' })
    const handed = hub.postMessage({ kind: 'notice', to: toX, body: 'handed' }, user)
    hub.ack(a.attachmentId, handed.seq)
    const m = hub.postMessage({ kind: 'notice', to: toX, body: 'new' }, user)
    const r = hub.inbox('x', 0, 20)
    assert.deepEqual(r.messages.map((x) => x.id), [m.id])
    assert.deepEqual(hub.ack(a.attachmentId, r.cursor, { first: m.seq, last: m.seq }), { cursor: m.seq, received: 0 })
    assert.deepEqual(hub.store.unconfirmed('x').map((x) => x.id), [handed.id, m.id])
  })

  it('ack の received の範囲を検証する', async () => {
    const { call, attach } = setup()
    const a = await attach('x')
    assert.equal((await call('POST', `/attachments/${a.attachmentId}/ack`, { upTo: 1, received: { first: 2, last: 1 } })).status, 400)
    assert.equal((await call('POST', `/attachments/${a.attachmentId}/ack`, { upTo: 1, received: true })).status, 400)
  })

  it('自分宛ての Message に reply_to で返信すると、その seq まで受領の確認になる', () => {
    const hub = new Hub(new Store())
    const a = hub.attach('x', { client: 'claude-code' })
    hub.attach('y', { client: 'claude-code' })
    const m1 = hub.postMessage({ kind: 'request', to: toX, body: 'one' }, user)
    const other = hub.postMessage({ kind: 'request', to: { type: 'mailbox', id: 'y' }, body: 'for y' }, user)
    const m2 = hub.postMessage({ kind: 'notice', to: toX, body: 'two' }, user)
    hub.ack(a.attachmentId, m2.seq)

    // 自分宛てでない Message への返信は確認にしない
    hub.postMessage({ kind: 'reply', replyTo: other.id, body: 'not mine' }, hub.senderOf(a.attachmentId))
    assert.equal(hub.store.getMailbox('x')!.received, 0)

    hub.postMessage({ kind: 'reply', replyTo: m1.id, body: 'ok' }, hub.senderOf(a.attachmentId))
    assert.equal(hub.store.getMailbox('x')!.received, m1.seq)
    assert.deepEqual(hub.store.unconfirmed('x').map((m) => m.id), [m2.id])
  })

  it('attach で放棄した古い未読は確認待ちに数えない', () => {
    const hub = new Hub(new Store())
    for (const body of ['1', '2', '3']) hub.postMessage({ kind: 'notice', to: toX, body }, user)
    hub.store.ensureMailbox('x')
    const a = hub.attach('x', { client: 'claude-code', maxUnread: 1 })
    assert.equal(a.skipped, 2)
    assert.deepEqual(hub.store.unconfirmed('x'), [])
  })
})

describe('切断中の後継 (previous)', () => {
  it('前の Attachment ID を示した attach し直しは、後継がいれば 409 successor_attached で拒み、いなければ通す', async () => {
    const { call } = setup()
    const attachWith = (body: Record<string, unknown>) => call('POST', '/mailboxes/x/attach', { client: 'claude-code', ...body })
    const a = (await (await attachWith({})).json()) as AttachResult
    await call('DELETE', `/attachments/${a.attachmentId}`)
    const b = (await (await attachWith({})).json()) as AttachResult

    const back = await attachWith({ previous: a.attachmentId })
    assert.equal(back.status, 409)
    assert.equal(((await back.json()) as { error: string }).error, 'successor_attached')
    // 後継は切り離されていない
    assert.equal(((await (await call('GET', '/mailboxes')).json()) as { mailboxes: { attachment: { attachmentId: string } | null }[] }).mailboxes[0]!.attachment?.attachmentId, b.attachmentId)

    // 後継がいなければ通す (Hub の再起動・猶予切れの後の attach し直し)
    await call('DELETE', `/attachments/${b.attachmentId}`)
    assert.equal((await attachWith({ previous: a.attachmentId })).status, 200)
    // 前の ID を示さない attach (新しいセッション) は今どおり takeover する
    assert.equal((await attachWith({})).status, 200)
  })
})

describe('project (attach の cwd)', () => {
  const list = async (call: ReturnType<typeof setup>['call']) =>
    ((await (await call('GET', '/mailboxes')).json()) as { mailboxes: { name: string; project: string | null; projectChanged: { at: string; from: string } | null }[] }).mailboxes
  const one = async (call: ReturnType<typeof setup>['call'], name: string) => (await list(call)).find((m) => m.name === name)!

  it('attach の cwd を記録し、表記の揺れだけなら警告しない', async () => {
    const { call, attach } = setup()
    await attach('cairn.deployer', { client: 'claude-code', cwd: 'C:\\work\\cairn' })
    assert.equal((await one(call, 'cairn.deployer')).project, 'C:\\work\\cairn')
    await attach('cairn.deployer', { client: 'claude-code', cwd: 'c:/Work/Cairn/' })
    const mb = await one(call, 'cairn.deployer')
    assert.equal(mb.projectChanged, null)
    assert.equal(mb.project, 'c:/Work/Cairn/', '記録は新しい方に揃える')
  })

  it('違うフォルダからの attach は記録を更新し、前のフォルダを次の attach まで projectChanged に出す', async () => {
    const { call, attach } = setup()
    await attach('deployer', { client: 'claude-code', cwd: 'C:\\work\\cairn' })
    await attach('deployer', { client: 'claude-code', cwd: 'C:\\work\\agent-hub' })
    const mb = await one(call, 'deployer')
    assert.equal(mb.project, 'C:\\work\\agent-hub')
    assert.equal(mb.projectChanged?.from, 'C:\\work\\cairn')
    await attach('deployer', { client: 'claude-code', cwd: 'C:\\work\\agent-hub' })
    assert.equal((await one(call, 'deployer')).projectChanged, null)
  })

  it('cwd のない attach は project を変えない', async () => {
    const { call, attach } = setup()
    await attach('x', { client: 'claude-code', cwd: '/home/u/cairn' })
    await attach('x', { client: 'codex' })
    const mb = await one(call, 'x')
    assert.equal(mb.project, '/home/u/cairn')
    assert.equal(mb.projectChanged, null)
  })
})

describe('role 宛てのプロジェクトの範囲 (design.md §9-7)', () => {
  const post = async (call: ReturnType<typeof setup>['call'], to: unknown, headers: Record<string, string> = {}) => {
    const res = await call('POST', '/messages', { kind: 'request', to, body: 'x' }, headers)
    return { status: res.status, body: (await res.json()) as Message & { recipients: string[]; error?: string } }
  }

  async function team() {
    const s = setup()
    await s.attach('vcp.deployer', { client: 'claude-code', role: 'deployer', cwd: 'C:\\work\\vcp' })
    await s.attach('cairn.deployer', { client: 'claude-code', role: 'deployer', cwd: 'C:\\work\\cairn' })
    // 名前の規則を変える前の Mailbox (project なし)
    await s.call('POST', '/mailboxes/deployer/attach', { role: 'deployer' })
    const leader = await s.attach('vcp.leader', { client: 'claude-code', role: 'leader', cwd: 'c:/Work/VCP/' })
    return { ...s, leader }
  }

  it('エージェントの role 宛ては送り手のプロジェクトに絞り、to に project を残す', async () => {
    const { call, leader } = await team()
    const r = await post(call, { type: 'role', id: 'deployer' }, { 'x-hub-attachment': leader.attachmentId })
    assert.equal(r.status, 201)
    assert.deepEqual(r.body.recipients, ['vcp.deployer'], '表記の揺れは同じプロジェクトとみなす')
    assert.equal(r.body.to.project, 'c:/Work/VCP/')
  })

  it('明示の project はそのまま使い、ブラウザから project なしなら全体に届く', async () => {
    const { call, leader } = await team()
    const cross = await post(call, { type: 'role', id: 'deployer', project: 'C:\\work\\cairn' }, { 'x-hub-attachment': leader.attachmentId })
    assert.deepEqual(cross.body.recipients, ['cairn.deployer'])
    const all = await post(call, { type: 'role', id: 'deployer' })
    assert.deepEqual(all.body.recipients.sort(), ['cairn.deployer', 'deployer', 'vcp.deployer'])
    assert.equal(all.body.to.project, undefined)
    const scoped = await post(call, { type: 'role', id: 'deployer', project: 'C:/work/vcp' })
    assert.deepEqual(scoped.body.recipients, ['vcp.deployer'])
  })

  it('project のない送り手は絞らない。role 以外に project は付けられない', async () => {
    const { call, attach } = await team()
    const old = await attach('leader', { client: 'claude-code', role: 'leader' })
    const r = await post(call, { type: 'role', id: 'deployer' }, { 'x-hub-attachment': old.attachmentId })
    assert.equal(r.body.recipients.length, 3)
    for (const type of ['mailbox', 'topic']) {
      assert.equal((await post(call, { type, id: 'vcp.deployer', project: 'C:/work/vcp' })).status, 400)
    }
  })
})
