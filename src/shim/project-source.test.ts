import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
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
import { parseRoles } from '../hub/roles.js'
import { Store } from '../hub/store.js'
import { childEnv, tsNodeArgs } from '../test-child.js'
import { normalizeProjectPath } from '../shared/types.js'

// C180: the shim's project. A real shim is started against a real Hub, and the Hub's attach requests are recorded in the order they
// arrive, so the order against initialize (the client's answer) can be checked. The shim runs from agent-hub's folder, so the
// process folder (the last source) is ROOT, and the roots or the environment name other folders
const TOKEN = 'test-token-0123456789'
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DESCRIPTION = 'project source test role'
const LANGUAGE_LINE = 'in Japanese (ja)'

// The client's roots. value is answered to a roots/list that the script does not cover. script answers the next roots/list requests in
// order (with a delay, or with a value fixed when the request came). hang leaves the request unanswered (a refresh that times out)
type RootsAnswer = { value: { uri: string }[]; delayMs?: number }
type Roots = { value: { uri: string }[]; script?: RootsAnswer[]; hang?: boolean }

// The Hub, which records "attach cwd=<folder>" in events, in the order the attach requests arrive
async function startHub(events: string[]) {
  const roles = parseRoles(JSON.stringify({ deployer: { description: DESCRIPTION, subscribe: [] } }))
  const hub = new Hub(new Store({ roleSubscriptions: (r) => roles.get(r)?.subscribe ?? [] }), { roles, disconnectGraceMs: 300, language: 'ja' })
  const app = createApp({ hub, token: TOKEN, uiHtml: async () => null })
  const fetch = async (req: Request) => {
    if (req.method === 'POST' && /^\/mailboxes\/[^/]+\/attach$/.test(new URL(req.url).pathname)) {
      const body = (await req.clone().json()) as { cwd?: string }
      events.push(`attach cwd=${normalizeProjectPath(body.cwd ?? '')}`)
    }
    return app.fetch(req)
  }
  let hubUrl = ''
  const server = await new Promise<ServerType>((resolveServer) => {
    const s = serve({ fetch, hostname: '127.0.0.1', port: 0 }, (info) => {
      hubUrl = `http://127.0.0.1:${info.port}`
      resolveServer(s)
    })
  })
  return { hub, hubUrl, server }
}

interface StartOptions {
  hubUrl: string
  events: string[]
  env?: Record<string, string>
  // the client's roots: undefined means the client declares no roots capability
  roots?: Roots
  // called just before the client sends initialize (the test looks at the Hub here)
  beforeInitialize?: () => Promise<void>
}

