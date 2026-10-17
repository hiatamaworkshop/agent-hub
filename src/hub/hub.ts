// Hub の振る舞い (配信・購読・Attachment)。HTTP から独立させ、app.ts は入出力の変換だけにする
import { isValidName, mailboxFromFolder, type Attachment, type HubEvent, type Mailbox, type Message, type PostMessageInput, type Sender } from '../shared/types.js'
import { fromClaudeCodeHook } from './events.js'
import { newId } from './ids.js'
import type { Roles } from './roles.js'
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

// 接続中の Mailbox は削除できない (409) ので、mailbox_deleted で終わる stream はない。
// stream を開いている間はリースが切れないので、lease_expired は今は送らない (protocol.md §3)
export type TerminateReason = 'superseded' | 'lease_expired'

// detached になった理由。closed: shim が DELETE で切った / disconnected: stream が切れて猶予が過ぎた /
// lease_expired: stream なしでリースが切れた
export type DetachReason = 'closed' | 'disconnected' | 'lease_expired'

// 最後に detached になった Attachment。Mailbox に次の attach があるまで GET /mailboxes に出す (メモリのみ)
export interface DetachedAttachment extends Attachment {
  detachedAt: string
  reason: DetachReason
}

// 今の Attachment が takeover で切り離した旧 Attachment。その Attachment が続く間 GET /mailboxes に出す (メモリのみ)
export interface Takeover {
  at: string
  previous: Attachment
}

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
  // 流し込み量の上限。省略したら Hub の既定、0 なら制限なし (design.md §3.3)
  maxAgeMs?: number
  maxUnread?: number
}

// POST /events の結果。ignored は変換が取り込まなかった理由 (hook の判断には関与しない)
export type AddEventResult =
  | { id: string; kind: HubEvent['kind']; mailbox: string | null; duplicate: boolean }
  | { ignored: string }

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

export interface HubOptions {
  now?: () => Date
  // stream が切れた Attachment をこの時間で detach する。shim の kill (Windows では終了処理が走らない) に備える
  disconnectGraceMs?: number
  // リースの長さ。stream を開いている間は保ち、stream がなければ attach・heartbeat・ack で延ばす (protocol.md §4)
  leaseMs?: number
  // roles.json の内容。null (ファイルなし) なら role 名を検証せず、説明も返さない
  roles?: Roles | null
  // attach 時の流し込み量の既定 (0 なら制限なし)。超えた古い未読は放棄済みとして cursor を進める (design.md §3.3)
  unreadMaxAgeMs?: number
  unreadMax?: number
}

export const DEFAULT_UNREAD_MAX_AGE_MS = 7 * 24 * 60 * 60_000
export const DEFAULT_UNREAD_MAX = 50

export class Hub {
  private readonly uiListeners = new Set<(e: UiEvent) => void>()
  private readonly sinks = new Map<string, AttachmentSink>()
  private readonly graceTimers = new Map<string, NodeJS.Timeout>()
  private readonly leaseTimers = new Map<string, NodeJS.Timeout>()
  readonly attachments = new Map<string, Attachment>()
  // Mailbox 名 → 最後に detached になった Attachment。attach・削除で消す。Hub の再起動では残らない
  private readonly lastDetached = new Map<string, DetachedAttachment>()
  // takeover した Attachment の ID → 切り離した旧 Attachment。その Attachment が終わったら消す
  private readonly takeovers = new Map<string, Takeover>()
  // takeover で切り離された Attachment の sessionId。そのセッションの Event に superseded を付ける。
  // 同じセッションが attach し直したら外す。永続化はしない
  private readonly supersededSessions = new Set<string>()
  // sessionId → Mailbox 名。attach の申告と、ヘッダー・cwd で解決できた Event から覚える。
  // detach 後も残す (セッションは shim が切れても続きうる)。永続化はしない
  private readonly sessionMailbox = new Map<string, string>()
  private readonly now: () => Date
  private readonly disconnectGraceMs: number
  private readonly leaseMs: number
  private readonly roles: Roles | null
  private readonly unreadMaxAgeMs: number
  private readonly unreadMax: number

