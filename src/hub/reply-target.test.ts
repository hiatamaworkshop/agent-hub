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
    assert.ok(err.message.includes('has no unanswered request received'), err.message)
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

  // C99: 「受け取った」は送った時点の受け手。送った後に今の状態が変わっても、受け取った依頼への返信は通る
  it('購読を外した後も、送った時点で購読していた Mailbox の返信は通る (C99)', async () => {
    const { hub, post } = setup()
    const x = hub.attach('x', { client: 'claude-code' })
    hub.subscribe('x', 'agent.main')
    const req = hub.postMessage({ kind: 'request', to: { type: 'topic', id: 'agent.main' }, body: 'x' }, user)
    hub.unsubscribe('x', 'agent.main')
    const res = await post({ kind: 'reply', replyTo: req.id, body: 'ok' }, { 'x-hub-attachment': x.attachmentId })
    assert.equal(res.status, 201)
  })

  it('別の role で attach し直した後も、送った時点の role 宛ての依頼への返信は通る (C99)', async () => {
    const { hub, post } = setup()
    const rev = hub.attach('rev', { client: 'claude-code', role: 'reviewer' })
    const req = hub.postMessage({ kind: 'request', to: { type: 'role', id: 'reviewer' }, body: 'review' }, user)
    const again = hub.attach('rev', { client: 'claude-code', role: 'deployer' })
    const res = await post({ kind: 'reply', replyTo: req.id, body: 'ok' }, { 'x-hub-attachment': again.attachmentId })
    assert.equal(res.status, 201)
  })

  it('別の cwd で attach し直した後も、送った時点の project の role 宛ての依頼への返信は通る (C99)', async () => {
    const { hub, post } = setup()
    const rev = hub.attach('rev', { client: 'claude-code', role: 'reviewer', cwd: 'C:\\work\\a' })
    const req = hub.postMessage({ kind: 'request', to: { type: 'role', id: 'reviewer', project: 'C:\\work\\a' }, body: 'review' }, user)
    // 接続中の Mailbox には別のフォルダから attach できない (C103)。切れてから別のフォルダで attach し直す
    hub.detach(rev.attachmentId)
    const again = hub.attach('rev', { client: 'claude-code', role: 'reviewer', cwd: 'C:\\work\\b' })
    const res = await post({ kind: 'reply', replyTo: req.id, body: 'ok' }, { 'x-hub-attachment': again.attachmentId })
    assert.equal(res.status, 201)
  })

  it('送った時点で受け手でなかった Mailbox は、後から同じ role になっても refuse される (C99)', async () => {
    const { hub, post } = setup()
    const req = hub.postMessage({ kind: 'request', to: { type: 'role', id: 'reviewer' }, body: 'review' }, user)
    const late = hub.attach('late', { client: 'claude-code', role: 'reviewer' })
    const res = await post({ kind: 'reply', replyTo: req.id, body: 'ok' }, { 'x-hub-attachment': late.attachmentId })
    const err = (await res.json()) as { error: string }
    assert.equal(res.status, 400)
    assert.equal(err.error, 'reply_not_received')
  })

  // C113: 送り手が自分の依頼に、未接続 (unattached) の role 宛てで返信して閉じる (leader が reviewer を待たずに進めた場合)。refuse されず、依頼が閉じ、返信は未読で届く
  it('自分の依頼へ、unattached な role 宛てに返信して閉じる: 通り、outgoing と待ちが外れ、その Mailbox に未読で届く (C113)', async () => {
    const { hub, post } = setup()
    const lead = hub.attach('lead', { client: 'claude-code', role: 'leader' })
    const rev = hub.attach('rev', { client: 'claude-code', role: 'reviewer' })
    hub.detach(rev.attachmentId)
    assert.ok(!hub.store.getMailbox('rev')!.attachment, 'rev は未接続 (unattached)')
    const req = hub.postMessage({ kind: 'request', to: { type: 'role', id: 'reviewer' }, body: 'review C1' }, hub.senderOf(lead.attachmentId))
    assert.equal(hub.store.isAwaitingReply(req), true)
    assert.equal(hub.describeMailboxes().find((d) => d.name === 'lead')!.backlog.outgoing.count, 1)

    const res = await post({ kind: 'reply', replyTo: req.id, to: { type: 'role', id: 'reviewer' }, body: 'went on without a reviewer' }, { 'x-hub-attachment': lead.attachmentId })
    assert.equal(res.status, 201, await res.clone().text())
    const reply = (await res.json()) as Message
    assert.equal(reply.replyTo, req.id)
    assert.equal(hub.store.isAwaitingReply(req), false, '依頼は閉じる')
    assert.equal(hub.describeMailboxes().find((d) => d.name === 'lead')!.backlog.outgoing.count, 0, '送り手の outgoing から外れる')
    assert.deepEqual(hub.store.unread('rev').map((m) => m.id), [req.id, reply.id], '再接続したときに、依頼と取り下げの返信が未読で届く')
  })

  it('購読を外した後も、受け取った未返信の依頼は案内に出る (oldestOpenRequestTo と同じ受け手)', async () => {
    const { hub, post } = setup()
    const x = hub.attach('x', { client: 'claude-code' })
    hub.attach('other', { client: 'claude-code' })
    hub.subscribe('x', 'agent.main')
    const req = hub.postMessage({ kind: 'request', to: { type: 'topic', id: 'agent.main' }, body: 'x' }, user)
    hub.unsubscribe('x', 'agent.main')
    const unrelated = hub.postMessage({ kind: 'request', to: { type: 'mailbox', id: 'other' }, body: 'y' }, user)
    assert.equal(hub.store.oldestOpenRequestTo('x')?.id, req.id)
    // x は unrelated を受け取っていないので refuse され、案内に req が出る
    const res = await post({ kind: 'reply', replyTo: unrelated.id, body: 'ok' }, { 'x-hub-attachment': x.attachmentId })
    const err = (await res.json()) as { error: string; message: string }
    assert.equal(err.error, 'reply_not_received')
    assert.ok(err.message.includes(`#${req.seq}`), err.message)
  })
})

