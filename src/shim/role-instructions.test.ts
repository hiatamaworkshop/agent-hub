// role の説明が instructions に入ること、Hub が止まっていても shim が上限つきで立ち上がること (design.md §3.7)
import assert from 'node:assert/strict'
import { createServer, type Server as NetServer, type Socket } from 'node:net'
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
import { parseRoles } from '../hub/roles.js'
import { Store } from '../hub/store.js'
import { channelInstructions } from './channel.js'

const TOKEN = 'test-token-0123456789'
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DESCRIPTION = 'レビュー担当の説明'

describe('channelInstructions: role の説明', () => {
  it('role と説明があるときだけ、説明の行を入れる', () => {
    assert.match(channelInstructions('rev-a', 'reviewer', DESCRIPTION), /role "reviewer" の役割: レビュー担当の説明/)
    assert.doesNotMatch(channelInstructions('rev-a', 'reviewer', null), /の役割:/)
    assert.doesNotMatch(channelInstructions('rev-a', null, DESCRIPTION), /の役割:/)
  })
})

// 指定された Hub (または何もない場所) に対して shim を起動し、接続できた後の instructions と Client を返す
async function startShim(env: Record<string, string>) {
  const client = new Client({ name: 'test', version: '0' })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/shim/main.ts'],
    cwd: ROOT,
    env: { ...(process.env as Record<string, string>), HUB_TOKEN: TOKEN, ...env },
    stderr: 'pipe',
  })
  await client.connect(transport)
  return { client, instructions: client.getInstructions() ?? '' }
}

describe('shim: role の説明は initialize の instructions に入る', () => {
  let server: ServerType
  let hubUrl = ''
  let tmpDir: string
  const roles = parseRoles(JSON.stringify({ reviewer: { description: DESCRIPTION, subscribe: ['review.request'] } }))

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'shim-role-'))
    const hub = new Hub(new Store({ roleSubscriptions: (r) => roles.get(r)?.subscribe ?? [] }), { roles, disconnectGraceMs: 300 })
    const app = createApp({ hub, token: TOKEN, uiHtml: async () => null })
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, (info) => {
        hubUrl = `http://127.0.0.1:${info.port}`
        resolve()
      })
    })
  })

  after(async () => {
    // shim は kill されるので、開いたままの stream の接続を先に閉じる (残ると reset が uncaught になる)
    server?.closeAllConnections()
    await new Promise((r) => server?.close(r))
    await rm(tmpDir, { recursive: true, force: true })
  })

  const base = () => ({ HUB_URL: hubUrl, HUB_FILES_DIR: join(tmpDir, 'files') })

  it('HUB_ROLE が定義済みなら、説明が instructions に入り、既定購読が効く', async () => {
    const { client, instructions } = await startShim({ ...base(), HUB_ROLE: 'reviewer', HUB_MAILBOX: 'rev-shim' })
    try {
      assert.match(instructions, new RegExp(`role "reviewer" の役割: ${DESCRIPTION}`))
      const r = (await client.callTool({ name: 'whoami', arguments: {} })) as { content: { text: string }[] }
      const who = JSON.parse(r.content[0]!.text) as { attachmentId: string | null; effectiveSubscriptions: string[] }
      assert.ok(who.attachmentId, 'attach 済み')
      assert.deepEqual(who.effectiveSubscriptions, ['review.request'])
    } finally {
      await client.close()
    }
  })

  it('roles.json にない role では attach が 400 になるが、shim は起動し、説明は入らない', async () => {
    const { client, instructions } = await startShim({ ...base(), HUB_ROLE: 'nobody', HUB_MAILBOX: 'nobody-shim' })
    try {
      assert.doesNotMatch(instructions, /の役割:/)
    } finally {
      await client.close()
    }
  })

  it('unsubscribe で role の既定購読は外れず、その旨を note で返す', async () => {
    const { client } = await startShim({ ...base(), HUB_ROLE: 'reviewer', HUB_MAILBOX: 'rev-unsub' })
    try {
      const r = (await client.callTool({ name: 'unsubscribe', arguments: { topic: 'review.request' } })) as { content: { text: string }[] }
      const out = JSON.parse(r.content[0]!.text) as { effectiveSubscriptions: string[]; note?: string }
      assert.deepEqual(out.effectiveSubscriptions, ['review.request'])
      assert.match(out.note ?? '', /role の既定購読/)
    } finally {
      await client.close()
    }
  })
})

describe('shim: Hub が応答しなくても上限つきで起動する', () => {
  let silent: NetServer
  let silentUrl = ''
  const sockets = new Set<Socket>()

  before(async () => {
    // 接続は受けるが、何も返さない (attach が時間切れになる状況)
    silent = createServer((socket) => {
      sockets.add(socket)
      socket.on('error', () => undefined)
      socket.on('close', () => sockets.delete(socket))
    })
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', () => resolve()))
    silentUrl = `http://127.0.0.1:${(silent.address() as { port: number }).port}`
  })

  after(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise((r) => silent.close(r))
  })

  it('説明なしの instructions で接続でき、待ちは数秒で打ち切られる', async () => {
    const t0 = Date.now()
    const { client, instructions } = await startShim({ HUB_URL: silentUrl, HUB_ROLE: 'reviewer', HUB_MAILBOX: 'rev-silent', HUB_FILES_DIR: join(tmpdir(), 'agent-hub-silent-test') })
    try {
      assert.ok(Date.now() - t0 < 10_000, `接続まで ${Date.now() - t0}ms`)
      assert.match(instructions, /role: reviewer/)
      assert.doesNotMatch(instructions, /の役割:/)
    } finally {
      await client.close()
    }
  })
})
