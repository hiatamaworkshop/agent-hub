import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Hub, HubError } from './hub.js'
import { Store } from './store.js'

// C103: a connected Mailbox refuses an attach from another folder (project); the same folder, a Mailbox with no live Attachment and an
// attach without cwd work as before. A refusal changes nothing
const A = 'C:\\work\\a'
const B = 'C:\\work\\b'

function setup() {
  return new Hub(new Store())
}

function refusedWith(f: () => unknown, code: string): HubError {
  let caught: unknown
  try {
    f()
  } catch (e) {
    caught = e
  }
  assert.ok(caught instanceof HubError, `expected a HubError, got ${String(caught)}`)
  assert.equal(caught.status, 409)
  assert.equal(caught.code, code)
  return caught
}

describe('attach from another folder (C103)', () => {
  it('refused while the Mailbox is connected from another folder: 409 project_mismatch, naming both folders and --mailbox, nothing changes', () => {
    const hub = setup()
    const first = hub.attach('app.deployer', { client: 'claude-code', cwd: A })
    const err = refusedWith(() => hub.attach('app.deployer', { client: 'claude-code', cwd: B }), 'project_mismatch')
    assert.ok(err.message.includes(A), 'names the folder that holds it')
    assert.ok(err.message.includes(B), 'names the folder that was refused')
    assert.ok(err.message.includes('--mailbox'), 'says how to start under another name')
    const mb = hub.store.getMailbox('app.deployer')!
    assert.equal(mb.attachment, first.attachmentId, 'the live Attachment is unchanged')
    assert.equal(mb.project, A, 'the project is unchanged')
    assert.equal(hub.describeMailboxes().find((m) => m.name === 'app.deployer')!.projectChanged, null, 'no projectChanged for a refusal')
  })

  it('a takeover from the same folder (differently written) still works', () => {
    const hub = setup()
    const first = hub.attach('app.deployer', { client: 'claude-code', cwd: A })
    const second = hub.attach('app.deployer', { client: 'claude-code', cwd: 'c:/Work/A/' })
    assert.notEqual(second.attachmentId, first.attachmentId)
    assert.equal(hub.store.getMailbox('app.deployer')!.attachment, second.attachmentId)
  })

  it('a Mailbox with no live Attachment accepts another folder, with the projectChanged warning as before', () => {
    const hub = setup()
    const first = hub.attach('app.deployer', { client: 'claude-code', cwd: A })
    hub.detach(first.attachmentId)
    hub.attach('app.deployer', { client: 'claude-code', cwd: B })
    const mb = hub.describeMailboxes().find((m) => m.name === 'app.deployer')!
    assert.equal(mb.project, B)
    assert.equal(mb.projectChanged?.from, A)
  })

  it('an attach without cwd is accepted while connected, and does not change the project', () => {
    const hub = setup()
    hub.attach('app.deployer', { client: 'claude-code', cwd: A })
    const again = hub.attach('app.deployer', { client: 'claude-code' })
    assert.equal(hub.store.getMailbox('app.deployer')!.attachment, again.attachmentId)
    assert.equal(hub.store.getMailbox('app.deployer')!.project, A)
  })

  it('a Mailbox with no project yet takes the first folder while connected', () => {
    const hub = setup()
    hub.attach('x', { client: 'claude-code' })
    const second = hub.attach('x', { client: 'claude-code', cwd: B })
    assert.equal(hub.store.getMailbox('x')!.project, B)
    assert.equal(hub.store.getMailbox('x')!.attachment, second.attachmentId)
  })
})