// C114: 送った後に渡された Mailbox も受け取った分として返信でき、案内に名前が出て、後の Message で閉じる
describe('送った後に渡された Mailbox (C114)', () => {
  const P = 'C:\work\p'
  const Q = 'C:\work\q'

  it('cwd なしで attach した Mailbox が、role @ project の依頼の後にその cwd で attach すると返信できる', async () => {
    const { hub, post } = setup()
    const lead = hub.attach('p.leader', { client: 'claude-code', role: 'leader', cwd: P })
    hub.attach('p.deployer', { client: 'claude-code', role: 'deployer' })
    const req = hub.postMessage({ kind: 'request', to: { type: 'role', id: 'deployer', project: P }, body: 'work' }, hub.senderOf(lead.attachmentId))
    const dep = hub.attach('p.deployer', { client: 'claude-code', role: 'deployer', cwd: P })
    assert.equal(hub.store.oldestOpenRequestTo('p.deployer')?.id, req.id, '案内に出る')
    const res = await post({ kind: 'reply', replyTo: req.id, body: 'done' }, { 'x-hub-attachment': dep.attachmentId })
    assert.equal(res.status, 201, await res.text())
    assert.equal(hub.store.isAwaitingReply(req), false)
  })

  it('フォルダを移した Mailbox が、新しいフォルダへの role @ project の依頼の後に付け直すと、後の Message で依頼が閉じる', () => {
    const { hub } = setup()
    const lead = hub.attach('m.leader', { client: 'claude-code', role: 'leader', cwd: Q })
    const old = hub.attach('m.deployer', { client: 'claude-code', role: 'deployer', cwd: P })
    hub.detach(old.attachmentId)
    const req = hub.postMessage({ kind: 'request', to: { type: 'role', id: 'deployer', project: Q }, body: 'work' }, hub.senderOf(lead.attachmentId))
    const dep = hub.attach('m.deployer', { client: 'claude-code', role: 'deployer', cwd: Q })
    assert.equal(hub.store.oldestOpenRequestTo('m.deployer')?.id, req.id)
    // replyTo なしの、送り手宛ての後の Message で閉じる (C28)
    hub.postMessage({ kind: 'request', to: { type: 'mailbox', id: 'm.leader' }, body: 'report' }, hub.senderOf(dep.attachmentId))
    assert.equal(hub.store.isAwaitingReply(req), false)
  })

  it('一度も受け手でなかった Mailbox は今も拒まれる (project のない role 宛ての後に作られた同じ role)', async () => {
    const { hub, post } = setup()
    const req = hub.postMessage({ kind: 'request', to: { type: 'role', id: 'deployer' }, body: 'x' }, user)
    hub.attach('lead', { client: 'claude-code', role: 'leader' })
    const late = hub.attach('late', { client: 'claude-code', role: 'deployer' })
    const res = await post({ kind: 'reply', replyTo: req.id, body: 'r' }, { 'x-hub-attachment': late.attachmentId })
    assert.equal(res.status, 400)
  })
})
