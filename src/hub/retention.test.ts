// 保存期間・手で消す操作・ログの詰め直し (design.md §3.14)
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import type { Address, HubEvent, Message } from '../shared/types.js'
import { createApp } from './app.js'
import { Hub } from './hub.js'
import { Store, type NewMessage } from './store.js'

const dir = mkdtempSync(join(tmpdir(), 'agent-hub-retention-'))
after(() => rmSync(dir, { recursive: true, force: true }))
let n = 0
const tmpFile = () => join(dir, `hub-${++n}.jsonl`)

const HOUR = 60 * 60_000
const BROWSER = { type: 'user', id: 'browser', role: null } as const

// 進められる時計。Message の ts は Store の now で決まる
function clock(start = Date.parse('2026-10-18T00:00:00Z')) {
  let t = start
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) }
}

function msg(to: Address, extra: Partial<NewMessage> = {}): NewMessage {
  return { kind: 'notice', from: BROWSER, to, body: 'b', ...extra }
}

const ids = (ms: Message[]) => ms.map((m) => m.id)

describe('Store: 自動で消してよい Message', () => {
  it('渡し終えて古いものだけ。未読・返信待ちの request・新しいものは残す', () => {
    const c = clock()
    const s = new Store({ now: c.now })
    s.ensureMailbox('a')
    const handed = s.appendMessage(msg({ type: 'mailbox', id: 'a' }))
    const unread = s.appendMessage(msg({ type: 'mailbox', id: 'a' }))
    s.advanceCursor('a', handed.seq)
    const toUser = s.appendMessage(msg({ type: 'user', id: 'browser' }))
    const nobody = s.appendMessage(msg({ type: 'topic', id: 'none' }))
    const pending = s.appendMessage(msg({ type: 'user', id: 'browser' }, { kind: 'request' }))
    const answered = s.appendMessage(msg({ type: 'user', id: 'browser' }, { kind: 'request' }))
    const reply = s.appendMessage(msg({ type: 'user', id: 'browser' }, { kind: 'reply', replyTo: answered.id }))
    c.advance(HOUR)
    const fresh = s.appendMessage(msg({ type: 'user', id: 'browser' }))

    const cutoff = c.now().getTime() - HOUR
    assert.deepEqual(ids(s.expiredMessages(cutoff)), [handed.id, toUser.id, nobody.id, answered.id, reply.id])
    assert.ok(!ids(s.expiredMessages(cutoff)).includes(unread.id))
    assert.ok(!ids(s.expiredMessages(cutoff)).includes(pending.id))
    assert.ok(!ids(s.expiredMessages(cutoff)).includes(fresh.id))
  })

  it('handed で受領の確認がない分も渡し終えた扱い', () => {
    const s = new Store()
    s.ensureMailbox('a')
    const m = s.appendMessage(msg({ type: 'mailbox', id: 'a' }))
    s.advanceCursor('a', m.seq)
    assert.equal(s.unconfirmed('a').length, 1)
    assert.deepEqual(ids(s.expiredMessages(Date.now() + 1)), [m.id])
  })
})

