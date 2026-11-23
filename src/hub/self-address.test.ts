import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Sender } from '../shared/types.js'
import { createApp } from './app.js'
import { Hub, HubError } from './hub.js'
import { Store } from './store.js'

// C192: a Mailbox does not send a Message to itself. The resolved address is checked, so a reply to its own Message with `to` omitted is
// refused as well. The refusal is 400 self_address; nothing is stored or delivered. Roles and topics that include the sender, and a human
// sender, are not affected
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