// Starts a shim as a client would, and records the moment initialize answers (after the client's connect resolves)
async function startShim(opts: StartOptions) {
  const client = new Client({ name: 'claude-code', version: '0' }, { capabilities: opts.roots ? { roots: { listChanged: true } } : {} })
  if (opts.roots) {
    const roots = opts.roots
    client.setRequestHandler(ListRootsRequestSchema, async () => {
      opts.events.push('roots/list')
      const next = roots.script?.shift()
      if (roots.hang) return new Promise<never>(() => undefined)
      if (next?.delayMs) await new Promise((r) => setTimeout(r, next.delayMs))
      return { roots: next ? next.value : roots.value }
    })
  }
  const base = childEnv()
  for (const k of ['HUB_PROJECT', 'CLAUDE_PROJECT_DIR', 'HUB_MAILBOX', 'HUB_ROLE', 'CLAUDE_CODE_SESSION_ID']) delete base[k]
  const env = { ...base, HUB_URL: opts.hubUrl, HUB_TOKEN: TOKEN, HUB_FILES_DIR: join(tmpdir(), 'shim-project-source-files'), ...opts.env }
  const transport = new StdioClientTransport({ command: process.execPath, args: [...tsNodeArgs(), join(ROOT, 'src/shim/main.ts')], cwd: ROOT, env, stderr: 'pipe' })
  if (opts.beforeInitialize) {
    const beforeInitialize = opts.beforeInitialize
    const send = transport.send.bind(transport)
    transport.send = async (message, options) => {
      if ('method' in message && message.method === 'initialize') await beforeInitialize()
      return send(message, options)
    }
  }
  await client.connect(transport)
  opts.events.push('initialized')
  return client
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

const callText = async (client: Client, name: string): Promise<string> => {
  const r = (await client.callTool({ name, arguments: {} })) as { content: { text: string }[] }
  return r.content[0]!.text
}
const callWhoami = async (client: Client) => JSON.parse(await callText(client, 'whoami')) as Record<string, unknown>

describe('shim: the project from the environment, the client, or the process folder (C180)', () => {
  let tmp: string
  const projA = () => join(tmp, 'proj-a')
  const projB = () => join(tmp, 'proj-b')
  const fileUri = (dir: string) => ({ uri: pathToFileURL(dir).href })

  before(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'shim-proj-'))
  })
  after(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  // Starts a Hub and a shim, and returns them with the recorded events. close() ends both
  async function session(opts: Omit<StartOptions, 'hubUrl' | 'events'>) {
    const events: string[] = []
    const { hub, hubUrl, server } = await startHub(events)
    const client = await startShim({ ...opts, hubUrl, events })
    return {
      client,
      hub,
      events,
      async close() {
        await client.close().catch(() => undefined)
        server.closeAllConnections()
        await new Promise((r) => server.close(r))
      },
    }
  }

  it('roots decide the project: the first attach carries the folder before initialize answers, and the instructions carry the role and the language', async () => {
    const roots: Roots = { value: [fileUri(projA())] }
    const s = await session({ roots, env: { HUB_ROLE: 'deployer' } })
    try {
      // roots/list, then the attach, then the answer to initialize: no attach with the process folder before it
      assert.deepEqual(s.events, ['roots/list', `attach cwd=${normalizeProjectPath(resolve(projA()))}`, 'initialized'])
      const instructions = s.client.getInstructions() ?? ''
      assert.match(instructions, /as Mailbox "proj-a\.deployer" \(role: deployer\)/)
      assert.match(instructions, new RegExp(`Role "deployer": ${DESCRIPTION}`))
      assert.ok(instructions.includes(LANGUAGE_LINE), 'the language line of HUB_LANGUAGE')
      const who = await callWhoami(s.client)
      assert.equal(who.mailbox, 'proj-a.deployer')
      assert.equal(who.project, resolve(projA()))
      assert.equal(who.projectSource, 'roots')
      assert.equal(who.projectNote, null)
      assert.deepEqual(who.roots, [resolve(projA())])
      assert.equal(s.hub.store.getMailbox('proj-a.deployer')!.project, resolve(projA()), 'the Hub records the cwd the shim sent')
    } finally {
      await s.close()
    }
  })

  it('CLAUDE_PROJECT_DIR is set: attach happens before the answer, the client is not asked for roots, and the root that differs is ignored (also after roots/list_changed)', async () => {
    const roots: Roots = { value: [fileUri(projB())] }
    const s = await session({ roots, env: { CLAUDE_PROJECT_DIR: projA(), HUB_ROLE: 'deployer' } })
    try {
      assert.deepEqual(s.events, [`attach cwd=${normalizeProjectPath(projA())}`, 'initialized'])
      assert.match(s.client.getInstructions() ?? '', /as Mailbox "proj-a\.deployer"/)
      const before = await callWhoami(s.client)
      assert.equal(before.projectSource, 'CLAUDE_PROJECT_DIR')
      assert.equal(before.roots, null, 'roots are not asked when the environment decides')
      // a change of roots is looked at, shown in whoami, and never followed
      roots.value = [fileUri(projB())]
      await s.client.sendRootsListChanged()
      const who = await until(async () => {
        const w = await callWhoami(s.client)
        return Array.isArray(w.roots) ? w : undefined
      })
      assert.deepEqual(who.roots, [resolve(projB())])
      assert.equal(who.rootsNote, undefined, 'the environment decided the project, so no note')
      assert.equal(s.events.filter((e) => e.startsWith('attach')).length, 1, 'no re-attach')
      assert.doesNotMatch(await callText(s.client, 'open_requests'), /restart the client to move/, 'no note when the environment decided')
    } finally {
      await s.close()
    }
  })

  it('HUB_PROJECT wins over CLAUDE_PROJECT_DIR, and both are used before initialize', async () => {
    const s = await session({ env: { HUB_PROJECT: projB(), CLAUDE_PROJECT_DIR: projA(), HUB_ROLE: 'deployer' } })
    try {
      assert.deepEqual(s.events, [`attach cwd=${normalizeProjectPath(projB())}`, 'initialized'])
      const who = await callWhoami(s.client)
      assert.equal(who.mailbox, 'proj-b.deployer')
      assert.equal(who.projectSource, 'HUB_PROJECT')
    } finally {
      await s.close()
    }
  })

  it('several roots are not guessed between: the process folder is used, and whoami says why and lists the roots', async () => {
    const roots: Roots = { value: [fileUri(projA()), fileUri(projB())] }
    const s = await session({ roots })
    try {
      assert.deepEqual(s.events, ['roots/list', `attach cwd=${normalizeProjectPath(ROOT)}`, 'initialized'])
      const who = await callWhoami(s.client)
      assert.equal(who.projectSource, 'cwd')
      assert.equal(who.mailbox, 'agent-hub')
      assert.match(String(who.projectNote), /2 roots/)
      assert.match(String(who.projectNote), /process folder/)
      assert.deepEqual(who.roots, [resolve(projA()), resolve(projB())])
    } finally {
      await s.close()
    }
  })

  it('a client without roots and no environment: the process folder, attached before the answer, with the role and the language', async () => {
    const s = await session({ env: { HUB_ROLE: 'deployer' } })
    try {
      assert.deepEqual(s.events, [`attach cwd=${normalizeProjectPath(ROOT)}`, 'initialized'])
      assert.match(s.client.getInstructions() ?? '', new RegExp(`Role "deployer": ${DESCRIPTION}`))
      assert.ok((s.client.getInstructions() ?? '').includes(LANGUAGE_LINE), 'the language line of HUB_LANGUAGE')
      const who = await callWhoami(s.client)
      assert.equal(who.projectSource, 'cwd')
      assert.equal(who.roots, null)
    } finally {
      await s.close()
    }
  })

  it('roots_list_changed to a single root in another folder: no re-attach and no change of cwd; whoami shows both folders; the next tool result starts with the restart note', async () => {
    const roots: Roots = { value: [fileUri(projA())] }
    const s = await session({ roots, env: { HUB_ROLE: 'deployer' } })
    try {
      assert.deepEqual(s.events, ['roots/list', `attach cwd=${normalizeProjectPath(resolve(projA()))}`, 'initialized'])
      roots.value = [fileUri(projB())]
      await s.client.sendRootsListChanged()
      const who = await until(async () => {
        const w = await callWhoami(s.client)
        return typeof w.rootsNote === 'string' ? w : undefined
      })
      assert.equal(who.project, resolve(projA()), 'the attached folder stays')
      assert.deepEqual(who.roots, [resolve(projB())], 'the folder the client now reports')
      assert.match(String(who.rootsNote), new RegExp(`stays on ${escapeRe(resolve(projA()))}`))
      assert.match(String(who.rootsNote), /restart the client/)
      assert.equal(s.events.filter((e) => e.startsWith('attach')).length, 1, 'not re-attached')
      assert.equal(s.hub.store.getMailbox('proj-a.deployer')!.project, resolve(projA()), 'the Mailbox keeps its folder')
      // the next tool result starts with one line that says to restart, and the tool's own text follows it
      const [first, ...rest] = (await callText(s.client, 'open_requests')).split('\n')
      assert.match(first!, /^This session stays on .* restart the client to move/)
      assert.match(rest[0]!, /^Nothing is open/)
      // back to the attached folder: the note goes away
      roots.value = [fileUri(projA())]
      await s.client.sendRootsListChanged()
      await until(async () => ((await callWhoami(s.client)).rootsNote === undefined ? true : undefined))
      assert.doesNotMatch(await callText(s.client, 'open_requests'), /restart the client to move/)
    } finally {
      await s.close()
    }
  })
  it('the environment decides the project: the Hub already has the attachment when the client sends initialize (not after it)', async () => {
    const events: string[] = []
    const { hub, hubUrl, server } = await startHub(events)
    let attachedWhenInitializeSent = -1
    let client: Client | undefined
    try {
      client = await startShim({
        hubUrl,
        events,
        env: { CLAUDE_PROJECT_DIR: projA(), HUB_ROLE: 'deployer' },
        roots: { value: [fileUri(projB())] },
        // the client is slow: it holds initialize until the Hub has an attachment (up to 5 s); the count is taken at the moment it is sent
        beforeInitialize: async () => {
          await until(() => hub.attachments.size > 0, 5000).catch(() => undefined)
          attachedWhenInitializeSent = hub.attachments.size
          events.push('initialize sent')
        },
      })
      assert.equal(attachedWhenInitializeSent, 1, 'the attach was made before initialize was sent')
      assert.deepEqual(events, [`attach cwd=${normalizeProjectPath(projA())}`, 'initialize sent', 'initialized'], 'and roots were not asked')
      assert.match(client.getInstructions() ?? '', /as Mailbox "proj-a\.deployer"/)
    } finally {
      await client?.close().catch(() => undefined)
      server.closeAllConnections()
      await new Promise((r) => server.close(r))
    }
  })

  it('roots decide the project even without a token: whoami reports the root, and no attach is made', async () => {
    const s = await session({ roots: { value: [fileUri(projA())] }, env: { HUB_TOKEN: '', HUB_ROLE: 'deployer' } })
    try {
      assert.deepEqual(s.events, ['roots/list', 'initialized'])
      assert.equal(s.hub.attachments.size, 0, 'no token, so nothing is attached')
      const who = await callWhoami(s.client)
      assert.equal(who.project, resolve(projA()))
      assert.equal(who.projectSource, 'roots')
    } finally {
      await s.close()
    }
  })

  it('after a takeover, the error names the Mailbox the roots gave, not the one the shim started with (C180)', async () => {
    const s = await session({ roots: { value: [fileUri(projA())] }, env: { HUB_ROLE: 'deployer' } })
    try {
      // another session takes the Mailbox over, from the same folder
      s.hub.attach('proj-a.deployer', { client: 'claude-code', cwd: resolve(projA()) })
      await until(async () => ((await callWhoami(s.client)).terminatedReason === 'superseded' ? true : undefined))
      const r = (await s.client.callTool({ name: 'post_message', arguments: { kind: 'notice', body: 'x', to: 'topic:nobody' } })) as {
        isError?: boolean
        content: { text: string }[]
      }
      assert.equal(r.isError, true)
      assert.match(r.content[0]!.text, /Mailbox proj-a\.deployer was taken over/)
      assert.doesNotMatch(r.content[0]!.text, /agent-hub\.deployer/)
    } finally {
      await s.close()
    }
  })

  it('a tool call right after roots_list_changed sees the new root, without whoami first', async () => {
    const roots: Roots = { value: [fileUri(projA())] }
    const s = await session({ roots, env: { HUB_ROLE: 'deployer' } })
    try {
      roots.value = [fileUri(projB())]
      await s.client.sendRootsListChanged()
      const [first] = (await callText(s.client, 'open_requests')).split('\n')
      assert.match(first!, /restart the client to move/)
      assert.ok(first!.includes(resolve(projB())), 'the note names the folder the client now reports')
    } finally {
      await s.close()
    }
  })

  it('two notifications back to back: the answer that comes later for the first one is stale and does not replace the newer one', async () => {
    const roots: Roots = { value: [fileUri(projA())] }
    const s = await session({ roots, env: { HUB_ROLE: 'deployer' } })
    try {
      // the first refresh is answered late, with another folder; the second is answered at once with the attached folder
      roots.script = [{ value: [fileUri(projB())], delayMs: 400 }, { value: [fileUri(projA())] }]
      await s.client.sendRootsListChanged()
      await s.client.sendRootsListChanged()
      const [first] = (await callText(s.client, 'open_requests')).split('\n')
      assert.doesNotMatch(first!, /restart the client to move/, 'the late, stale answer is not applied')
      const who = await callWhoami(s.client)
      assert.deepEqual(who.roots, [resolve(projA())])
      assert.equal(who.rootsNote, undefined)
    } finally {
      await s.close()
    }
  })

  it('a refresh that times out keeps the previous answer, and the note stays', async () => {
    const roots: Roots = { value: [fileUri(projA())] }
    const s = await session({ roots, env: { HUB_ROLE: 'deployer' } })
    try {
      roots.value = [fileUri(projB())]
      await s.client.sendRootsListChanged()
      await until(async () => ((await callWhoami(s.client)).rootsNote !== undefined ? true : undefined))
      // the next refresh is never answered; the tool call waits for it to time out (3 s), then the previous answer is still in use
      roots.hang = true
      await s.client.sendRootsListChanged()
      const [first] = (await callText(s.client, 'open_requests')).split('\n')
      assert.match(first!, /restart the client to move/)
      const who = await callWhoami(s.client)
      assert.deepEqual(who.roots, [resolve(projB())], 'the failed refresh did not clear the answer')
      assert.match(String(who.rootsNote), /restart the client/)
    } finally {
      await s.close()
    }
  })
})

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