describe('Store: 削除と詰め直し', () => {
  it('削除の行は再起動後も効き、詰め直すと削除の行がなくなる', () => {
    const file = tmpFile()
    const s1 = new Store({ file })
    const a = s1.appendMessage(msg({ type: 'topic', id: 't' }))
    const b = s1.appendMessage(msg({ type: 'topic', id: 't' }))
    assert.equal(s1.deleteMessage(a.id), true)
    assert.equal(s1.deleteMessage(a.id), false)
    assert.deepEqual(ids(new Store({ file }).listMessages()), [b.id])

    assert.equal(s1.compact(), true)
    assert.equal(s1.compact(), false, '削除がなければ詰め直さない')
    assert.doesNotMatch(readFileSync(file, 'utf8'), /message\.delete/)
    assert.deepEqual(ids(new Store({ file }).listMessages()), [b.id])
  })

  it('まとめて消すと実際に消した id を返し、詰め直す前の再起動でも、削除の後に足した Message は残る', () => {
    const file = tmpFile()
    const s1 = new Store({ file })
    const a = s1.appendMessage(msg({ type: 'topic', id: 't' }))
    const b = s1.appendMessage(msg({ type: 'topic', id: 't' }))
    const c = s1.appendMessage(msg({ type: 'topic', id: 't' }))
    assert.deepEqual(s1.deleteMessages([a.id, 'm_unknown', a.id, c.id]), [a.id, c.id])
    assert.deepEqual(s1.deleteMessages([a.id]), [])
    const d = s1.appendMessage(msg({ type: 'topic', id: 't' }))
    s1.deleteMessages([b.id])
    assert.deepEqual(ids(s1.listMessages()), [d.id])
    const s2 = new Store({ file })
    assert.deepEqual(ids(s2.listMessages()), [d.id])
    assert.equal(s2.compact(), true, '再起動後も削除の行があれば詰め直す')
  })

  it('全部消して詰め直しても seq は巻き戻らない', () => {
    const file = tmpFile()
    const s1 = new Store({ file })
    const a = s1.appendMessage(msg({ type: 'topic', id: 't' }))
    const b = s1.appendMessage(msg({ type: 'topic', id: 't' }))
    s1.deleteMessage(a.id)
    s1.deleteMessage(b.id)
    s1.compact()
    const s2 = new Store({ file })
    assert.equal(s2.lastSeq, 2)
    assert.equal(s2.appendMessage(msg({ type: 'topic', id: 't' })).seq, 3)
  })

  it('詰め直しても Mailbox の状態 (role・購読・cursor・received・project・削除時点) と未読が変わらない', () => {
    const file = tmpFile()
    const roleSubscriptions = (role: string) => (role === 'reviewer' ? ['review'] : [])
    const s1 = new Store({ file, roleSubscriptions })
    const early = s1.appendMessage(msg({ type: 'topic', id: 'review' }))
    s1.ensureMailbox('rev', 'reviewer')
    s1.subscribe('rev', 'user.message')
    s1.setProject('rev', '/work/cairn')
    const m1 = s1.appendMessage(msg({ type: 'topic', id: 'review' }))
    const m2 = s1.appendMessage(msg({ type: 'topic', id: 'user.message' }))
    const m3 = s1.appendMessage(msg({ type: 'mailbox', id: 'rev' }))
    s1.advanceCursor('rev', m2.seq)
    s1.advanceReceived('rev', m1.seq)
    s1.ensureMailbox('gone')
    s1.appendMessage(msg({ type: 'mailbox', id: 'gone' }))
    s1.deleteMailbox('gone')
    s1.deleteMessage(early.id)
    s1.compact()

    const s2 = new Store({ file, roleSubscriptions })
    const mb = s2.getMailbox('rev')!
    assert.equal(mb.role, 'reviewer')
    assert.deepEqual(mb.subscriptions, ['user.message'])
    assert.equal(mb.cursor, m2.seq)
    assert.equal(mb.received, m1.seq)
    assert.equal(mb.project, '/work/cairn')
    assert.deepEqual(ids(s2.unread('rev')), [m3.id])
    assert.deepEqual(ids(s2.unconfirmed('rev')), [m2.id])
    // 作り直した Mailbox に削除前の直接宛ては届かない
    s2.ensureMailbox('gone')
    assert.deepEqual(s2.unread('gone'), [])
  })

  it('返信を消して詰め直しても、元の request は返信待ちに戻らない', () => {
    const file = tmpFile()
    const s1 = new Store({ file })
    const req = s1.appendMessage(msg({ type: 'user', id: 'browser' }, { kind: 'request' }))
    const rep = s1.appendMessage(msg({ type: 'user', id: 'browser' }, { kind: 'reply', replyTo: req.id }))
    s1.deleteMessage(rep.id)
    s1.compact()
    const s2 = new Store({ file })
    assert.equal(s2.isAwaitingReply(s2.getMessage(req.id)!), false)
  })

  it('Event を消すと、session の直前の Event は残っている中の最新になる', () => {
    const s = new Store()
    const ev = (id: string): HubEvent => ({ id, ts: new Date().toISOString(), kind: 'turn.end', source: 'claude-code', sessionId: 's1', mailbox: null, payload: {} }) as unknown as HubEvent
    s.addEvent(ev('e1'))
    s.addEvent(ev('e2'))
    s.deleteEvent('e2')
    assert.equal(s.lastEventOf('s1')?.id, 'e1')
  })
})

