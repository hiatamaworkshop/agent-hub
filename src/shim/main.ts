// shim: Claude Code が stdio で起動する channel MCP サーバー。状態は Hub に置き、ここは中継だけをする (design.md §3.1)。
// stdout は MCP が使うので、ログは stderr に書く
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  InitializeRequestSchema,
  LATEST_PROTOCOL_VERSION,
  ListToolsRequestSchema,
  SUPPORTED_PROTOCOL_VERSIONS,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { ADDRESS_TYPES, MESSAGE_KINDS, type Address, type Mailbox, type Message } from '../shared/types.js'
import { ALWAYS_LOAD_META, CHANNEL_CAPABILITY, pushSkippedNotice, pushToChannel } from './channel.js'
import { instructionsFor, routeFor, type Route } from './instructions.js'
import { loadConfig } from './config.js'
import { resolveFiles, sweepFiles } from './files.js'
import { HubClient } from './hub-client.js'
import { fetchInbox } from './inbox.js'

const log = (msg: string) => process.stderr.write(`[agent-hub shim] ${msg}\n`)

const cfg = loadConfig()
if (!cfg.token) log('HUB_TOKEN が未設定。agent-hub の .env か環境変数で設定すること')

// 添付画像は配信の直前に取得し、path / error を足す (元のメッセージは書き換えない)
const fileCtx = { hubUrl: cfg.hubUrl, token: cfg.token, baseDir: cfg.filesDir, mailbox: cfg.mailbox, log }
const hub = new HubClient(
  cfg,
  async (m: Message): Promise<void> => pushToChannel(server, await resolveFiles(m, fileCtx), cfg.mailbox),
  log,
  async (skipped: number): Promise<void> => pushSkippedNotice(server, skipped, cfg.mailbox),
)

// role の説明は instructions (initialize の応答) に入るので、それより前に attach して取る。待ちは上限付きで、
// 過ぎたら説明なしで起動する (Hub が止まっていても shim は立ち上がる)。design.md §3.7
const PRIME_ATTACH_MS = 3000
const primed = cfg.token ? await hub.primeAttach(PRIME_ATTACH_MS) : undefined

const SERVER_INFO = { name: 'agent-hub', version: '0.0.1' }
const CAPABILITIES = { experimental: CHANNEL_CAPABILITY, tools: {} }
const server = new Server(SERVER_INFO, { capabilities: CAPABILITIES })

// 経路 (channel / inbox) は clientInfo.name で決まり、instructions は initialize の応答に入るので、initialize を自前で答える。
// SDK の既定の処理 (_oninitialize、private) と同じ版の取り決めをし、instructions だけを経路ごとに変える (design.md §3.7)。
// SDK の getClientVersion / getClientCapabilities は埋まらないが、shim はどちらも使わない
server.setRequestHandler(InitializeRequestSchema, (req) => {
  const route: Route = routeFor(req.params.clientInfo?.name)
  hub.setPush(route === 'channel')
  if (req.params.clientInfo?.name) hub.setClient(req.params.clientInfo.name)
  log(`client=${req.params.clientInfo?.name ?? '?'} route=${route}`)
  const requested = req.params.protocolVersion
  return {
    protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION,
    capabilities: CAPABILITIES,
    serverInfo: SERVER_INFO,
    instructions: instructionsFor(route, cfg.mailbox, cfg.role, primed?.roleDescription ?? null),
  }
})

// "mailbox:rev-a" のような表記 (channel の from / to と同じ) を Address にする
function parseAddress(s: string): Address {
  const i = s.indexOf(':')
  const type = s.slice(0, i)
  if (i < 0 || !(ADDRESS_TYPES as readonly string[]).includes(type)) {
    throw new Error(`to は ${ADDRESS_TYPES.map((t) => `${t}:<名前>`).join(' / ')} の形で書く`)
  }
  return { type: type as Address['type'], id: s.slice(i + 1) }
}

const tools = [
  {
    name: 'post_message',
    description:
      'agent-hub にメッセージを送る。受け取ったメッセージ (<channel> / <hub-message>) への返信は kind="reply" と reply_to=<その id> を指定する (to を省略すると送り手に返る)。',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...MESSAGE_KINDS], description: 'request (依頼) / reply (返信) / notice (通知)' },
        body: { type: 'string', description: '本文' },
        to: { type: 'string', description: '宛先。mailbox:<名前> / role:<名前> / topic:<名前> / user:browser。reply では省略可' },
        reply_to: { type: 'string', description: '返信元のメッセージ id (kind=reply では必須)' },
      },
      required: ['kind', 'body'],
    },
  },
  {
    name: 'subscribe',
    description: 'トピックを購読する。以後そのトピック宛てのメッセージを受け取る',
    inputSchema: { type: 'object', properties: { topic: { type: 'string', description: '例: user.message' } }, required: ['topic'] },
  },
  {
    name: 'unsubscribe',
    description: 'トピックの個別購読を解除する。role の既定購読 (roles.json) は解除されない',
    inputSchema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
  },
  {
    name: 'inbox',
    description:
      '自分の Mailbox の未読を取り出す。各メッセージは <hub-message> で包まれて返り、返した分は既読になる。<channel> で届いたものは既読なので含まれない (unconfirmed: true なら含む)',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, description: '最大件数 (既定 20)' },
        after: { type: 'integer', minimum: 0, description: 'この seq より後だけを取る (省略時は未読の先頭から)' },
        unconfirmed: {
          type: 'boolean',
          description: 'true なら、<channel> で渡したが受領の確認 (inbox で取り出す・reply_to で返信する) がない分も返す。<channel> が届いていないときの取り直し用',
        },
      },
    },
  },
  {
    name: 'whoami',
    description: 'agent-hub での自分の Mailbox 名・role・接続状態・購読を返す',
    inputSchema: { type: 'object', properties: {} },
  },
].map((t) => ({ ...t, _meta: ALWAYS_LOAD_META }))

