import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'
import { serve, type ServerType } from '@hono/node-server'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createApp } from '../hub/app.js'
import { Hub } from '../hub/hub.js'
import { Store } from '../hub/store.js'
import { childEnv, tsNodeArgs } from '../test-child.js'
import { HubClient } from './hub-client.js'

// C185: an attach refused with 400 (an invalid body, or a role that roles.json does not define) or 401 (the token) is not retried.
// The shim stays unattached, says why (whoami and every tool call), and logs the refusal once. 404, 409 and 5xx are unchanged.
const TOKEN = 'test-token-0123456789'
const ROOT = fileURLToPath(new URL('../..', import.meta.url))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function until<T>(f: () => T | undefined | false | Promise<T | undefined | false>, ms = 8000): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const v = await f()
    if (v !== undefined && v !== false) return v
    if (Date.now() > deadline) throw new Error('timeout')
    await sleep(30)
  }
}

// A stand-in Hub that answers every attach with the given status and body, and counts the attach requests it gets
async function fakeHub(status: number, body: unknown) {
  let attempts = 0
  const fetch = async (req: Request) => {
    if (req.method === 'POST' && /^\/mailboxes\/[^/]+\/attach$/.test(new URL(req.url).pathname)) {
      attempts++
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json' } })
  }
  let url = ''
  const server: ServerType = await new Promise((resolve) => {
    const s = serve({ fetch, hostname: '127.0.0.1', port: 0 }, (info) => {
      url = `http://127.0.0.1:${info.port}`
      resolve(s)
    })
  })
  return {
    url,
    attempts: () => attempts,
    close: async () => {
      server.closeAllConnections()
      await new Promise((r) => server.close(r))
    },
  }
}

function cfgFor(hubUrl: string, token = TOKEN) {
  return { hubUrl, token, mailbox: 'x.tester', role: 'tester', sessionId: undefined, cwd: 'C:\\work\\x', projectSource: 'cwd' as const, mailboxGiven: true, filesDir: tmpdir() }
}

describe('HubClient: an attach refused with 400 is not retried (C185)', () => {
  it('unknown_role: one attach, terminated as refused with the Hub code and message, logged once, and no retry over the backoffs', async () => {
    const hub = await fakeHub(400, { error: 'unknown_role', message: 'role tester is not in roles.json' })
    const logs: string[] = []
    const hc = new HubClient(cfgFor(hub.url), async () => undefined, (m) => logs.push(m))
    try {
      hc.start()
      await until(() => hc.state === 'terminated')
      await sleep(2500) // the backoff would have retried at about 1 s and 3 s
      assert.equal(hub.attempts(), 1, 'one attach, no retry')
      assert.equal(hc.terminatedReason, 'refused')
      assert.deepEqual(hc.refusal, { status: 400, code: 'unknown_role', message: 'role tester is not in roles.json' })
      assert.equal(hc.attachment, undefined, 'stays unattached')
      assert.equal(logs.length, 1, 'the refusal is logged once')
      assert.ok(logs[0]!.includes('unknown_role') && logs[0]!.includes('role tester is not in roles.json'), logs[0])
    } finally {
      await hc.stop()
      await hub.close()
    }
  })

  it('primeAttach refused the same way: the start after it makes no attach, and the refusal is logged once', async () => {
    const hub = await fakeHub(400, { error: 'unknown_role', message: 'role tester is not in roles.json' })
    const logs: string[] = []
    const hc = new HubClient(cfgFor(hub.url), async () => undefined, (m) => logs.push(m))
    try {
      assert.equal(await hc.primeAttach(5000), undefined)
      hc.start()
      await sleep(2500)
      assert.equal(hub.attempts(), 1, 'the primed attach was the only one')
      assert.equal(hc.terminatedReason, 'refused')
      assert.equal(logs.length, 1, 'no second line from primeAttach')
    } finally {
      await hc.stop()
      await hub.close()
    }
  })
})

describe('HubClient: an attach refused with 401 is not retried (C185)', () => {
  it('a wrong token: one attach, terminated as refused with status 401 and no Hub message, logged once', async () => {
    const hub = await fakeHub(401, { error: 'unauthorized' })
    const logs: string[] = []
    const hc = new HubClient(cfgFor(hub.url, 'wrong-token-0123456789'), async () => undefined, (m) => logs.push(m))
    try {
      hc.start()
      await until(() => hc.state === 'terminated')
      await sleep(2500)
      assert.equal(hub.attempts(), 1, 'one attach, no retry')
      assert.equal(hc.terminatedReason, 'refused')
      assert.deepEqual(hc.refusal, { status: 401, code: 'unauthorized', message: '' })
      assert.equal(hc.attachment, undefined)
      assert.equal(logs.length, 1, 'the refusal is logged once')
    } finally {
      await hc.stop()
      await hub.close()
    }
  })
})

describe('HubClient: the statuses that stay retried are unchanged (C185)', () => {
  it('a 5xx is still retried with backoff, and is not a refusal', async () => {
    const hub = await fakeHub(500, { error: 'internal' })
    const logs: string[] = []
    const hc = new HubClient(cfgFor(hub.url), async () => undefined, (m) => logs.push(m))
    try {
      hc.start()
      // the first attempt, then one more after the 1 s backoff
      await until(() => hub.attempts() >= 2, 6000)
      assert.equal(hc.state, 'connecting', 'not terminated')
      assert.equal(hc.terminatedReason, undefined)
      assert.equal(hc.refusal, undefined)
      assert.ok(logs.length >= 2, 'each failed attempt is logged, as before')
    } finally {
      await hc.stop()
      await hub.close()
    }
  })
})

describe('shim: a refusal that a retry cannot fix, seen from the tools (C185)', () => {
  let tmp: string
  let server: ServerType
  let hubUrl = ''
  let hub: Hub
  // the attach requests the Hub receives, per Mailbox (counted before the Hub answers)
  const attachPosts = new Map<string, number>()

  before(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'shim-refused-'))
    // roles.json names deployer only, so a shim started as tester is refused with unknown_role (400)
    hub = new Hub(new Store(), { roles: new Map([['deployer', { description: 'd', subscribe: [] }]]) })
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

  function spawnShim(mailbox: string, role: string, token: string) {
    const client = new Client({ name: 'claude-code', version: '0' })
    const base = childEnv()
    for (const k of ['HUB_PROJECT', 'CLAUDE_PROJECT_DIR', 'HUB_MAILBOX', 'HUB_ROLE', 'CLAUDE_CODE_SESSION_ID']) delete base[k]
    const env = { ...base, HUB_URL: hubUrl, HUB_TOKEN: token, HUB_FILES_DIR: join(tmp, 'files'), HUB_MAILBOX: mailbox, HUB_ROLE: role, HUB_PROJECT: join(tmp, 'work') }
    const transport = new StdioClientTransport({ command: process.execPath, args: [...tsNodeArgs(), join(ROOT, 'src/shim/main.ts')], cwd: ROOT, env, stderr: 'pipe' })
    return { client, connected: client.connect(transport) }
  }

  const callText = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] }
    return { isError: r.isError ?? false, text: r.content[0]!.text }
  }

  it('unknown_role: whoami says refused with the code, the message and the way out; every other tool fails with the same note; no retry', async () => {
    const s = spawnShim('ref-c.tester', 'tester', TOKEN)
    try {
      await s.connected
      const who = await until(async () => {
        const w = JSON.parse((await callText(s.client, 'whoami')).text) as Record<string, unknown>
        return w.terminatedReason === 'refused' ? w : undefined
      })
      assert.equal(who.state, 'terminated')
      assert.equal(who.attachmentId, null, 'stays unattached')
      assert.deepEqual(who.refusal, { status: 400, code: 'unknown_role', message: 'role tester is not in roles.json' })
      const note = String(who.note)
      assert.ok(note.includes('unknown_role') && note.includes('role tester is not in roles.json'), 'names the cause')
      assert.ok(note.includes('roles.json') && note.includes('restart the Hub'), 'names the way out')
      const tool = await callText(s.client, 'post_message', { kind: 'notice', body: 'x', to: { type: 'topic', id: 'nobody' } })
      assert.equal(tool.isError, true)
      assert.match(tool.text, /roles\.json/)
      assert.match(tool.text, /restart the Hub/)
      await sleep(2500)
      assert.equal(attachPosts.get('ref-c.tester'), 1, 'the refused attach is not retried')
    } finally {
      await s.client.close().catch(() => undefined)
    }
  })

  it('401: whoami and every other tool name the token as the cause and the way out, and there is no retry', async () => {
    const s = spawnShim('ref-d.deployer', 'deployer', 'wrong-token-0123456789')
    try {
      await s.connected
      const who = await until(async () => {
        const w = JSON.parse((await callText(s.client, 'whoami')).text) as Record<string, unknown>
        return w.terminatedReason === 'refused' ? w : undefined
      })
      assert.deepEqual(who.refusal, { status: 401, code: 'unauthorized', message: '' })
      assert.match(String(who.note), /HUB_TOKEN/)
      const tool = await callText(s.client, 'post_message', { kind: 'notice', body: 'x', to: { type: 'topic', id: 'nobody' } })
      assert.equal(tool.isError, true)
      assert.match(tool.text, /HUB_TOKEN/)
      await sleep(2500)
      assert.equal(attachPosts.get('ref-d.deployer'), 1, 'the refused attach is not retried')
    } finally {
      await s.client.close().catch(() => undefined)
    }
  })
})
