// Hub の状態。変更はすべて JSONL に 1 行ずつ追記し、起動時に先頭から再生して復元する。
// Attachment は永続化しない (Hub が再起動したら shim が attach し直す)。
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { HubEvent, Mailbox, Message } from '../shared/types.js'
import { newId } from './ids.js'

type LogRecord =
  | { op: 'message'; message: Message }
  // received がない行は受領の記録を持つ前の形式。received は cursor に追従させる
  | { op: 'mailbox.create'; name: string; role: string | null; createdAt: string; cursor: number; received?: number; seq: number }
  | { op: 'mailbox.delete'; name: string; seq: number }
  | { op: 'mailbox.role'; name: string; role: string | null; seq: number }
  | { op: 'subscribe'; name: string; topic: string; seq: number }
  | { op: 'unsubscribe'; name: string; topic: string }
  | { op: 'cursor'; name: string; cursor: number }
  // 受領の確認 (protocol.md §4)。cursor も少なくともここまで進む
  | { op: 'received'; name: string; received: number }
  | { op: 'event'; event: HubEvent }

interface MailboxState {
  name: string
  role: string | null
  roleSince: number
  createdAt: string
  // トピック → 購読した時点の seq。購読より前のトピック宛ては未読にしない
  subscriptions: Map<string, number>
  cursor: number
  // 受領の確認がある seq の上限。cursor との間が「渡したが確認がない」分 (protocol.md §4)
  received: number
  // 前の形式の記録から復元中の Mailbox。received を cursor に追従させる (復元の後に received を記録して外す)
  legacy: boolean
  attachment: string | null
}

export type NewMessage = Omit<Message, 'id' | 'seq' | 'ts'>

export interface StoreOptions {
  // 省略するとメモリのみ (テスト用)
  file?: string
  // role の既定購読 (roles.json。P2)
  roleSubscriptions?: (role: string) => readonly string[]
  now?: () => Date
}

export class Store {
  private readonly file: string | undefined
  private readonly roleSubscriptions: (role: string) => readonly string[]
  private readonly now: () => Date
  private readonly messages: Message[] = []
  private readonly byId = new Map<string, Message>()
  private readonly mailboxes = new Map<string, MailboxState>()
  // 削除した Mailbox 名 → 削除時点の seq。作り直したときに古い直接宛てを再送しないため
  private readonly deletedAt = new Map<string, number>()
  private readonly events: HubEvent[] = []
  private readonly eventById = new Map<string, HubEvent>()
  // sessionId → その session の最新の Event (変換が直前の Event を見るため)
  private readonly lastEventBySession = new Map<string, HubEvent>()
  private seq = 0

