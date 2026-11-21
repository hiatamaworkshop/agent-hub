// C190: the unread hint on the tool results of the inbox path. A real shim is started against a real Hub (in this process), as a client
// named `codex` (the inbox path) or `claude-code` (the channel path). The hint is one line in front of the result; it never carries a
// body, sender or seq, and it moves neither the cursor nor the unread count.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { after, before, describe, it } from 'node:test'
import { serve, type ServerType } from '@hono/node-server'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { createApp } from '../hub/app.js'
import { Hub } from '../hub/hub.js'
import { Store } from '../hub/store.js'
import { childEnv, tsNodeArgs } from '../test-child.js'
import { normalizeProjectPath } from '../shared/types.js'
import { unreadHintText } from './instructions.js'

const TOKEN = 'test-token-0123456789'
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const MB = 'unread-mb'
const SECRET_ONE = 'SECRET-BODY-ONE'
const SECRET_TWO = 'SECRET-BODY-TWO'

type Roots = { value: { uri: string }[] }

// Starts the Hub and a shim as the named client would. HUB_MAILBOX is fixed, and the project comes from the process folder unless roots are given.
// dropAcks: the Hub answers every ack with 500, so a Message the shim has handed stays unread on the Hub (as in shim.test.ts, C176)
async function start(opts: { clientName?: string; roots?: Roots; dropAcks?: boolean } = {}) {
  const hub = new Hub(new Store(), { disconnectGraceMs: 300 })
  const app = createApp({ hub, token: TOKEN, uiHtml: async () => null })
  const fetch = (req: Request) => {
    if (opts.dropAcks && new URL(req.url).pathname.endsWith('/ack')) return new Response('dropped by the test', { status: 500 })
    return app.fetch(req)
  }
  let hubUrl = ''
  const server = await new Promise<ServerType>((resolveServer) => {
    const s = serve({ fetch, hostname: '127.0.0.1', port: 0 }, (info) => {
      hubUrl = `http://127.0.0.1:${info.port}`
      resolveServer(s)
    })
  })
  const client = new Client(
    { name: opts.clientName ?? 'codex', version: '0' },
    { capabilities: opts.roots ? { roots: { listChanged: true } } : {} },
  )
  if (opts.roots) {
    const roots = opts.roots
    client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: roots.value }))
  }
  const base = childEnv()
  for (const k of ['HUB_PROJECT', 'CLAUDE_PROJECT_DIR', 'HUB_ROLE', 'CLAUDE_CODE_SESSION_ID']) delete base[k]
  const env = { ...base, HUB_URL: hubUrl, HUB_TOKEN: TOKEN, HUB_MAILBOX: MB, HUB_FILES_DIR: join(tmpdir(), 'agent-hub-unread-hint-files') }
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [...tsNodeArgs(), join(ROOT, 'src/shim/main.ts')], cwd: ROOT, env, stderr: 'pipe' }))
  return {
    hub,
    client,
    async close() {
      await client.close().catch(() => undefined)
      server.closeAllConnections()
      await new Promise((r) => server.close(r))
    },
  }
}

async function until<T>(f: () => T | undefined | false | Promise<T | undefined | false>, ms = 8000): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const v = await f()
    if (v !== undefined && v !== false) return v
    if (Date.now() > deadline) throw new Error('timeout')
    await new Promise((r) => setTimeout(r, 30))
  }
}

const callRaw = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean }
const callText = async (client: Client, name: string, args: Record<string, unknown> = {}) => (await callRaw(client, name, args)).content[0]!.text
const callWhoami = async (client: Client) => JSON.parse(await callText(client, 'whoami')) as Record<string, unknown>

// Waits until the shim is attached (whoami says so), and returns whoami
const attached = (client: Client) => until(async () => ((await callWhoami(client)).state === 'attached' ? callWhoami(client) : undefined))

const unreadOf = (hub: Hub) => hub.describeMailboxes().find((m) => m.name === MB)!.unread
const cursorOf = (hub: Hub) => hub.store.getMailbox(MB)!.cursor
const HINT_2 = unreadHintText(2, MB)

