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
import { ADDRESS_TYPES, MESSAGE_KINDS, normalizeProjectPath, type Address, type Mailbox, type Message } from '../shared/types.js'
import { CHANNEL_CAPABILITY, pushSkippedNotice, pushToChannel } from './channel.js'
import { instructionsFor, routeFor, type Route } from './instructions.js'
import { loadConfig } from './config.js'
import { SHIM_TOOLS } from './tools.js'
import { resolveFiles, sweepFiles } from './files.js'
import { HubClient } from './hub-client.js'
import { fetchInbox } from './inbox.js'
import { messageLookup, openRequestsText } from '../shared/open-requests.js'

const log = (msg: string) => process.stderr.write(`[agent-hub shim] ${msg}\n`)

const cfg = loadConfig()
if (!cfg.token) log('HUB_TOKEN is not set. Set it in the .env of agent-hub or in the environment')

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
    instructions: instructionsFor(route, cfg.mailbox, cfg.role, primed?.roleDescription ?? null, primed?.language ?? null),
  }
})

// "mailbox:rev-a" のような表記 (channel の from / to と同じ) を Address にする
function parseAddress(s: string): Address {
  const i = s.indexOf(':')
  const type = s.slice(0, i)
  if (i < 0 || !(ADDRESS_TYPES as readonly string[]).includes(type)) {
    throw new Error(`to must be written as ${ADDRESS_TYPES.map((t) => `${t}:<name>`).join(' / ')}`)
  }
  return { type: type as Address['type'], id: s.slice(i + 1) }
}

// 送る Message の meta.item (C77)。明示の item が先。reply で省いたら、送る時点で Hub から元の Message を読んで id と project を写す
// (shim は届けた Message を覚えない)。元がない・項目がない・読めないときは付けない (reply 自体は Hub が検証する)
// 返信の元の Message が持つ項目 (meta.item の id と project)。元がない・項目がない・読めないときは undefined (C77)
async function originalItem(replyTo: string): Promise<{ id: string; project: string } | undefined> {
  try {
    const orig = await hub.request<Message>('GET', `/messages/${encodeURIComponent(replyTo)}`)
    const it = orig.meta?.item as { id?: unknown; project?: unknown } | undefined
    if (it && typeof it.id === 'string' && typeof it.project === 'string') return { id: it.id, project: it.project }
  } catch (e) {
    log(`could not read the original message of the reply: ${e instanceof Error ? e.message : String(e)}`)
  }
  return undefined
}

// project は、返信で項目を名指したときも元の Message の項目の project を使う (C89)。元に項目がなければ、この shim の cwd
async function itemFor(id: string | undefined, replyTo: string | undefined): Promise<Record<string, unknown> | undefined> {
  if (!id && !replyTo) return undefined
  const orig = replyTo ? await originalItem(replyTo) : undefined
  if (id) return { id, project: orig?.project ?? normalizeProjectPath(cfg.cwd), source: null, promise: null }
  return orig && { id: orig.id, project: orig.project, source: null, promise: null }
}

const postArgs = z.object({
  kind: z.enum(MESSAGE_KINDS),
  body: z.string().min(1),
  to: z.string().optional(),
  reply_to: z.string().optional(),
  item: z.string().regex(/^C[1-9][0-9]*$/, 'item must be a roadmap item ID in the form C<n>, for example C77').optional(),
})
const topicArgs = z.object({ topic: z.string().min(1) })
const inboxArgs = z.object({
  after: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  unconfirmed: z.boolean().optional(),
})

const text = (v: unknown): CallToolResult => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] })

// The message of a listed request: found, missing (gone) or failed (the read did not work). The shared lookup over GET /messages?after (read-only)
const lookupMessage = messageLookup((path) => hub.request<unknown>('GET', path))

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: SHIM_TOOLS }))

