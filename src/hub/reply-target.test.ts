import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Message, Sender } from '../shared/types.js'
import { createApp } from './app.js'
import { Hub } from './hub.js'
import { Store } from './store.js'

// C86: 送り手の Mailbox の返信は、replyTo の Message をその Mailbox が受け取っているか、自分が送ったものでなければ 400 reply_not_received。
// 人 (user) の返信は制限しない。何も保存・配信しない
const TOKEN = 'test-token-0123456789'
const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
const user: Sender = { type: 'user', id: 'browser', role: null }

function setup() {
  const hub = new Hub(new Store())
  const app = createApp({ hub, token: TOKEN, uiHtml: async () => null, heartbeatMs: 50 })
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    app.request('/messages', { method: 'POST', headers: { ...auth, ...headers }, body: JSON.stringify(body) })
  const count = () => hub.store.listMessages(0, 100000).length
  return { hub, post, count }
}

describe('返信の replyTo は、受け取った Message か自分の Message に限る (C86)', () => {
  it('C80 の場合: deployer が leader の依頼でなく user の依頼 (leader 宛て) に返信すると 400 で、何も保存されない', async () => {
    const { hub, post, count } = setup()
    const lead = hub.attach('lead', { client: 'claude-code', role: 'leader' })
    const dep = hub.attach('dep', { client: 'claude-code', role: 'deployer' })
    const toLead = hub.postMessage({ kind: 'request', to: { type: 'mailbox', id: 'lead' }, body: 'user の依頼' }, user)
    const toDep = hub.postMessage({ kind: 'request', to: { type: 'mailbox', id: 'dep' }, body: 'leader の依頼' }, hub.senderOf(lead.attachmentId))
    const before = count()

    const res = await post({ kind: 'reply', replyTo: toLead.id, body: '報告' }, { 'x-hub-attachment': dep.attachmentId })
    const err = (await res.json()) as { error: string; message: string }
    assert.equal(res.status, 400)
    assert.equal(err.error, 'reply_not_received')
    assert.ok(err.message.includes(`#${toDep.seq}`), '最も古い受け取った依頼の seq を名指す')
    assert.ok(err.message.includes(toDep.id), '送り直せるように id も出す')
    assert.ok(err.message.includes('mailbox:lead'), '送り手も出す')
    assert.equal(count(), before, '保存されない')
    assert.equal(hub.store.getMailbox('dep')!.received, 0, '受領の確認も進まない')
  })

  it('受け取った依頼がなければ、そう言う (返信先の案内は出さず、to を指定するよう示す)', async () => {
    const { hub, post } = setup()
    const other = hub.attach('other', { client: 'claude-code' })
    const empty = hub.attach('empty', { client: 'claude-code' })
    const req = hub.postMessage({ kind: 'request', to: { type: 'mailbox', id: 'other' }, body: 'x' }, hub.senderOf(other.attachmentId))
    const res = await post({ kind: 'reply', replyTo: req.id, body: 'r' }, { 'x-hub-attachment': empty.attachmentId })
    const err = (await res.json()) as { error: string; message: string }
    assert.equal(res.status, 400)
    assert.equal(err.error, 'reply_not_received')
    assert.ok(err.message.includes('未返信の依頼はない'), err.message)
  })

  it('人 (user) の返信は制限しない: 受け取っていない Mailbox 宛てでも通る', () => {
    const { hub } = setup()
    hub.attach('x', { client: 'claude-code' })
    const req = hub.postMessage({ kind: 'request', to: { type: 'mailbox', id: 'x' }, body: 'x' }, user)
    const reply = hub.postMessage({ kind: 'reply', replyTo: req.id, to: { type: 'mailbox', id: 'y' }, body: 'human' }, user)
    assert.equal(reply.replyTo, req.id)
  })

  it('名前で送られた依頼への返信は受け付ける', async () => {
    const { hub, post } = setup()
    const x = hub.attach('x', { client: 'claude-code' })
    const req = hub.postMessage({ kind: 'request', to: { type: 'mailbox', id: 'x' }, body: 'x' }, user)
    const res = await post({ kind: 'reply', replyTo: req.id, body: 'ok' }, { 'x-hub-attachment': x.attachmentId })
    assert.equal(res.status, 201)
  })

  it('自分の role 宛ての依頼への返信は受け付ける', async () => {
    const { hub, post } = setup()
    const rev = hub.attach('rev-a', { client: 'claude-code', role: 'reviewer' })
    const req = hub.postMessage({ kind: 'request', to: { type: 'role', id: 'reviewer' }, body: 'review' }, user)
    const res = await post({ kind: 'reply', replyTo: req.id, body: 'ok' }, { 'x-hub-attachment': rev.attachmentId })
    assert.equal(res.status, 201)
  })

  it('転送で受け取った写しへの返信は受け付ける (写しは受け取った人宛て)', () => {
    const { hub } = setup()
    const z = hub.attach('z', { client: 'claude-code' })
    const src = hub.postMessage({ kind: 'request', to: { type: 'mailbox', id: 'x' }, body: 'src' }, user)
    const copy = hub.forwardMessage(src.id, { type: 'mailbox', id: 'z' }, user)
    const reply = hub.postMessage({ kind: 'reply', replyTo: copy.id, to: { type: 'user', id: 'browser' }, body: 'ok' }, hub.senderOf(z.attachmentId))
    assert.equal(reply.replyTo, copy.id)
  })

  it('自分が送った Message への返信は受け付ける', async () => {
    const { hub, post } = setup()
    const x = hub.attach('x', { client: 'claude-code' })
    hub.attach('y', { client: 'claude-code' })
    const xs = hub.senderOf(x.attachmentId)
    const sent = hub.postMessage({ kind: 'notice', to: { type: 'mailbox', id: 'y' }, body: 'from x' }, xs)
    const res = await post({ kind: 'reply', replyTo: sent.id, to: { type: 'mailbox', id: 'y' }, body: 'follow-up' }, { 'x-hub-attachment': x.attachmentId })
    assert.equal(res.status, 201)
  })

  it('takeover の後も同じ Mailbox 名なので、切り替え前に受け取った依頼への返信は受け付ける', async () => {
    const { hub, post } = setup()
    const old = hub.attach('x', { client: 'claude-code', sessionId: 's-old' })
    const req = hub.postMessage({ kind: 'request', to: { type: 'mailbox', id: 'x' }, body: 'before takeover' }, user)
    const next = hub.attach('x', { client: 'claude-code', sessionId: 's-new' })
    assert.notEqual(next.attachmentId, old.attachmentId)
    const res = await post({ kind: 'reply', replyTo: req.id, body: 'done' }, { 'x-hub-attachment': next.attachmentId })
    assert.equal(res.status, 201)
  })
})
