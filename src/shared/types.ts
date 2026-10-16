// Hub と shim が共有する型と入力検証 (protocol.md §1, §2)
import { z } from 'zod'

// Mailbox 名・role 名・トピック名。URL パスにそのまま載せる
export const NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/

export function isValidName(s: string): boolean {
  return NAME_RE.test(s)
}

export const MESSAGE_KINDS = ['request', 'reply', 'notice'] as const
export type MessageKind = (typeof MESSAGE_KINDS)[number]

// user はどの Mailbox にも配信されず、UI にだけ出る (ブラウザへの返信先)
export const ADDRESS_TYPES = ['mailbox', 'role', 'topic', 'user'] as const
export type AddressType = (typeof ADDRESS_TYPES)[number]

export const EVENT_KINDS = ['turn.end', 'notification', 'question', 'session.boundary'] as const
export type EventKind = (typeof EVENT_KINDS)[number]

export const nameSchema = z.string().regex(NAME_RE)

export const addressSchema = z.object({
  type: z.enum(ADDRESS_TYPES),
  id: nameSchema,
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
  forwardedFrom?: string
}

// POST /messages と post_message の入力。from / id / seq などは含まれていても捨てる (z.object は未知キーを落とす)
export const postMessageSchema = z
  .object({
    kind: z.enum(MESSAGE_KINDS),
    // replyTo があれば省略でき、元メッセージの from が宛先になる
    to: addressSchema.optional(),
    body: z.string().min(1),
    replyTo: z.string().min(1).optional(),
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

export interface Mailbox {
  name: string
  role: string | null
  createdAt: string
  subscriptions: string[]
  cursor: number
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

export interface HubEvent {
  id: string
  ts: string
  kind: EventKind
  sessionId?: string
  mailbox?: string
  payload: unknown
}