const postArgs = z.object({
  kind: z.enum(MESSAGE_KINDS),
  body: z.string().min(1),
  to: z.string().optional(),
  reply_to: z.string().optional(),
})
const topicArgs = z.object({ topic: z.string().min(1) })
const inboxArgs = z.object({
  after: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  unconfirmed: z.boolean().optional(),
})

const text = (v: unknown): CallToolResult => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] })

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
  const args = req.params.arguments ?? {}
  try {
    // 引き継がれた後は、送信も購読の変更もしない (購読は Mailbox に保存されるので、後継の購読を変えてしまう)
    if (hub.terminatedReason === 'superseded' && req.params.name !== 'whoami') {
      throw new Error(`Mailbox ${cfg.mailbox} は別のセッションに引き継がれた (superseded)。このセッションからは送受信も購読の変更もしない`)
    }
    switch (req.params.name) {
      case 'post_message': {
        if (!hub.attachment) throw new Error(`Hub に接続していない (${hub.state}${hub.lastError ? `: ${hub.lastError}` : ''})`)
        const a = postArgs.parse(args)
        const m = await hub.request<Message & { recipients: string[] }>('POST', '/messages', {
          kind: a.kind,
          body: a.body,
          ...(a.to ? { to: parseAddress(a.to) } : {}),
          ...(a.reply_to ? { replyTo: a.reply_to } : {}),
        })
        const to = `${m.to.type}:${m.to.id}`
        const out: Record<string, unknown> = { id: m.id, seq: m.seq, to }
        // user 宛ては Mailbox を経由せず UI に出るので recipients は常に空。空の配列をモデルが「未達」と読んだので返さない (2026-10-17)
        if (m.to.type === 'user') out.delivered = 'UI に表示される (user 宛ては Mailbox を経由しない)'
        else {
          out.recipients = m.recipients
          if (m.recipients.length === 0) out.warning = `${to} を受け取る Mailbox がない (受理はされた)`
        }
        return text(out)
      }
      case 'subscribe':
      case 'unsubscribe': {
        const { topic } = topicArgs.parse(args)
        const method = req.params.name === 'subscribe' ? 'PUT' : 'DELETE'
        const r = await hub.request<{ effectiveSubscriptions: string[] }>(method, `/mailboxes/${cfg.mailbox}/subscriptions/${encodeURIComponent(topic)}`)
        // Hub は個別購読だけを外す。role の既定として残っているトピックは、残ったことを伝える
        if (method === 'DELETE' && r.effectiveSubscriptions.includes(topic)) {
          return text({ ...r, note: `${topic} は role の既定購読 (roles.json) なので解除されない` })
        }
        return text(r)
      }
      case 'inbox':
        return text(await fetchInbox(hub, cfg.mailbox, inboxArgs.parse(args), fileCtx, log))
      case 'whoami': {
        let mailbox: (Mailbox & { effectiveSubscriptions: string[]; unread: number }) | undefined
        try {
          const r = await hub.request<{ mailboxes: (Mailbox & { effectiveSubscriptions: string[]; unread: number })[] }>('GET', '/mailboxes')
          mailbox = r.mailboxes.find((mb) => mb.name === cfg.mailbox)
        } catch {
          // 接続できないときは手元の状態だけ返す
        }
        return text({
          mailbox: cfg.mailbox,
          role: mailbox?.role ?? cfg.role,
          state: hub.state,
          attachmentId: hub.attachment?.attachmentId ?? null,
          terminatedReason: hub.terminatedReason ?? null,
          lastError: hub.lastError ?? null,
          subscriptions: mailbox?.subscriptions ?? null,
          effectiveSubscriptions: mailbox?.effectiveSubscriptions ?? null,
          hub: cfg.hubUrl,
        })
      }
      default:
        throw new Error(`unknown tool: ${req.params.name}`)
    }
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : e instanceof Error ? e.message : String(e)
    return { isError: true, content: [{ type: 'text', text: msg }] }
  }
})

// 初期化が済む前の通知は捨てられうるので、Hub への接続は initialized の後に始める
server.oninitialized = () => {
  if (cfg.token) hub.start()
}

let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  await hub.stop()
  process.exit(0)
}
server.onclose = () => void shutdown()
// Claude Code が stdin を閉じたら終了する (kill された場合は Hub 側の猶予切れで detach される)
process.stdin.on('end', () => void shutdown())
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())

// 古い添付画像の掃除は起動時だけ。失敗しても起動は妨げない
void sweepFiles(cfg.filesDir).then((n) => { if (n > 0) log(`expired files removed: ${n}`) })

await server.connect(new StdioServerTransport())
log(`started mailbox=${cfg.mailbox}${cfg.role ? ` role=${cfg.role}` : ''} hub=${cfg.hubUrl}`)