const TOKEN = 'test-token-0123456789'
const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

function setup(opts: { readRetentionMs?: number } = {}) {
  const c = clock()
  const store = new Store({ now: c.now })
  const hub = new Hub(store, { now: c.now, ...opts })
  const ui: { event: string; data: unknown }[] = []
  hub.onUi((e) => ui.push(e))
  const app = createApp({ hub, token: TOKEN, uiHtml: async () => null })
  const call = (method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) })
  const send = async (body: unknown) => (await (await call('POST', '/messages', body)).json()) as Message
  const list = async () => ((await (await call('GET', '/messages')).json()) as { messages: Message[] }).messages
  return { c, hub, store, call, send, list, ui }
}

describe('DELETE /messages/:id', () => {
  it('未読でも消し、一覧から外し、message.deleted を流す。未知の id は 404', async () => {
    const { call, send, list, ui } = setup()
    await call('POST', '/mailboxes/a/attach', { client: 'claude-code' })
    const m = await send({ kind: 'request', to: { type: 'mailbox', id: 'a' }, body: 'x' })
    assert.equal((await call('DELETE', `/messages/${m.id}`)).status, 200)
    assert.deepEqual(await list(), [])
    assert.deepEqual(ui.find((e) => e.event === 'message.deleted')?.data, { ids: [m.id] })
    const res = await call('DELETE', `/messages/${m.id}`)
    assert.equal(res.status, 404)
    assert.equal(((await res.json()) as { error: string }).error, 'message_not_found')
  })

  it('消した Message への replyTo は 400 reply_to_not_found', async () => {
    const { call, send } = setup()
    const m = await send({ kind: 'notice', to: { type: 'user', id: 'browser' }, body: 'x' })
    await call('DELETE', `/messages/${m.id}`)
    const res = await call('POST', '/messages', { kind: 'reply', replyTo: m.id, to: { type: 'user', id: 'browser' }, body: 'y' })
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as { error: string }).error, 'reply_to_not_found')
  })
})

describe('POST /messages/purge と保存期間の掃除', () => {
  it('purge は保存期間を待たず、渡し終えたものを消す。未読と返信待ちの request は残す', async () => {
    const { call, send, list } = setup()
    await call('POST', '/mailboxes/a/attach', { client: 'claude-code' })
    const unread = await send({ kind: 'notice', to: { type: 'mailbox', id: 'a' }, body: 'x' })
    const pending = await send({ kind: 'request', to: { type: 'user', id: 'browser' }, body: 'x' })
    await send({ kind: 'notice', to: { type: 'user', id: 'browser' }, body: 'x' })
    const res = (await (await call('POST', '/messages/purge')).json()) as { messages: number; events: number }
    assert.deepEqual(res, { messages: 1, events: 0 })
    assert.deepEqual(ids(await list()), [unread.id, pending.id])
  })

  it('sweep は保存期間を過ぎたものだけ消す。保存期間 0 なら消さない', async () => {
    const { c, hub, send, list } = setup({ readRetentionMs: 2 * HOUR })
    const old = await send({ kind: 'notice', to: { type: 'user', id: 'browser' }, body: 'x' })
    c.advance(HOUR)
    const recent = await send({ kind: 'notice', to: { type: 'user', id: 'browser' }, body: 'x' })
    c.advance(HOUR + 1)
    assert.deepEqual(hub.sweep(), { messages: 1, events: 0 })
    assert.deepEqual(ids(await list()), [recent.id])
    assert.notEqual(old.id, recent.id)

    const off = setup({ readRetentionMs: 0 })
    await off.send({ kind: 'notice', to: { type: 'user', id: 'browser' }, body: 'x' })
    off.c.advance(1000 * HOUR)
    assert.deepEqual(off.hub.sweep(), { messages: 0, events: 0 })
  })
})
