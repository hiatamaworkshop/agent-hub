import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Hub } from './hub.js'
import { Store } from './store.js'

// C183: GET /mailboxes gives backlog.lastToUser, the seq and time of the latest Message this Mailbox sent to the person. The body is not
// read or sent (the Hub does not process bodies; the page reads the report's sections)
const sender = { type: 'mailbox', id: 'lt.deployer', role: null } as const
const person = { type: 'user', id: 'browser', role: null } as const

function backlogOf(hub: Hub) {
  return hub.describeMailboxes().find((m) => m.name === 'lt.deployer')!.backlog
}

describe('backlog.lastToUser (C183)', () => {
  it('null until the Mailbox has sent the person a Message; then the latest one, with its seq and time only', () => {
    const hub = new Hub(new Store())
    hub.attach('lt.deployer', { client: 'claude-code', cwd: 'C:\\work\\lt' })
    assert.equal(backlogOf(hub).lastToUser, null)
    hub.postMessage({ kind: 'notice', to: { type: 'mailbox', id: 'lt.leader' }, body: 'to a mailbox, not the person' }, sender)
    assert.equal(backlogOf(hub).lastToUser, null, 'a Message to a Mailbox does not count')
    const first = hub.postMessage({ kind: 'reply', to: { type: 'user', id: 'browser' }, body: 'NEEDS DECISION: A or B' }, sender)
    const got = backlogOf(hub).lastToUser!
    assert.deepEqual(Object.keys(got).sort(), ['seq', 'ts'], 'no body, no id: the Hub only points at the Message')
    assert.equal(got.seq, first.seq)
    assert.equal(got.ts, first.ts)
  })

  it('a newer Message to the person moves it on; a Message from the person does not', () => {
    const hub = new Hub(new Store())
    hub.attach('lt.deployer', { client: 'claude-code', cwd: 'C:\\work\\lt' })
    const first = hub.postMessage({ kind: 'reply', to: { type: 'user', id: 'browser' }, body: 'one' }, sender)
    hub.postMessage({ kind: 'request', to: { type: 'mailbox', id: 'lt.deployer' }, body: 'from the person' }, person)
    assert.equal(backlogOf(hub).lastToUser!.seq, first.seq, 'the person writing does not change what the Mailbox last sent them')
    const second = hub.postMessage({ kind: 'reply', to: { type: 'user', id: 'browser' }, body: 'two' }, sender)
    assert.equal(backlogOf(hub).lastToUser!.seq, second.seq)
  })

  it('when the latest Message is deleted, the one before it is found again', () => {
    const hub = new Hub(new Store())
    hub.attach('lt.deployer', { client: 'claude-code', cwd: 'C:\\work\\lt' })
    const first = hub.postMessage({ kind: 'reply', to: { type: 'user', id: 'browser' }, body: 'one' }, sender)
    const second = hub.postMessage({ kind: 'reply', to: { type: 'user', id: 'browser' }, body: 'two' }, sender)
    hub.deleteMessage(second.id)
    assert.equal(backlogOf(hub).lastToUser!.seq, first.seq)
    hub.deleteMessage(first.id)
    assert.equal(backlogOf(hub).lastToUser, null)
  })
})
