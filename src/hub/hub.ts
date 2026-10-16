// Hub の振る舞い (配信・購読・Attachment)。HTTP から独立させ、app.ts は入出力の変換だけにする
import type { Attachment, Mailbox, Message, PostMessageInput, Sender } from '../shared/types.js'
import { newId } from './ids.js'
import type { Store } from './store.js'

export class HubError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

// UI 向け SSE の 1 件 (protocol.md §7)
export interface UiEvent {
  event: string
  data: unknown
}

export type TerminateReason = 'superseded' | 'mailbox_deleted' | 'lease_expired'

// Attachment の stream 1 本ぶん (protocol.md §3 shim 向け SSE)
export interface AttachmentSink {
  message(m: Message): void
  // reason があれば terminated を送ってから閉じる
  close(reason?: TerminateReason): void
}

export interface AttachInput {
  client: string
  role?: string | null
  sessionId?: string
  cwd?: string
}

export interface AttachResult {
  attachmentId: string
  role: string | null
  roleDescription: string | null
  cursor: number
  truncated: boolean
  skipped: number
  leaseUntil: string
  superseded: string | null
}

// P0 ではリースを強制しない (heartbeat と期限切れは P2)。値だけ返す
const LEASE_MS = 2 * 60_000

export interface HubOptions {
  now?: () => Date
  // stream が開かれていない Attachment をこの時間で detach する。shim の kill (Windows では終了処理が走らない) に備える
  disconnectGraceMs?: number
}

export class Hub {
  private readonly uiListeners = new Set<(e: UiEvent) => void>()
  private readonly sinks = new Map<string, AttachmentSink>()
  private readonly graceTimers = new Map<string, NodeJS.Timeout>()
  readonly attachments = new Map<string, Attachment>()
  private readonly now: () => Date
  private readonly disconnectGraceMs: number

