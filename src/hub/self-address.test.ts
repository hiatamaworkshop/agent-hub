import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Sender } from '../shared/types.js'
import { createApp } from './app.js'
import { Hub, HubError } from './hub.js'
import { Store } from './store.js'

// C192: a Mailbox does not send a Message to itself. The resolved address is checked, so a reply to its own Message with `to` omitted is
// refused as well. The refusal is 400 self_address; nothing is stored or delivered. Roles and topics that include the sender, and a human
// sender, are not affected.
// C195: the same refusal for an unedited forward (POST /messages/:id/forward, forwardMessage) from a Mailbox to its own address
//
const TOKEN = 'test-token-0123456789'
const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
const user: Sender = { type: 'user', id: 'browser', role: null }

function setup() {
  const hub = new Hub(new Store())
  const app = createApp({ hub, token: TOKEN, uiHtml: async () => null, heartbeatMs: 50 })
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    app.request('/messages', { method: 'POST', headers: { ...auth, ...headers }, body: JSON.stringify(body) })
  const count = () => hub.store.listMessages(0, 100000).length
  return { hub, app, post, count }
}

// Runs fn and returns the HubError it throws; fails if it does not throw a HubError
function refusalOf(fn: () => unknown): HubError {
  try {
    fn()
  } catch (e) {
    assert.ok(e instanceof HubError, String(e))
    return e
  }
  assert.fail('expected a refusal')
}

describe('a Mailbox does not send a Message to itself (C192)', () => {
  it('to set to the sender\'s own Mailbox is refused with 400 self_address, and nothing is stored', () => {
    const { hub, count } = setup()
    const a = hub.attach('a', { client: 'claude-code', role: 'leader' })
    const before = count()
    const err = refusalOf(() => hub.postMessage({ kind: 'request', to: { type: 'mailbox', id: 'a' }, body: 'to myself' }, hub.senderOf(a.attachmentId)))
    assert.equal(err.status, 400)
    assert.equal(err.code, 'self_address')
    assert.ok(err.message.includes('omit to'), err.message)
    assert.ok(err.message.includes('name another address'), err.message)
    assert.equal(count(), before, 'not stored')
    assert.equal(hub.store.getMailbox('a')!.received, 0, 'not received either')
  })

  it('a reply to the sender\'s own Message with to omitted is refused too (the resolved address is the sender)', async () => {
    const { hub, post, count } = setup()
    const a = hub.attach('a', { client: 'claude-code' })
    hub.attach('b', { client: 'claude-code' })
    // a asks b; a's own Message is the one it replies to, and omitting to resolves to a itself
    const own = hub.postMessage({ kind: 'request', to: { type: 'mailbox', id: 'b' }, body: 'a to b' }, hub.senderOf(a.attachmentId))
    const before = count()
    const res = await post({ kind: 'reply', replyTo: own.id, body: 'again' }, { 'x-hub-attachment': a.attachmentId })
    const err = (await res.json()) as { error: string; message: string }
    assert.equal(res.status, 400)
    assert.equal(err.error, 'self_address')
    assert.equal(count(), before, 'not stored')
    assert.equal(hub.store.getMailbox('b')!.received, 0, 'b received nothing from a\'s refused reply')
  })

  it('a Message to a role that includes the sender is still accepted (roles are out of scope)', () => {
    const { hub } = setup()
    const rev = hub.attach('rev-a', { client: 'claude-code', role: 'reviewer' })
    const sent = hub.postMessage({ kind: 'request', to: { type: 'role', id: 'reviewer' }, body: 'the reviewers' }, hub.senderOf(rev.attachmentId))
    assert.equal(sent.to.type, 'role')
    assert.equal(sent.to.id, 'reviewer')
  })

  it('a human sender is not affected: a Message from the person to a Mailbox of that name is accepted', () => {
    const { hub } = setup()
    hub.attach('a', { client: 'claude-code' })
    const sent = hub.postMessage({ kind: 'request', to: { type: 'mailbox', id: 'a' }, body: 'from the person' }, user)
    assert.equal(sent.from.type, 'user')
    assert.deepEqual(sent.to, { type: 'mailbox', id: 'a' })
  })
})