describe('C190: the unread hint on the inbox path', () => {
  it('while Messages are unread, every result but inbox and whoami starts with the count line; it has no body, sender or id, and the rest is unchanged', async () => {
    const s = await start()
    try {
      await attached(s.client)
      const a = s.hub.postMessage({ kind: 'notice', to: { type: 'mailbox', id: MB }, body: SECRET_ONE }, { type: 'user', id: 'browser', role: null })
      const b = s.hub.postMessage({ kind: 'notice', to: { type: 'mailbox', id: MB }, body: SECRET_TWO }, { type: 'user', id: 'browser', role: null })
      const withHint = await callText(s.client, 'open_requests')
      const [first, ...rest] = withHint.split('\n')
      assert.equal(first, HINT_2)
      assert.doesNotMatch(first!, /SECRET|browser|user:|mailbox:/)
      assert.ok(!first!.includes(a.id) && !first!.includes(b.id), 'the line carries no id of the Messages')
      // the same call after the Messages are read: the rest of the text is what the tool says on its own
      await callText(s.client, 'inbox')
      const plain = await callText(s.client, 'open_requests')
      assert.doesNotMatch(plain, /unread message/)
      assert.equal(rest.join('\n'), plain)
    } finally {
      await s.close()
    }
  })

  it('the hint is on error results too, and inbox does not get it: its own result starts with the Hub text, not the line', async () => {
    const s = await start()
    try {
      await attached(s.client)
      s.hub.postMessage({ kind: 'notice', to: { type: 'mailbox', id: MB }, body: SECRET_ONE }, { type: 'user', id: 'browser', role: null })
      s.hub.postMessage({ kind: 'notice', to: { type: 'mailbox', id: MB }, body: SECRET_TWO }, { type: 'user', id: 'browser', role: null })
      const bad = await callRaw(s.client, 'subscribe', { topic: 'Bad Topic' })
      assert.equal(bad.isError, true)
      assert.equal(bad.content[0]!.text.split('\n')[0], HINT_2)
      const inboxText = await callText(s.client, 'inbox')
      assert.notEqual(inboxText.split('\n')[0], HINT_2)
      assert.match(inboxText, new RegExp(SECRET_ONE))
    } finally {
      await s.close()
    }
  })

  it('the hint moves neither the cursor nor the unread count, and whoami reports the same count', async () => {
    const s = await start()
    try {
      await attached(s.client)
      s.hub.postMessage({ kind: 'notice', to: { type: 'mailbox', id: MB }, body: SECRET_ONE }, { type: 'user', id: 'browser', role: null })
      s.hub.postMessage({ kind: 'notice', to: { type: 'mailbox', id: MB }, body: SECRET_TWO }, { type: 'user', id: 'browser', role: null })
      const cursorBefore = cursorOf(s.hub)
      const unreadBefore = unreadOf(s.hub)
      assert.equal(unreadBefore, 2)
      assert.equal((await callWhoami(s.client)).unread, 2)
      for (let i = 0; i < 3; i++) {
        assert.equal((await callText(s.client, 'open_requests')).split('\n')[0], HINT_2)
      }
      await callText(s.client, 'whoami')
      assert.equal(cursorOf(s.hub), cursorBefore, 'the cursor did not move')
      assert.equal(unreadOf(s.hub), unreadBefore, 'the unread count did not change')
      assert.equal((await callWhoami(s.client)).unread, unreadBefore)
    } finally {
      await s.close()
    }
  })

  it('a Message that inbox() has fetched is not counted again; with some left after a limited inbox, the count is what remains', async () => {
    const s = await start()
    try {
      await attached(s.client)
      s.hub.postMessage({ kind: 'notice', to: { type: 'mailbox', id: MB }, body: SECRET_ONE }, { type: 'user', id: 'browser', role: null })
      s.hub.postMessage({ kind: 'notice', to: { type: 'mailbox', id: MB }, body: SECRET_TWO }, { type: 'user', id: 'browser', role: null })
      assert.equal((await callText(s.client, 'open_requests')).split('\n')[0], HINT_2)
      // one of the two: the count drops to 1 and the line says 1
      await callText(s.client, 'inbox', { limit: 1 })
      assert.equal((await callText(s.client, 'open_requests')).split('\n')[0], unreadHintText(1, MB))
      assert.equal((await callWhoami(s.client)).unread, 1)
      // the rest: no line at all, and whoami counts none
      await callText(s.client, 'inbox')
      assert.doesNotMatch(await callText(s.client, 'open_requests'), /unread message/)
      assert.equal((await callWhoami(s.client)).unread, 0)
    } finally {
      await s.close()
    }
  })

  it('the Hub holds the Messages as unread until inbox() reads them, and the shim does not ack them on the stream', async () => {
    const s = await start()
    try {
      await attached(s.client)
      const m = s.hub.postMessage({ kind: 'notice', to: { type: 'mailbox', id: MB }, body: SECRET_ONE }, { type: 'user', id: 'browser', role: null })
      await new Promise((r) => setTimeout(r, 300))
      assert.equal(cursorOf(s.hub) < m.seq, true)
      assert.equal(unreadOf(s.hub), 1)
    } finally {
      await s.close()
    }
  })

  it('the channel path (claude-code) gets no hint, and its results are unchanged', async () => {
    const s = await start({ clientName: 'claude-code' })
    try {
      await attached(s.client)
      const m = s.hub.postMessage({ kind: 'notice', to: { type: 'mailbox', id: MB }, body: SECRET_ONE }, { type: 'user', id: 'browser', role: null })
      // pushed and acked on this path, so nothing is left unread
      await until(() => cursorOf(s.hub) >= m.seq)
      const text = await callText(s.client, 'open_requests')
      assert.doesNotMatch(text, /unread message/)
      assert.equal((await callWhoami(s.client)).unread, 0)
    } finally {
      await s.close()
    }
  })

  it('the channel path with a Message unread (its ack lost): no hint line, while whoami reports unread 1 (C190 review)', async () => {
    const s = await start({ clientName: 'claude-code', dropAcks: true })
    const pushed: { params?: { meta?: { id?: string } } }[] = []
    s.client.fallbackNotificationHandler = async (n) => void pushed.push(n as { params?: { meta?: { id?: string } } })
    try {
      await attached(s.client)
      const m = s.hub.postMessage({ kind: 'notice', to: { type: 'mailbox', id: MB }, body: SECRET_ONE }, { type: 'user', id: 'browser', role: null })
      // the notification was written to the client (so the shim did try to hand it on) and the ack failed, so the Hub still counts it
      await until(() => pushed.some((n) => n.params?.meta?.id === m.id))
      assert.equal(cursorOf(s.hub) < m.seq, true, 'the cursor did not move: the ack was dropped')
      assert.equal(unreadOf(s.hub), 1)
      const text = await callText(s.client, 'open_requests')
      assert.doesNotMatch(text, /unread message/, 'the channel path gets no line, even with a Message unread')
      assert.doesNotMatch(text.split('\n')[0]!, /^agent-hub: Mailbox/)
      assert.equal((await callWhoami(s.client)).unread, 1)
    } finally {
      await s.close()
    }
  })
})

