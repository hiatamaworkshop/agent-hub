import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { describe, it } from 'node:test'
import { serve, type ServerType } from '@hono/node-server'
import { createApp } from '../hub/app.js'
import { Hub } from '../hub/hub.js'
import { Store } from '../hub/store.js'
import { HubClient } from './hub-client.js'

// C103: the shim is refused an attach (409 project_mismatch) when the Mailbox is connected from another folder. It stops, says why
// (the log line and the state), and does not retry in silence
const TOKEN = 'test-token-0123456789'

describe('HubClient: refused because the Mailbox is connected from another folder (C103)', () => {
  it('stops at once with terminatedReason project_mismatch, logs the Hub message, and leaves the first session connected', async () => {
    const hub = new Hub(new Store())
    const app = createApp({ hub, token: TOKEN, uiHtml: async () => null })
    let hubUrl = ''
    const server: ServerType = await new Promise((resolve) => {
      const s = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, (info) => {
        hubUrl = `http://127.0.0.1:${info.port}`
        resolve(s)
      })
    })
    const first = hub.attach('app.deployer', { client: 'claude-code', cwd: 'C:\\work\\a' })
    const logs: string[] = []
    const cfg = { hubUrl, token: TOKEN, mailbox: 'app.deployer', role: null, sessionId: undefined, cwd: 'C:\\work\\b', filesDir: tmpdir() }
    const hc = new HubClient(cfg, async () => undefined, (msg) => logs.push(msg))
    const until = async (f: () => boolean, ms = 10_000) => {
      const deadline = Date.now() + ms
      while (!f()) {
        if (Date.now() > deadline) throw new Error('timeout')
        await new Promise((r) => setTimeout(r, 30))
      }
    }
    try {
      hc.start()
      await until(() => hc.state === 'terminated')
      assert.equal(hc.terminatedReason, 'project_mismatch')
      assert.ok(hc.lastError?.includes('C:\\work\\a'), 'the Hub message names the folder that holds it')
      assert.ok(logs.some((l) => l.includes('project_mismatch')), 'written to the log (stderr in the shim)')
      assert.equal(hub.store.getMailbox('app.deployer')!.attachment, first.attachmentId, 'the first session is not cut off')
    } finally {
      await hc.stop()
      server.closeAllConnections()
      await new Promise((r) => server.close(r))
    }
  })
})