describe('an unedited forward is not sent by a Mailbox to itself (C195)', () => {
  // POST /messages/:id/forward through the HTTP route, as a Mailbox (X-Hub-Attachment) or the person (no header: the CLI sender in tests)
  const forward = (app: ReturnType<typeof setup>['app'], id: string, to: unknown, headers: Record<string, string> = {}) =>
    app.request(`/messages/${id}/forward`, { method: 'POST', headers: { ...auth, ...headers }, body: JSON.stringify({ to }) })

  it('a Mailbox forwarding a Message to its own mailbox is refused with 400 self_address; nothing is stored, delivered or read', async () => {
    const { hub, app, count } = setup()
    const a = hub.attach('a', { client: 'claude-code', role: 'leader' })
    const src = hub.postMessage({ kind: 'request', to: { type: 'mailbox', id: 'a' }, body: 'the body' }, user)
    const before = count()
    const unreadBefore = hub.store.unread('a').length
    const events: string[] = []
    hub.onUi((e) => events.push(e.event))
    const res = await forward(app, src.id, { type: 'mailbox', id: 'a' }, { 'x-hub-attachment': a.attachmentId })
    const err = (await res.json()) as { error: string; message: string }
    assert.equal(res.status, 400)
    assert.equal(err.error, 'self_address')
    assert.ok(err.message.includes('cannot forward'), err.message)
    assert.equal(count(), before, 'no new Message stored')
    assert.deepEqual(events, [], 'no SSE event (no message, no mailbox.acked)')
    assert.equal(hub.store.unread('a').length, unreadBefore, 'the unread count of a is unchanged')
    assert.equal(hub.store.getMailbox('a')!.received, 0, 'received is not advanced either')
  })

  it('the same refusal when the Mailbox calls forwardMessage directly (no HTTP layer)', () => {
    const { hub, count } = setup()
    const a = hub.attach('a', { client: 'claude-code' })
    const src = hub.postMessage({ kind: 'request', to: { type: 'mailbox', id: 'a' }, body: 'the body' }, user)
    const before = count()
    const err = refusalOf(() => hub.forwardMessage(src.id, { type: 'mailbox', id: 'a' }, hub.senderOf(a.attachmentId)))
    assert.equal(err.status, 400)
    assert.equal(err.code, 'self_address')
    assert.equal(count(), before, 'not stored')
  })

  it('a forward from a Mailbox to a role that includes it is still accepted', async () => {
    const { hub, app } = setup()
    const rev = hub.attach('rev-a', { client: 'claude-code', role: 'reviewer' })
    const src = hub.postMessage({ kind: 'request', to: { type: 'mailbox', id: 'rev-a' }, body: 'the body' }, user)
    const res = await forward(app, src.id, { type: 'role', id: 'reviewer' }, { 'x-hub-attachment': rev.attachmentId })
    const body = (await res.json()) as { to: { type: string; id: string }; from: { type: string; id: string } }
    assert.equal(res.status, 201)
    assert.deepEqual(body.to, { type: 'role', id: 'reviewer' })
    assert.equal(body.from.id, 'rev-a')
  })

  it('a forward from a Mailbox to a topic it subscribes to is still accepted', async () => {
    const { hub, app } = setup()
    const x = hub.attach('x', { client: 'claude-code' })
    hub.subscribe('x', 'news')
    const src = hub.postMessage({ kind: 'request', to: { type: 'mailbox', id: 'x' }, body: 'the body' }, user)
    const res = await forward(app, src.id, { type: 'topic', id: 'news' }, { 'x-hub-attachment': x.attachmentId })
    const body = (await res.json()) as { to: { type: string; id: string } }
    assert.equal(res.status, 201)
    assert.deepEqual(body.to, { type: 'topic', id: 'news' })
  })

  it('a human forward to a Mailbox of that name is accepted (the person is not affected)', () => {
    const { hub } = setup()
    hub.attach('a', { client: 'claude-code' })
    const src = hub.postMessage({ kind: 'request', to: { type: 'mailbox', id: 'a' }, body: 'the body' }, user)
    const copy = hub.forwardMessage(src.id, { type: 'mailbox', id: 'a' }, user)
    assert.equal(copy.from.type, 'user')
    assert.deepEqual(copy.to, { type: 'mailbox', id: 'a' })
  })
})