describe('C190 with C180: the moved-roots line and the unread line', () => {
  let tmp: string
  const projA = () => join(tmp, 'proj-a')
  const projB = () => join(tmp, 'proj-b')
  const fileUri = (dir: string) => ({ uri: pathToFileURL(dir).href })

  before(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'shim-unread-hint-'))
    await mkdir(projA())
    await mkdir(projB())
  })
  after(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('with both, the unread line is first and the roots line second, then the tool text (the order is fixed)', async () => {
    const roots: Roots = { value: [fileUri(projA())] }
    const s = await start({ roots })
    try {
      await attached(s.client)
      assert.equal(normalizeProjectPath(String((await callWhoami(s.client)).project)), normalizeProjectPath(resolve(projA())))
      roots.value = [fileUri(projB())]
      await s.client.sendRootsListChanged()
      await until(async () => (typeof (await callWhoami(s.client)).rootsNote === 'string' ? true : undefined))
      s.hub.postMessage({ kind: 'notice', to: { type: 'mailbox', id: MB }, body: SECRET_ONE }, { type: 'user', id: 'browser', role: null })
      const [first, second, ...rest] = (await callText(s.client, 'open_requests')).split('\n')
      assert.equal(first, unreadHintText(1, MB))
      assert.match(second!, /^This session stays on .* restart the client to move/)
      assert.match(rest[0]!, /^Nothing is open/)
    } finally {
      await s.close()
    }
  })
})