  constructor(opts: StoreOptions = {}) {
    this.file = opts.file
    this.roleSubscriptions = opts.roleSubscriptions ?? (() => [])
    this.now = opts.now ?? (() => new Date())
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true })
      if (existsSync(this.file)) {
        const text = readFileSync(this.file, 'utf8')
        this.replay(text)
        // 途中で切れた最終行に次の追記がつながらないよう閉じておく
        if (text.length > 0 && !text.endsWith('\n')) appendFileSync(this.file, '\n')
      }
    }
    // 前の形式の Mailbox は、復元した cursor までを確認済みとして記録し、以後は received を cursor に追従させない
    for (const mb of this.mailboxes.values()) {
      if (mb.legacy) this.write({ op: 'received', name: mb.name, received: mb.cursor })
    }
  }

  get lastSeq(): number {
    return this.seq
  }

  private replay(text: string): void {
    const lines = text.split(/\r?\n/)
    lines.forEach((line, i) => {
      if (!line.trim()) return
      let rec: LogRecord
      try {
        rec = JSON.parse(line) as LogRecord
      } catch {
        // 追記中に落ちた最終行は捨てる。途中の行が壊れているのは異常なので知らせる
        if (i < lines.length - 2) console.warn(`[store] ${this.file}:${i + 1} を読めないため飛ばした`)
        return
      }
      this.apply(rec)
    })
  }

  private write(rec: LogRecord): void {
    this.apply(rec)
    if (this.file) appendFileSync(this.file, JSON.stringify(rec) + '\n')
  }

  private apply(rec: LogRecord): void {
    switch (rec.op) {
      case 'message':
        this.messages.push(rec.message)
        this.byId.set(rec.message.id, rec.message)
        this.seq = Math.max(this.seq, rec.message.seq)
        break
      case 'mailbox.create':
        this.mailboxes.set(rec.name, {
          name: rec.name,
          role: rec.role,
          roleSince: rec.seq,
          createdAt: rec.createdAt,
          subscriptions: new Map(),
          cursor: rec.cursor,
          received: rec.received ?? rec.cursor,
          legacy: rec.received === undefined,
          attachment: null,
        })
        break
      case 'mailbox.delete':
        this.mailboxes.delete(rec.name)
        this.deletedAt.set(rec.name, rec.seq)
        break
      case 'mailbox.role': {
        const mb = this.mailboxes.get(rec.name)
        if (mb) {
          mb.role = rec.role
          mb.roleSince = rec.seq
        }
        break
      }
      case 'subscribe':
        this.mailboxes.get(rec.name)?.subscriptions.set(rec.topic, rec.seq)
        break
      case 'unsubscribe':
        this.mailboxes.get(rec.name)?.subscriptions.delete(rec.topic)
        break
      case 'cursor': {
        const mb = this.mailboxes.get(rec.name)
        if (mb) {
          mb.cursor = rec.cursor
          if (mb.legacy) mb.received = rec.cursor
        }
        break
      }
      case 'received': {
        const mb = this.mailboxes.get(rec.name)
        if (mb) {
          mb.legacy = false
          mb.received = rec.received
          mb.cursor = Math.max(mb.cursor, rec.received)
        }
        break
      }
      case 'event':
        this.events.push(rec.event)
        this.eventById.set(rec.event.id, rec.event)
        if (rec.event.sessionId) this.lastEventBySession.set(rec.event.sessionId, rec.event)
        break
    }
  }

  // --- Message ---

  appendMessage(m: NewMessage): Message {
    const message: Message = { id: newId('m'), seq: this.seq + 1, ts: this.now().toISOString(), ...m }
    this.write({ op: 'message', message })
    return message
  }

  getMessage(id: string): Message | undefined {
    return this.byId.get(id)
  }

  listMessages(after = 0, limit = 100): Message[] {
    const i = this.indexAfter(after)
    return this.messages.slice(i, i + limit)
  }

  // seq が after より大きい最初の位置。messages は追記順 = seq の昇順なので二分探索できる
  private indexAfter(after: number): number {
    let lo = 0
    let hi = this.messages.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.messages[mid]!.seq > after) hi = mid
      else lo = mid + 1
    }
    return lo
  }

  // --- Mailbox ---

  getMailbox(name: string): Mailbox | undefined {
    const mb = this.mailboxes.get(name)
    return mb && this.view(mb)
  }

  listMailboxes(): Mailbox[] {
    return [...this.mailboxes.values()].map((mb) => this.view(mb))
  }

  private view(mb: MailboxState): Mailbox {
    return {
      name: mb.name,
      role: mb.role,
      createdAt: mb.createdAt,
      subscriptions: [...mb.subscriptions.keys()],
      cursor: mb.cursor,
      received: mb.received,
      attachment: mb.attachment,
    }
  }

  private must(name: string): MailboxState {
    const mb = this.mailboxes.get(name)
    if (!mb) throw new Error(`mailbox not found: ${name}`)
    return mb
  }

  // なければ作る。role は指定されたときだけ更新する (protocol.md §3 attach)
  ensureMailbox(name: string, role?: string | null): { mailbox: Mailbox; created: boolean } {
    let created = false
    if (!this.mailboxes.has(name)) {
      const cursor = this.deletedAt.get(name) ?? 0
      this.write({
        op: 'mailbox.create',
        name,
        role: role ?? null,
        createdAt: this.now().toISOString(),
        cursor,
        received: cursor,
        seq: this.seq,
      })
      created = true
    } else if (role !== undefined && this.must(name).role !== role) {
      this.write({ op: 'mailbox.role', name, role, seq: this.seq })
    }
    return { mailbox: this.view(this.must(name)), created }
  }

  deleteMailbox(name: string): boolean {
    if (!this.mailboxes.has(name)) return false
    this.write({ op: 'mailbox.delete', name, seq: this.seq })
    return true
  }

  // 変化があれば true
  subscribe(name: string, topic: string): boolean {
    if (this.must(name).subscriptions.has(topic)) return false
    this.write({ op: 'subscribe', name, topic, seq: this.seq })
    return true
  }

  unsubscribe(name: string, topic: string): boolean {
    if (!this.must(name).subscriptions.has(topic)) return false
    this.write({ op: 'unsubscribe', name, topic })
    return true
  }

  // 個別購読と role の既定購読の和
  effectiveSubscriptions(name: string): string[] {
    const mb = this.must(name)
    const role = mb.role ? this.roleSubscriptions(mb.role) : []
    return [...new Set([...mb.subscriptions.keys(), ...role])]
  }

  // cursor は後退させず、採番済みの seq を超えさせない。進めた後の値を返す
  advanceCursor(name: string, upTo: number): number {
    const mb = this.must(name)
    const next = Math.min(Math.floor(upTo), this.seq)
    if (next > mb.cursor) this.write({ op: 'cursor', name, cursor: next })
    return mb.cursor
  }

  // 受領の確認。received と cursor を upTo まで進める (後退させず、採番済みの seq を超えさせない)。進めた後の received を返す
  advanceReceived(name: string, upTo: number): number {
    const mb = this.must(name)
    const next = Math.min(Math.floor(upTo), this.seq)
    if (next > mb.received) this.write({ op: 'received', name, received: next })
    return mb.received
  }

  // Attachment は実行時の状態なので記録しない
  setAttachment(name: string, attachmentId: string | null): void {
    this.must(name).attachment = attachmentId
  }

  // この Mailbox 宛てか (直接宛て・自分の role 宛て・実効購読のトピック宛て)
  isRecipient(name: string, m: Message): boolean {
    const mb = this.mailboxes.get(name)
    if (!mb) return false
    switch (m.to.type) {
      case 'mailbox':
        return m.to.id === name
      case 'role':
        return mb.role === m.to.id
      case 'topic': {
        const since = mb.subscriptions.get(m.to.id)
        if (since !== undefined && m.seq > since) return true
        return mb.role !== null && m.seq > mb.roleSince && this.roleSubscriptions(mb.role).includes(m.to.id)
      }
      case 'user':
        return false
    }
  }

  unread(name: string, after?: number, limit = Infinity): Message[] {
    return this.addressed(name, Math.max(after ?? 0, this.must(name).cursor), limit)
  }

  // after より後のこの Mailbox 宛て (cursor で切らない。inbox の unconfirmed 用)
  addressed(name: string, after: number, limit = Infinity): Message[] {
    const out: Message[] = []
    for (let i = this.indexAfter(after); i < this.messages.length && out.length < limit; i++) {
      const m = this.messages[i]!
      if (this.isRecipient(name, m)) out.push(m)
    }
    return out
  }

  // 渡したが受領の確認がない分 (received より後で cursor まで)
  unconfirmed(name: string): Message[] {
    const mb = this.must(name)
    const out: Message[] = []
    for (let i = this.indexAfter(mb.received); i < this.messages.length && this.messages[i]!.seq <= mb.cursor; i++) {
      const m = this.messages[i]!
      if (this.isRecipient(name, m)) out.push(m)
    }
    return out
  }

  // --- Event ---

  addEvent(e: HubEvent): void {
    this.write({ op: 'event', event: e })
  }

  getEvent(id: string): HubEvent | undefined {
    return this.eventById.get(id)
  }

  lastEventOf(sessionId: string): HubEvent | undefined {
    return this.lastEventBySession.get(sessionId)
  }

  // 新しい方から limit 件を、古い順に返す
  listEvents(limit = 100): HubEvent[] {
    return this.events.slice(-limit)
  }
}