  constructor(
    readonly store: Store,
    opts: HubOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date())
    this.disconnectGraceMs = opts.disconnectGraceMs ?? 15_000
  }

  onUi(fn: (e: UiEvent) => void): () => void {
    this.uiListeners.add(fn)
    return () => this.uiListeners.delete(fn)
  }

  private emitUi(event: string, data: unknown): void {
    for (const fn of this.uiListeners) fn({ event, data })
  }

  private mustAttachment(id: string): Attachment {
    const at = this.attachments.get(id)
    if (!at) throw new HubError(404, 'attachment_not_found', `attachment ${id} がない`)
    return at
  }

  private mustMailbox(name: string): Mailbox {
    const mb = this.store.getMailbox(name)
    if (!mb) throw new HubError(404, 'mailbox_not_found', `mailbox ${name} がない`)
    return mb
  }

  // X-Hub-Attachment の Attachment から送り手を決める。from はリクエストから受け取らない
  senderOf(attachmentId: string): Sender {
    const at = this.mustAttachment(attachmentId)
    return { type: 'mailbox', id: at.mailbox, role: this.store.getMailbox(at.mailbox)?.role ?? null }
  }

  postMessage(input: PostMessageInput, from: Sender): Message {
    const original = input.replyTo === undefined ? undefined : this.store.getMessage(input.replyTo)
    if (input.replyTo !== undefined && !original) {
      throw new HubError(400, 'reply_to_not_found', `replyTo ${input.replyTo} がない`)
    }
    // to の省略は replyTo があるときだけ許す (schema で検証済み)。元の送り手に返す
    const to = input.to ?? { type: original!.from.type, id: original!.from.id }
    const m = this.store.appendMessage({ ...input, to, from })
    this.emitUi('message', m)
    for (const [id, sink] of this.sinks) {
      const at = this.attachments.get(id)
      if (at && this.store.isRecipient(at.mailbox, m)) sink.message(m)
    }
    return m
  }

  // 配信先の Mailbox 名 (未接続も含む。次の attach で未読として届く)。user 宛ては常に空
  recipientsOf(m: Message): string[] {
    return this.store
      .listMailboxes()
      .filter((mb) => this.store.isRecipient(mb.name, m))
      .map((mb) => mb.name)
  }

  // --- Mailbox / Attachment ---

  // 冪等。未読は Mailbox の cursor から再送されるので、attach し直しても失われない
  attach(name: string, input: AttachInput): AttachResult {
    const { mailbox, created } = this.store.ensureMailbox(name, input.role)
    if (created) this.emitUi('mailbox.created', mailbox)

    // takeover (暫定: 排他・新しい方が勝つ。design.md §8)
    const superseded = mailbox.attachment
    if (superseded) this.endAttachment(superseded, 'superseded')

    const at: Attachment = {
      attachmentId: newId('at'),
      mailbox: name,
      client: input.client,
      sessionId: input.sessionId,
      cwd: input.cwd,
      attachedAt: this.now().toISOString(),
      leaseUntil: new Date(this.now().getTime() + LEASE_MS).toISOString(),
    }
    this.attachments.set(at.attachmentId, at)
    this.store.setAttachment(name, at.attachmentId)
    this.armGrace(at.attachmentId)
    this.emitUi('attachment.attached', at)

    return {
      attachmentId: at.attachmentId,
      role: mailbox.role,
      roleDescription: null,
      cursor: mailbox.cursor,
      truncated: false,
      skipped: 0,
      leaseUntil: at.leaseUntil,
      superseded,
    }
  }

  detach(attachmentId: string): void {
    this.mustAttachment(attachmentId)
    this.endAttachment(attachmentId, null)
  }

  // stream のない状態が disconnectGraceMs 続いたら detach する
  private armGrace(attachmentId: string): void {
    this.clearGrace(attachmentId)
    const t = setTimeout(() => {
      this.graceTimers.delete(attachmentId)
      if (!this.sinks.has(attachmentId)) this.endAttachment(attachmentId, null, 'disconnected')
    }, this.disconnectGraceMs)
    t.unref()
    this.graceTimers.set(attachmentId, t)
  }

  private clearGrace(attachmentId: string): void {
    clearTimeout(this.graceTimers.get(attachmentId))
    this.graceTimers.delete(attachmentId)
  }

  // reason があれば stream に terminated を送ってから閉じる
  private endAttachment(attachmentId: string, reason: TerminateReason | null, uiReason?: string): void {
    const at = this.attachments.get(attachmentId)
    if (!at) return
    this.clearGrace(attachmentId)
    this.attachments.delete(attachmentId)
    const mb = this.store.getMailbox(at.mailbox)
    if (mb?.attachment === attachmentId) this.store.setAttachment(at.mailbox, null)
    const sink = this.sinks.get(attachmentId)
    this.sinks.delete(attachmentId)
    sink?.close(reason ?? undefined)
    this.emitUi(reason === 'superseded' ? 'attachment.superseded' : 'attachment.detached', { ...at, reason: uiReason ?? reason })
  }

  // stream を開く。after より後の未読を seq 順に送ってから新着を流す。
  // 同じ Attachment で開き直したら古い stream は閉じる。戻り値で登録を外す
  openStream(attachmentId: string, after: number, sink: AttachmentSink): () => void {
    const at = this.mustAttachment(attachmentId)
    const old = this.sinks.get(attachmentId)
    this.sinks.set(attachmentId, sink)
    this.clearGrace(attachmentId)
    old?.close()
    // store の追記と配信は同期的に進むので、未読の送信と登録の間に新着が割り込むことはない
    for (const m of this.store.unread(at.mailbox, after)) sink.message(m)
    // 相手から切られたときだけここに来る (開き直し・終了では先に sinks から外れている)
    return () => {
      if (this.sinks.get(attachmentId) !== sink) return
      this.sinks.delete(attachmentId)
      this.armGrace(attachmentId)
    }
  }

  ack(attachmentId: string, upTo: number): number {
    return this.store.advanceCursor(this.mustAttachment(attachmentId).mailbox, upTo)
  }

  cursorOf(attachmentId: string): number {
    const at = this.mustAttachment(attachmentId)
    return this.mustMailbox(at.mailbox).cursor
  }

  subscribe(name: string, topic: string): Mailbox {
    this.mustMailbox(name)
    if (this.store.subscribe(name, topic)) this.emitUi('subscription.changed', this.store.getMailbox(name))
    return this.mustMailbox(name)
  }

  unsubscribe(name: string, topic: string): Mailbox {
    this.mustMailbox(name)
    if (this.store.unsubscribe(name, topic)) this.emitUi('subscription.changed', this.store.getMailbox(name))
    return this.mustMailbox(name)
  }

  // GET /mailboxes 向け。実効購読・未読数・Attachment を添える
  describeMailboxes() {
    return this.store.listMailboxes().map((mb) => ({
      ...mb,
      effectiveSubscriptions: this.store.effectiveSubscriptions(mb.name),
      unread: this.store.unread(mb.name).length,
      attachment: mb.attachment ? (this.attachments.get(mb.attachment) ?? null) : null,
    }))
  }
}
