import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Hub, HubError } from './hub.js'
import { Store } from './store.js'

// C181: a refusal with project_mismatch is kept per Mailbox (time, refused folder, holder folder, client) until the next successful attach
// or the Mailbox's deletion; the 409 carries the holder, the refused folder and the grace period the shim waits by; the page gets an event
const A = 'C:\\work\\a'
const B = 'C:\\work\\b'

function refused(f: () => unknown): HubError {
  try {
    f()
  } catch (e) {
    assert.ok(e instanceof HubError, String(e))
    return e
  }
  assert.fail('expected a refusal')
}

describe('attach refusal record (C181)', () => {
  it('a refused attach is kept with its time, folder, holder and client, returned by describeMailboxes, and announced to the page', () => {
    const hub = new Hub(new Store(), { disconnectGraceMs: 300, now: () => new Date('2026-11-21T10:00:00Z') })
    const events: { event: string; data: unknown }[] = []
    hub.onUi((e) => events.push(e))
    hub.attach('app.deployer', { client: 'claude-code', cwd: A })
    const err = refused(() => hub.attach('app.deployer', { client: 'antigravity-client', cwd: B }))
    assert.equal(err.code, 'project_mismatch')
    assert.deepEqual(err.details, { holder: A, refused: B, graceMs: 300 }, 'the 409 says what the shim needs to retry')
    const mb = hub.describeMailboxes().find((m) => m.name === 'app.deployer')!
    assert.deepEqual(mb.attachRefused, { at: '2026-11-21T10:00:00.000Z', folder: B, holder: A, client: 'antigravity-client' })
    assert.ok(events.some((e) => e.event === 'attachment.refused' && (e.data as { folder: string }).folder === B))
  })

  it('the next successful attach clears the record; a refusal again sets it again', () => {
    const hub = new Hub(new Store())
    const first = hub.attach('app.deployer', { client: 'claude-code', cwd: A })
    refused(() => hub.attach('app.deployer', { client: 'claude-code', cwd: B }))
    assert.notEqual(hub.describeMailboxes().find((m) => m.name === 'app.deployer')!.attachRefused, null)
    hub.detach(first.attachmentId)
    hub.attach('app.deployer', { client: 'claude-code', cwd: B })
    assert.equal(hub.describeMailboxes().find((m) => m.name === 'app.deployer')!.attachRefused, null, 'cleared by the successful attach')
  })

  it('a Mailbox with no refusal shows null, and deleting the Mailbox clears the record', () => {
    const hub = new Hub(new Store())
    hub.attach('app.deployer', { client: 'claude-code', cwd: A })
    assert.equal(hub.describeMailboxes().find((m) => m.name === 'app.deployer')!.attachRefused, null)
    refused(() => hub.attach('app.deployer', { client: 'claude-code', cwd: B }))
    const att = hub.store.getMailbox('app.deployer')!.attachment!
    hub.detach(att)
    hub.deleteMailbox('app.deployer')
    assert.equal(hub.describeMailboxes().find((m) => m.name === 'app.deployer'), undefined)
    hub.attach('app.deployer', { client: 'claude-code', cwd: B })
    assert.equal(hub.describeMailboxes().find((m) => m.name === 'app.deployer')!.attachRefused, null, 'a new Mailbox starts without the old record')
  })
})