  constructor(
    readonly store: Store,
    opts: HubOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date())
    this.roles = opts.roles ?? null
    this.disconnectGraceMs = opts.disconnectGraceMs ?? 15_000
    this.leaseMs = opts.leaseMs ?? 2 * 60_000
    this.unreadMaxAgeMs = opts.unreadMaxAgeMs ?? DEFAULT_UNREAD_MAX_AGE_MS
    this.unreadMax = opts.unreadMax ?? DEFAULT_UNREAD_MAX
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

  // --- Event ---

  // hook の入力を変換して記録し、UI に流す。Mailbox には配信しない (design.md §9-2)
  addEvent(input: Record<string, unknown>, headerMailbox?: string): AddEventResult {
    const sessionId = typeof input.session_id === 'string' && input.session_id !== '' ? input.session_id : undefined
    const previous = sessionId ? this.store.lastEventOf(sessionId) : undefined
    const converted = fromClaudeCodeHook(input, previous, this.now())
    if ('ignored' in converted) return converted
    const draft = converted.event

    const existing = draft.id ? this.store.getEvent(draft.id) : undefined
    if (existing) return { id: existing.id, kind: existing.kind, mailbox: existing.mailbox ?? null, duplicate: true }

    const mailbox = this.resolveMailbox(draft.sessionId, headerMailbox, draft.cwd)
    const event: HubEvent = {
      id: draft.id ?? newId('e'),
      ts: this.now().toISOString(),
      kind: draft.kind,
      source: draft.source,
      ...(draft.sessionId ? { sessionId: draft.sessionId } : {}),
      ...(mailbox ? { mailbox } : {}),
      ...(draft.changes ? { changes: draft.changes } : {}),
      ...(draft.sessionId && this.supersededSessions.has(draft.sessionId) ? { superseded: true as const } : {}),
      payload: input,
    }
    this.store.addEvent(event)
    this.emitUi('event', event)
    return { id: event.id, kind: event.kind, mailbox: mailbox ?? null, duplicate: false }
  }

  // 優先順: sessionId (shim の申告か記録済み) → X-Hub-Mailbox → cwd のフォルダ名 (protocol.md §2 Event、design.md §3.4)。
  // cwd からの推測は、その名前の Mailbox があるときだけ使う
  private resolveMailbox(sessionId: string | undefined, header: string | undefined, cwd: string | undefined): string | undefined {
    const known = sessionId ? this.sessionMailbox.get(sessionId) : undefined
    if (known) return known
    let name: string | undefined
    if (header && isValidName(header)) name = header
    else if (cwd && this.store.getMailbox(mailboxFromFolder(cwd))) name = mailboxFromFolder(cwd)
    if (!name) return undefined
    // 第二・第三手段で解決できたら session を覚え、以後は第一手段と同じに扱う
    if (sessionId) {
      this.sessionMailbox.set(sessionId, name)
      const atId = this.store.getMailbox(name)?.attachment
      const at = atId ? this.attachments.get(atId) : undefined
      if (at && !at.sessionId) at.sessionId = sessionId
    }
    return name
  }

  // --- Mailbox / Attachment ---

  // 接続中 (attach 中) の Mailbox は消さない。消すのは購読・role・cursor・未読の状態で、ログの Message は残す。
  // 同名で作り直したときの cursor は削除時点の seq から始まる (store.ts deletedAt)
  deleteMailbox(name: string): void {
    const mb = this.mustMailbox(name)
    if (mb.attachment) throw new HubError(409, 'mailbox_attached', `mailbox ${name} は attach 中のため削除できない。先に detach する`)
    this.store.deleteMailbox(name)
    this.lastDetached.delete(name)
    this.emitUi('mailbox.deleted', { name })
  }

