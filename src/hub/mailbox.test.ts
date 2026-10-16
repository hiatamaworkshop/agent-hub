import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Message } from '../shared/types.js'
import { createApp } from './app.js'
import { Hub, type AttachResult } from './hub.js'
import { Store } from './store.js'

const TOKEN = 'test-token-0123456789'
const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

function setup() {
  const app = createApp({ hub: new Hub(new Store()), token: TOKEN, uiHtml: async () => null, heartbeatMs: 50 })
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
