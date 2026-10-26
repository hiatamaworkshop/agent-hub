// Hub と shim が共有する型と入力検証 (protocol.md §1, §2)
import { z } from 'zod'

// Mailbox 名・role 名・トピック名。URL パスにそのまま載せる
export const NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/

export function isValidName(s: string): boolean {
  return NAME_RE.test(s)
}

// フォルダ名を Mailbox 名の規則に寄せる。寄せられなければ main。
// shim と Hub (hook の cwd からの解決) で同じ規則を使う。Hub は Linux (Docker) でも動くので、\ と / の両方で区切る
export function mailboxFromFolder(dir: string): string {
  const s = (dir.split(/[\\/]+/).filter(Boolean).pop() ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 64)
  return isValidName(s) ? s : 'main'
}

// role を持つセッションの既定の Mailbox 名は <フォルダ名>.<role>。Mailbox の名前空間は Hub 全体で 1 つなので、
// プロジェクトが違えば同じ role でも別の Mailbox にする (design.md §3.3)。64 文字に収まるようフォルダ名の側を切る
export function defaultMailboxName(dir: string, role: string | null): string {
  const folder = mailboxFromFolder(dir)
  if (!role) return folder
  const room = 63 - role.length
  return room > 0 ? `${folder.slice(0, room)}.${role}` : role
}

// Mailbox の project の比較用。区切り・末尾の区切り・ドライブ文字のパスの大文字小文字を揃える (Windows のパスは大文字小文字を区別しない)
export function normalizeProjectPath(p: string): string {
  const s = p.replace(/[\\/]+/g, '/').replace(/(.)\/$/, '$1')
  return /^[a-z]:/i.test(s) ? s.toLowerCase() : s
}

export const MESSAGE_KINDS = ['request', 'reply', 'notice'] as const
export type MessageKind = (typeof MESSAGE_KINDS)[number]

// user はどの Mailbox にも配信されず、UI にだけ出る (ブラウザへの返信先)
export const ADDRESS_TYPES = ['mailbox', 'role', 'topic', 'user'] as const
export type AddressType = (typeof ADDRESS_TYPES)[number]

// turn.failed は API のエラーでターンが終わった印 (StopFailure。usage limit など。payload.error に種類)。question.answered は回答の記録 (UI で質問待ちを解く)。permission.resolved は許可待ちの後に最初にツールが動いた印 (許可された。C30)。session.boundary は report_event 用 (後回し。design.md §3.4)
export const EVENT_KINDS = ['turn.end', 'turn.failed', 'question', 'question.answered', 'permission', 'permission.resolved', 'notification', 'session.boundary'] as const
export type EventKind = (typeof EVENT_KINDS)[number]

export const nameSchema = z.string().regex(NAME_RE)

// user 宛ての名前。Hub が付与する送り手 (user:browser / user:cli) に限る。誤選択した宛先を受理しないため
export const USER_IDS = ['browser', 'cli'] as const

export const addressSchema = z
  .object({
    type: z.enum(ADDRESS_TYPES),
    id: nameSchema,
    // role 宛てだけ。この作業フォルダの Mailbox の role にだけ届ける (design.md §9-7)
    project: z.string().min(1).max(1024).optional(),
  })
  .refine((a) => a.type !== 'user' || (USER_IDS as readonly string[]).includes(a.id), {
    message: `user 宛ては ${USER_IDS.map((u) => `user:${u}`).join(' / ')} のみ`,
    path: ['id'],
  })
  .refine((a) => a.project === undefined || a.type === 'role', {
    message: 'project を付けられるのは role 宛てだけ',
    path: ['project'],
  })
export type Address = z.infer<typeof addressSchema>

// 送り手。リクエストからは受け取らず、Hub が付与する
export interface Sender {
  type: 'user' | 'mailbox'
  id: string
  role: string | null
}

export interface Message {
  id: string
  seq: number
  ts: string
  kind: MessageKind
  from: Sender
  to: Address
  body: string
  replyTo?: string
  // 無編集転送の大元のメッセージ id と、その送り手。転送の転送でも大元を指す (from は転送した人)
  forwardedFrom?: string
  forwardedSender?: Sender
  // 送り手が付ける任意の JSON。Hub が解釈するのは meta.files だけで、ほかのキーはそのまま通す (protocol.md §2)
  meta?: Record<string, unknown>
}

// GET /mailboxes/:name/inbox の応答。MCP Events の events/poll に揃える (protocol.md §5)
export interface InboxResult {
  messages: Message[]
  // 次の after。ack の upTo にもそのまま使える
  cursor: number
  // 切り捨ては attach の時点で行うので、inbox では常に false
  truncated: boolean
  hasMore: boolean
  nextPollMs: number
}

// POST /messages と post_message の入力。from / id / seq などは含まれていても捨てる (z.object は未知キーを落とす)
// meta のキーとサイズ (保存・配信の前に検証する)
export const META_KEY_RE = /^[a-z][a-z0-9_]{0,31}$/
export const META_MAX_BYTES = 8 * 1024

export const postMessageSchema = z
  .object({
    kind: z.enum(MESSAGE_KINDS),
    // replyTo があれば省略でき、元メッセージの from が宛先になる
    to: addressSchema.optional(),
    body: z.string().min(1),
    replyTo: z.string().min(1).optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((m) => m.meta === undefined || Object.keys(m.meta).every((k) => META_KEY_RE.test(k)), {
    message: `meta keys must match ${META_KEY_RE}`,
    path: ['meta'],
  })
  .refine((m) => m.meta === undefined || new TextEncoder().encode(JSON.stringify(m.meta)).length <= META_MAX_BYTES, {
    message: `meta must be ${META_MAX_BYTES / 1024} KB or smaller when serialized`,
    path: ['meta'],
  })
  .refine((m) => m.kind !== 'reply' || m.replyTo !== undefined, {
    message: 'kind=reply では replyTo が必須',
    path: ['replyTo'],
  })
  .refine((m) => m.to !== undefined || m.replyTo !== undefined, {
    message: 'to か replyTo のどちらかが必須',
    path: ['to'],
  })
export type PostMessageInput = z.infer<typeof postMessageSchema>

// POST /messages/:id/forward の入力。本文・kind・meta は元のメッセージから写すので受け取らない
export const forwardSchema = z.object({ to: addressSchema })

export interface Mailbox {
  name: string
  role: string | null
  createdAt: string
  subscriptions: string[]
  // ここまでは渡した (既読)。再送しない
  cursor: number
  // ここまでは受領の確認がある (inbox で取り出した・replyTo で返信した)。protocol.md §4
  received: number
  // 最後に attach した Attachment の cwd (design.md §3.3)。記録より前のログから復元したものは null
  project: string | null
  attachment: string | null
}

export interface Attachment {
  attachmentId: string
  mailbox: string
  client: string
  sessionId?: string
  cwd?: string
  attachedAt: string
  leaseUntil: string
}

// hook (tools/hooks/post-event.mjs) が Stop の入力に足す git の事実。Hub は git を実行しない (design.md §3.11)
export interface EventChanges {
  head: string
  changed: string[]
  untracked: string[]
}

export interface HubEvent {
  id: string
  ts: string
  kind: EventKind
  // 変換したクライアント (例 claude-code)。payload の形はこれで決まる
  source: string
  sessionId?: string
  mailbox?: string
  // 形が合った git の事実だけ。payload には入力のまま残る
  changes?: EventChanges
  // takeover で切り離されたセッションからの Event。mailbox は今の接続のものではない (protocol.md §2 Event)
  superseded?: true
  payload: unknown
}