  // 冪等。未読は Mailbox の cursor から再送されるので、attach し直しても失われない
  attach(name: string, input: AttachInput): AttachResult {
    // 定義にない role は拒む (typo で黙って何も届かない事故を防ぐ)。role を省いた (undefined) と null は通す
    if (this.roles && typeof input.role === 'string' && !this.roles.has(input.role)) {
      throw new HubError(400, 'unknown_role', `role ${input.role} は roles.json にない`)
    }
    const { mailbox, created } = this.store.ensureMailbox(name, input.role)
    if (created) this.emitUi('mailbox.created', mailbox)

    // takeover: 排他・新しい方が勝つ (design.md §9-1)
    const superseded = mailbox.attachment
    const previous = superseded ? this.attachments.get(superseded) : undefined
    if (superseded) this.endAttachment(superseded, 'superseded')
    // 同じセッションの attach し直し (shim の再起動など) は切り離しではない
    if (previous?.sessionId && previous.sessionId !== input.sessionId) this.supersededSessions.add(previous.sessionId)
    if (input.sessionId) this.supersededSessions.delete(input.sessionId)

    const at: Attachment = {
      attachmentId: newId('at'),
      mailbox: name,
      client: input.client,
      sessionId: input.sessionId,
      cwd: input.cwd,
      attachedAt: this.now().toISOString(),
      leaseUntil: '',
    }
    this.attachments.set(at.attachmentId, at)
    // 同じセッションの attach し直し (/mcp の再接続などで古い方が猶予中に残っていた) は交代ではないので出さない
    if (previous && !(previous.sessionId && previous.sessionId === input.sessionId)) this.takeovers.set(at.attachmentId, { at: at.attachedAt, previous })
    this.store.setAttachment(name, at.attachmentId)
    this.lastDetached.delete(name)
    // attach ツールで Mailbox を切り替えても、session の対応は最新の attach に追従する
    if (input.sessionId) this.sessionMailbox.set(input.sessionId, name)
    // stream を開かないクライアント (polling) もあるので、切断の猶予ではなくリースで待つ
    this.renewLease(at.attachmentId)
    this.emitUi('attachment.attached', at)
    const skipped = this.trimUnread(name, input.maxAgeMs ?? this.unreadMaxAgeMs, input.maxUnread ?? this.unreadMax)

    return {
      attachmentId: at.attachmentId,
      role: mailbox.role,
      roleDescription: (mailbox.role && this.roles?.get(mailbox.role)?.description) || null,
      // 省いた分だけ進んでいる (store の Mailbox は書き込みのたびに差し替わる)
      cursor: this.mustMailbox(name).cursor,
      truncated: skipped > 0,
      skipped,
      leaseUntil: at.leaseUntil,
      superseded,
    }
  }

  // 長く離れた後の attach に古い未読を一度に流し込まない (design.md §3.3)。maxAgeMs より古いものと、
  // 新しい maxUnread 件より前のものを放棄済みとして cursor を進める。未読は seq 順なので、捨てるのは常に先頭の連続した範囲。
  // Message のログは消さない (UI からは見える)。戻り値は捨てた件数
  private trimUnread(name: string, maxAgeMs: number, maxUnread: number): number {
    const unread = this.store.unread(name)
    let drop = maxUnread > 0 ? Math.max(0, unread.length - maxUnread) : 0
    if (maxAgeMs > 0) {
      const cutoff = this.now().getTime() - maxAgeMs
      while (drop < unread.length && Date.parse(unread[drop]!.ts) < cutoff) drop++
    }
    if (drop === 0) return 0
    const cursor = this.store.advanceCursor(name, unread[drop - 1]!.seq)
    this.emitUi('mailbox.acked', { name, cursor })
    return drop
  }

  detach(attachmentId: string): void {
    this.mustAttachment(attachmentId)
    this.endAttachment(attachmentId, 'closed')
  }

  // リースを延ばす。応答は延ばした後の期限
  heartbeat(attachmentId: string): { leaseUntil: string } {
    this.mustAttachment(attachmentId)
    return { leaseUntil: this.renewLease(attachmentId) }
  }

