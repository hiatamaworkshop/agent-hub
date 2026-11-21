import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'
import { serve, type ServerType } from '@hono/node-server'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createApp } from '../hub/app.js'
import { Hub } from '../hub/hub.js'
import { Store } from '../hub/store.js'
import { childEnv, tsNodeArgs } from '../test-child.js'

// C181: a refusal with project_mismatch is retried once, after the Hub's grace period plus a margin (2 s in the shim). The Hub's grace
// is shortened here (300 ms, so the wait is about 2.3 s), and the shim learns it from the 409 body
const TOKEN = 'test-token-0123456789'
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const GRACE_MS = 300

async function until<T>(f: () => T | undefined | false | Promise<T | undefined | false>, ms = 8000): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const v = await f()
    if (v !== undefined && v !== false) return v
    if (Date.now() > deadline) throw new Error('timeout')
    await new Promise((r) => setTimeout(r, 30))
  }
}

describe('shim: a refusal with project_mismatch is retried once (C181)', () => {
  let tmp: string
  let server: ServerType
  let hub: Hub
  let hubUrl = ''
  // the attach requests the Hub receives, per Mailbox (counted at the Hub, not in the shim)
  const attachPosts = new Map<string, number>()
  // the folder that holds the Mailbox (the live session), and the folder the shim is started in and is refused
  const holderFolder = () => join(tmp, 'holder')
  const refusedFolder = () => join(tmp, 'refused')

  before(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'shim-mismatch-'))
    hub = new Hub(new Store(), { disconnectGraceMs: GRACE_MS })
    const app = createApp({ hub, token: TOKEN, uiHtml: async () => null })
    const fetch = async (req: Request) => {
      const m = /^\/mailboxes\/([^/]+)\/attach$/.exec(new URL(req.url).pathname)
      if (req.method === 'POST' && m) attachPosts.set(m[1]!, (attachPosts.get(m[1]!) ?? 0) + 1)
      return app.fetch(req)
    }
    server = await new Promise<ServerType>((resolveServer) => {
      const s = serve({ fetch, hostname: '127.0.0.1', port: 0 }, (info) => {
        hubUrl = `http://127.0.0.1:${info.port}`
        resolveServer(s)
      })
    })
  })

  after(async () => {
    server.closeAllConnections()
    await new Promise((r) => server.close(r))
    await rm(tmp, { recursive: true, force: true })
  })

  // A shim started in refusedFolder for a Mailbox. connected settles when initialize is answered (or the attach is refused)
  function spawnShim(mailbox: string) {
    const client = new Client({ name: 'claude-code', version: '0' })
    const base = childEnv()
    for (const k of ['HUB_PROJECT', 'CLAUDE_PROJECT_DIR', 'HUB_MAILBOX', 'HUB_ROLE', 'CLAUDE_CODE_SESSION_ID']) delete base[k]
    const env = { ...base, HUB_URL: hubUrl, HUB_TOKEN: TOKEN, HUB_FILES_DIR: join(tmp, 'files'), HUB_MAILBOX: mailbox, CLAUDE_PROJECT_DIR: refusedFolder() }
    const transport = new StdioClientTransport({ command: process.execPath, args: [...tsNodeArgs(), join(ROOT, 'src/shim/main.ts')], cwd: ROOT, env, stderr: 'pipe' })
    return { client, connected: client.connect(transport) }
  }

  const mailboxOf = (name: string) => hub.describeMailboxes().find((m) => m.name === name)!

  const callText = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] }
    return { isError: r.isError ?? false, text: r.content[0]!.text }
  }

  it('the holder ends during the wait: the retry attaches after the grace period plus the margin, and the refusal record is cleared', async () => {
    const holder = hub.attach('ref-a.m', { client: 'claude-code', cwd: holderFolder() })
    const started = Date.now()
    const s = spawnShim('ref-a.m')
    try {
      // the first attempt is refused and recorded; then the holder's Attachment ends before the retry
      await until(() => mailboxOf('ref-a.m').attachRefused !== null)
      hub.detach(holder.attachmentId)
      await s.connected
      const waited = Date.now() - started
      // the retry comes after the grace period (300 ms) plus the 2 s margin, not at once
      assert.ok(waited >= 2000, `the shim waited for the old Attachment to end (${waited} ms)`)
      const who = JSON.parse((await callText(s.client, 'whoami')).text) as Record<string, unknown>
      assert.ok(who.attachmentId, 'attached on the retry')
      assert.equal(who.terminatedReason, null)
      assert.equal(who.project, resolve(refusedFolder()))
      assert.equal(mailboxOf('ref-a.m').attachRefused, null, 'the next successful attach clears the record')
    } finally {
      await s.client.close().catch(() => undefined)
    }
  })

  it('the holder stays: the second refusal stops the shim, every tool call and whoami name the Mailbox, the holder, this folder and both ways out, and there is no third attempt', async () => {
    const holder = hub.attach('ref-b.m', { client: 'claude-code', cwd: holderFolder() })
    attachPosts.delete('ref-b.m')
    const s = spawnShim('ref-b.m')
    try {
      await s.connected
      // right after initialize is answered: exactly two attach requests reached the Hub (the first and the one retry), and whoami
      // already says project_mismatch (the second refusal terminates the shim before run() starts)
      assert.equal(attachPosts.get('ref-b.m'), 2, 'exactly two attach requests reached the Hub')
      const immediate = JSON.parse((await callText(s.client, 'whoami')).text) as Record<string, unknown>
      assert.equal(immediate.terminatedReason, 'project_mismatch', 'right after the second refusal')
      assert.equal(immediate.state, 'terminated')
      // past initialized, when run() would start: still two, so run() made no third attempt
      await new Promise((r) => setTimeout(r, 700))
      assert.equal(attachPosts.get('ref-b.m'), 2, 'run() made no third attempt after initialized')
      // the terminated state with its note, for every tool call and for whoami
      const who = await until(async () => {
        const w = JSON.parse((await callText(s.client, 'whoami')).text) as Record<string, unknown>
        return w.terminatedReason === 'project_mismatch' ? w : undefined
      })
      assert.equal(who.attachmentId, null, 'stays unattached')
      const note = String(who.note)
      assert.ok(note.includes('ref-b.m'), 'names the Mailbox')
      assert.ok(note.includes(holderFolder()), 'names the folder that holds it')
      assert.ok(note.includes(refusedFolder()), 'names the refused folder')
      assert.match(note, /close the other session/)
      assert.match(note, /--mailbox <name>/)
      assert.match(note, /HUB_MAILBOX/)
      assert.deepEqual(who.mismatch, { mailbox: 'ref-b.m', holder: holderFolder(), refused: refusedFolder() })
      const tool = await callText(s.client, 'post_message', { kind: 'notice', body: 'x', to: 'topic:nobody' })
      assert.equal(tool.isError, true)
      assert.match(tool.text, /Two ways out/)
      assert.ok(tool.text.includes(holderFolder()) && tool.text.includes(refusedFolder()))
      // the Hub keeps the refusal, with the folder that was refused and the one that holds the Mailbox
      const rec = mailboxOf('ref-b.m').attachRefused!
      assert.equal(rec.folder, refusedFolder())
      assert.equal(rec.holder, holderFolder())
      assert.equal(attachPosts.get('ref-b.m'), 2, 'still two at the end: one retry and no more')
    } finally {
      hub.detach(holder.attachmentId)
      await s.client.close().catch(() => undefined)
    }
  })
})
