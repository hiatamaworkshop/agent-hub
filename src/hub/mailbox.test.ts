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
    assert.deepEqual(await ack.json(), { cursor: m1.seq })

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

  it('cursor が進んだときだけ mailbox.acked を UI に流す (payload は { name, cursor })', async () => {
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
    assert.deepEqual(acked(), [{ event: 'mailbox.acked', data: { name: 'x', cursor: m1.seq } }])

    // 進まない ack (同じ値・後退) は流さない
    await call('POST', `/attachments/${a.attachmentId}/ack`, { upTo: m1.seq })
    await call('POST', `/attachments/${a.attachmentId}/ack`, { upTo: 0 })
    assert.equal(acked().length, 1)
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

  it('takeover で切り離された側は detached に残らない', async () => {
    const { call, attach } = setup()
    await attach('x')
    await attach('x')
    const mb = await listed(call, 'x')
    assert.notEqual(mb.attachment, null)
    assert.equal(mb.detached, null)
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