  // 期限に来たとき stream が開いていれば延ばし直す (stream が生きている間はリースを保つ)。なければ detach する
  private renewLease(attachmentId: string): string {
    const at = this.mustAttachment(attachmentId)
    at.leaseUntil = new Date(this.now().getTime() + this.leaseMs).toISOString()
    clearTimeout(this.leaseTimers.get(attachmentId))
    const t = setTimeout(() => {
      this.leaseTimers.delete(attachmentId)
      if (!this.attachments.has(attachmentId)) return
      if (this.sinks.has(attachmentId)) this.renewLease(attachmentId)
      else this.endAttachment(attachmentId, 'lease_expired')
    }, this.leaseMs)
    t.unref()
    this.leaseTimers.set(attachmentId, t)
    return at.leaseUntil
  }

  // stream が切れた状態が disconnectGraceMs 続いたら detach する
  private armGrace(attachmentId: string): void {
    this.clearGrace(attachmentId)
    const t = setTimeout(() => {
      this.graceTimers.delete(attachmentId)
      if (!this.sinks.has(attachmentId)) this.endAttachment(attachmentId, 'disconnected')
    }, this.disconnectGraceMs)
    t.unref()
    this.graceTimers.set(attachmentId, t)
  }

  private clearGrace(attachmentId: string): void {
    clearTimeout(this.graceTimers.get(attachmentId))
    this.graceTimers.delete(attachmentId)
  }

  // superseded だけ stream に terminated を送ってから閉じる。ほかは detached として Mailbox に残す
  private endAttachment(attachmentId: string, reason: 'superseded' | DetachReason): void {
    const at = this.attachments.get(attachmentId)
    if (!at) return
    this.clearGrace(attachmentId)
    clearTimeout(this.leaseTimers.get(attachmentId))
    this.leaseTimers.delete(attachmentId)
    this.attachments.delete(attachmentId)
    this.takeovers.delete(attachmentId)
    const mb = this.store.getMailbox(at.mailbox)
    if (mb?.attachment === attachmentId) this.store.setAttachment(at.mailbox, null)
    const sink = this.sinks.get(attachmentId)
    this.sinks.delete(attachmentId)
    if (reason === 'superseded') {
      sink?.close('superseded')
      this.emitUi('attachment.superseded', { ...at, reason })
      return
    }
    sink?.close()
    const detached: DetachedAttachment = { ...at, detachedAt: this.now().toISOString(), reason }
    this.lastDetached.set(at.mailbox, detached)
    this.emitUi('attachment.detached', detached)
  }

  // stream を開く。after より後の未読を seq 順に送ってから新着を流す。
  // 同じ Attachment で開き直したら古い stream は閉じる。戻り値で登録を外す
  openStream(attachmentId: string, after: number, sink: AttachmentSink): () => void {
    const at = this.mustAttachment(attachmentId)
    const old = this.sinks.get(attachmentId)
    this.sinks.set(attachmentId, sink)
    this.clearGrace(attachmentId)
    this.renewLease(attachmentId)
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

  // cursor が実際に進んだときだけ mailbox.acked を UI に流す (未読数が変わるのはこのとき)
  ack(attachmentId: string, upTo: number): number {
    const name = this.mustAttachment(attachmentId).mailbox
    this.renewLease(attachmentId)
    const before = this.mustMailbox(name).cursor
    const cursor = this.store.advanceCursor(name, upTo)
    if (cursor > before) this.emitUi('mailbox.acked', { name, cursor })
    return cursor
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

  // GET /mailboxes 向け。実効購読・未読数・Attachment と、接続していなければ最後に detached になった Attachment、
  // 接続中の Attachment が takeover で始まったなら切り離した旧 Attachment を添える
  describeMailboxes() {
    return this.store.listMailboxes().map((mb) => {
      const attachment = mb.attachment ? (this.attachments.get(mb.attachment) ?? null) : null
      return {
        ...mb,
        effectiveSubscriptions: this.store.effectiveSubscriptions(mb.name),
        unread: this.store.unread(mb.name).length,
        attachment,
        detached: attachment ? null : (this.lastDetached.get(mb.name) ?? null),
        takeover: attachment ? (this.takeovers.get(attachment.attachmentId) ?? null) : null,
      }
    })
  }
}