// 切り離された shim は attach し直さない。「新しい方を閉じればこちらが戻る」とモデルが案内したので (2026-10-19、C21)、
// 戻らないことと、使い続けるときの手順を書く
// C103: the Mailbox is connected from another folder, so this session is refused and does not retry
const PROJECT_MISMATCH_NOTE =
  `Mailbox ${cfg.mailbox} is connected, and a project in another folder is using it (project_mismatch). This session will not connect to the Hub. ` +
  'Start again under another Mailbox name (for team, --mailbox <name>; when started by hand, change HUB_MAILBOX)'
const SUPERSEDED_NOTE =
  `Mailbox ${cfg.mailbox} was taken over by another session (superseded). This session will not reconnect (closing the newer session does not bring it back). ` +
  'This session no longer sends, receives or changes subscriptions. To keep using this session, start Claude Code again (the one connected now is detached)'

server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
  const args = req.params.arguments ?? {}
  try {
    // 引き継がれた後は、送信も購読の変更もしない (購読は Mailbox に保存されるので、後継の購読を変えてしまう)
    if (hub.terminatedReason === 'superseded' && req.params.name !== 'whoami') throw new Error(SUPERSEDED_NOTE)
    if (hub.terminatedReason === 'project_mismatch' && req.params.name !== 'whoami') throw new Error(`${PROJECT_MISMATCH_NOTE} (${hub.lastError ?? ''})`)
    switch (req.params.name) {
      case 'post_message': {
        if (!hub.attachment) throw new Error(`Not connected to the Hub (${hub.state}${hub.lastError ? `: ${hub.lastError}` : ''})`)
        const a = postArgs.parse(args)
        const item = await itemFor(a.item, a.reply_to)
        const m = await hub.request<Message & { recipients: string[]; unattached?: string[] }>('POST', '/messages', {
          kind: a.kind,
          body: a.body,
          ...(a.to ? { to: parseAddress(a.to) } : {}),
          ...(a.reply_to ? { replyTo: a.reply_to } : {}),
          ...(item ? { meta: { item } } : {}),
        })
        const to = `${m.to.type}:${m.to.id}`
        const out: Record<string, unknown> = { id: m.id, seq: m.seq, to }
        // user 宛ては Mailbox を経由せず UI に出るので recipients は常に空。空の配列をモデルが「未達」と読んだので返さない (2026-10-17)
        if (m.to.type === 'user') out.delivered = 'shown in the UI (a message to the user does not go through a Mailbox)'
        else {
          out.recipients = m.recipients
          if (m.recipients.length === 0) out.warning = `no Mailbox receives ${to} (it was accepted)`
          // 配信先が全部未接続なら、誰も今は読まない。返事を待ってターンを終えると止まって見える (C49)。unattached のない古い Hub では言わない
          else if (m.unattached && m.unattached.length === m.recipients.length) {
            out.unattached = m.unattached
            out.warning =
              `none of the recipients of ${to} (${m.unattached.join(', ')}) is connected now. It was accepted, and it arrives as unread when a recipient attaches, but no one reads it until then`
          }
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
          return text({ ...r, note: `${topic} is a default subscription of the role (roles.json), so it is not removed` })
        }
        return text(r)
      }
      case 'inbox':
        return text(await fetchInbox(hub, cfg.mailbox, inboxArgs.parse(args), fileCtx, log))
      case 'open_requests': {
        // Read-only (C129): GET /mailboxes for the backlog, and GET /messages?after for each listed request's item. The cursor and
        // the unread messages are not touched (inbox does that; this does not)
        const r = await hub.request<{ mailboxes: (Mailbox & { backlog?: unknown })[] }>('GET', '/mailboxes')
        const mb = r.mailboxes.find((x) => x.name === cfg.mailbox)
        if (!mb) return text(`Mailbox ${cfg.mailbox} is not on the Hub (it is not attached).`)
        const out = await openRequestsText(mb, lookupMessage)
        return text(out || 'Nothing is open: no request of yours owes a reply, and you await none.')
      }
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
          ...(hub.terminatedReason === 'superseded' ? { note: SUPERSEDED_NOTE } : {}),
          ...(hub.terminatedReason === 'project_mismatch' ? { note: PROJECT_MISMATCH_NOTE } : {}),
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
