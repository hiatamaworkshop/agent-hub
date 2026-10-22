// Hub の状態。変更はすべて JSONL に 1 行ずつ追記し、起動時に先頭から再生して復元する。
// Attachment は永続化しない (Hub が再起動したら shim が attach し直す)。
// 消した Message と Event は削除の行を追記し、compact() で今の状態だけのファイルに詰め直す (design.md §3.14)
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { normalizeProjectPath, type Address, type HubEvent, type Mailbox, type Message } from '../shared/types.js'
import { newId } from './ids.js'

type LogRecord =
  | { op: 'message'; message: Message }
  // received がない行は受領の記録を持つ前の形式。received は cursor に追従させる
  | { op: 'mailbox.create'; name: string; role: string | null; createdAt: string; cursor: number; received?: number; seq: number }
  | { op: 'mailbox.delete'; name: string; seq: number }
  | { op: 'mailbox.role'; name: string; role: string | null; seq: number }
  // attach で申告された cwd (design.md §3.3)。この行より前の Mailbox は project を持たない
  | { op: 'mailbox.project'; name: string; project: string }
  | { op: 'subscribe'; name: string; topic: string; seq: number }
  | { op: 'unsubscribe'; name: string; topic: string }
  | { op: 'cursor'; name: string; cursor: number }
  // 受領の確認 (protocol.md §4)。cursor も少なくともここまで進む
  | { op: 'received'; name: string; received: number }
  | { op: 'event'; event: HubEvent }
  | { op: 'message.delete'; id: string }
  | { op: 'event.delete'; id: string }
  // 詰め直したファイルの先頭。Message を全部消しても seq を巻き戻さない
  | { op: 'seq'; seq: number }
  // 返信が消えた後も、その request が返信済みだったことを残す (詰め直しで返信の Message がなくなるため)。
  // 相手からの後の Message で閉じた request (C28) も同じ行で残す
  | { op: 'replied'; id: string }

interface MailboxState {
  name: string
  role: string | null
  roleSince: number
  createdAt: string
  project: string | null
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

// やりとりの Message: request か reply。notice (返信を求めない知らせ) と無編集転送 (他人の本文) は除く。
// 送り手が相手に応じて動いた印として、相手の返信待ちの request を閉じ (C28)、送り手に渡してあった分を受領の確認にする (C39)。
// 2 つの規則はこの判定だけを使う (protocol.md §2・§4)
function isExchange(m: Message): boolean {
  return m.kind !== 'notice' && m.forwardedFrom === undefined
}

// 件数と、そのうち最も古い Message の ts (なければ null)
export interface Tally {
  count: number
  oldestAt: string | null
}

export interface Outgoing extends Tally {
  // 宛先 (種類と id) ごとの件数と最も古い ts。古い順。UI は Waiting on others の宛先と、人宛ての Needs you (C40) に使う
  to: Array<{ type: Address['type']; id: string } & Tally>
}

export interface Backlog {
  unread: Tally
  awaitingReply: Tally
  unconfirmed: Tally
  // この Mailbox が出して、まだ返信のない request (ほかの層と重ならない。宛先の側の数ではない)
  outgoing: Outgoing
  // この Mailbox 宛てで最後に渡した (seq ≤ cursor) Message。UI が最後のターン終了と比べて作業中かを導く (design.md §3.15)
  lastHanded: { seq: number; ts: string } | null
}

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
  // 返信のある Message の id (返信の replyTo) と、相手からの後の Message で閉じた request の id (C28、answeredBy)。
  // 返信待ちの request を自動で消さないため (design.md §3.14)
  private readonly repliedTo = new Set<string>()
  // 返信待ちの request (id → Message)。追記順 = seq の昇順。溜まりの材料をログ全体の走査なしで数えるため
  private readonly openRequests = new Map<string, Message>()
  // 前回の詰め直しから追記した削除の行の数
  private deletesSinceCompact = 0
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
    // 続いた削除の行はまとめて 1 度で外す (1 行ずつだと 消す件数 × 全件 になる。詰め直す前に落ちたときに効く)
    const pending = { messages: new Set<string>(), events: new Set<string>() }
    const flush = () => {
      this.removeMessages(pending.messages)
      this.removeEvents(pending.events)
      pending.messages.clear()
      pending.events.clear()
    }
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
      if (rec.op === 'message.delete' || rec.op === 'event.delete') {
        ;(rec.op === 'message.delete' ? pending.messages : pending.events).add(rec.id)
        this.deletesSinceCompact++
        return
      }
      flush()
      this.apply(rec)
    })
    flush()
  }

  private write(rec: LogRecord): void {
    this.apply(rec)
    if (this.file) appendFileSync(this.file, JSON.stringify(rec) + '\n')
  }

  private apply(rec: LogRecord): void {
    switch (rec.op) {
      case 'message':
        // 閉じる request はログの順から導く (記録しない)。追記したときと再生したときで、前にある行が同じなので結果も同じ。
        // 詰め直した後は replied の行が残す
        for (const r of this.answeredBy(rec.message)) this.markReplied(r.id)
        this.messages.push(rec.message)
        this.byId.set(rec.message.id, rec.message)
        this.seq = Math.max(this.seq, rec.message.seq)
        if (rec.message.replyTo) this.markReplied(rec.message.replyTo)
        if (rec.message.kind === 'request' && !this.repliedTo.has(rec.message.id)) this.openRequests.set(rec.message.id, rec.message)
        break
      // 削除の行は replay がまとめて、実行中は deleteMessages / deleteEvents が扱う
      case 'message.delete':
      case 'event.delete':
        break
      case 'seq':
        this.seq = Math.max(this.seq, rec.seq)
        break
      case 'replied':
        this.markReplied(rec.id)
        break
      case 'mailbox.create':
        this.mailboxes.set(rec.name, {
          name: rec.name,
          role: rec.role,
          roleSince: rec.seq,
          createdAt: rec.createdAt,
          project: null,
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
      case 'mailbox.project': {
        const mb = this.mailboxes.get(rec.name)
        if (mb) mb.project = rec.project
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

  private markReplied(id: string): void {
    this.repliedTo.add(id)
    this.openRequests.delete(id)
  }

  // --- Message ---

  // やりとりの Message が送り手について示すことは、閉じる request (apply が answeredBy で導く) と受領の確認の 2 つ。
  // 受領の確認は、送り手の Mailbox に渡してあった分 (cursor まで) すべて (C39)。渡す前の分は未読のまま届くので確認にしない
  appendMessage(m: NewMessage): Message {
    const message: Message = { id: newId('m'), seq: this.seq + 1, ts: this.now().toISOString(), ...m }
    this.write({ op: 'message', message })
    const sender = isExchange(message) && message.from.type === 'mailbox' ? this.mailboxes.get(message.from.id) : undefined
    if (sender) this.advanceReceived(sender.name, sender.cursor)
    return message
  }

  // m が閉じる返信待ちの request (C28、protocol.md §2)。request R は、R の受け手から R の送り手へのやりとりの Message で閉じる。
  // R の送り手自身の Message では閉じない。人の browser と cli は同じ人として扱う。
  // openRequests には m より前の行しかない (再生でも追記でも、その行を適用する前に呼ぶ)
  private answeredBy(m: Message): Message[] {
    if (!isExchange(m)) return []
    const out: Message[] = []
    for (const r of this.openRequests.values()) {
      if (m.from.type === r.from.type && (m.from.type === 'user' || m.from.id === r.from.id)) continue
      const fromRecipient = r.to.type === 'user' ? m.from.type === 'user' : m.from.type === 'mailbox' && this.isRecipient(m.from.id, r)
      if (!fromRecipient) continue
      const toSender =
        r.from.type === 'user' ? m.to.type === 'user' : (m.to.type === 'mailbox' || m.to.type === 'role') && this.isRecipient(r.from.id, m)
      if (toSender) out.push(r)
    }
    return out
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
      project: mb.project,
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

  // 同じ文字列なら記録しない。違うフォルダかの判断は Hub が行う (表記の揺れも記録は新しい方に揃える)
  setProject(name: string, project: string): void {
    if (this.must(name).project !== project) this.write({ op: 'mailbox.project', name, project })
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
        if (mb.role !== m.to.id) return false
        // project のない role 宛ては、送った時点でその role を持っていた Mailbox だけ。後から作られた (別のプロジェクトの) Mailbox に古い依頼を流さない。
        // project のある role 宛ては、Mailbox のまだないプロジェクトにも置ける (design.md §3.15「プロジェクトは値」)
        if (m.to.project === undefined) return m.seq > mb.roleSince
        return mb.project !== null && normalizeProjectPath(mb.project) === normalizeProjectPath(m.to.project)
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

  // 溜まりのバッジの材料 (design.md §3.15)。この Mailbox 宛てを重ならないように分け、件数と最も古い ts を返す。
  // 未読 (seq > cursor)、渡したが返信のない request、それ以外で渡したが受領の確認がないもの。
  // Channels では返信まで受領の確認がないので、返信待ちの request を確認待ちから外す (作業中の request を「怪しい」に数えない)
  backlog(name: string): Backlog {
    return this.summary(name).backlog
  }

  // GET /mailboxes 向けに、未読数・確認待ち数 (unread() / unconfirmed() の件数) と溜まりの材料を 1 度に数える。
  // 見るのは received より後 (cursor ≥ received) と返信待ちの request だけで、ログ全体は走査しない
  summary(name: string): { unread: number; unconfirmed: number; backlog: Backlog } {
    const mb = this.must(name)
    const backlog: Backlog = {
      unread: { count: 0, oldestAt: null },
      awaitingReply: { count: 0, oldestAt: null },
      unconfirmed: { count: 0, oldestAt: null },
      outgoing: { count: 0, oldestAt: null, to: [] },
      lastHanded: null,
    }
    const add = (t: { count: number; oldestAt: string | null }, m: Message) => {
      t.count++
      t.oldestAt ??= m.ts
    }
    for (const m of this.openRequests.values()) {
      if (m.from.type === 'mailbox' && m.from.id === name) {
        add(backlog.outgoing, m)
        let to = backlog.outgoing.to.find((a) => a.type === m.to.type && a.id === m.to.id)
        if (!to) backlog.outgoing.to.push((to = { type: m.to.type, id: m.to.id, count: 0, oldestAt: null }))
        add(to, m)
      }
      if (m.seq <= mb.cursor && this.isRecipient(name, m)) add(backlog.awaitingReply, m)
    }
    // 新しい方から、渡した分のうち最初に当たるこの Mailbox 宛て
    for (let i = this.indexAfter(mb.cursor) - 1; i >= 0; i--) {
      const m = this.messages[i]!
      if (!this.isRecipient(name, m)) continue
      backlog.lastHanded = { seq: m.seq, ts: m.ts }
      break
    }
    let unconfirmed = 0
    for (let i = this.indexAfter(mb.received); i < this.messages.length; i++) {
      const m = this.messages[i]!
      if (!this.isRecipient(name, m)) continue
      if (m.seq > mb.cursor) add(backlog.unread, m)
      else {
        unconfirmed++
        if (!this.isAwaitingReply(m)) add(backlog.unconfirmed, m)
      }
    }
    return { unread: backlog.unread.count, unconfirmed, backlog }
  }

  // --- 削除と保存期間 (design.md §3.14) ---

  // 消した Message の返信先は返信済みのまま残す (request は返信がついた時点で返信待ちではなくなる)
  private removeMessages(ids: Set<string>): void {
    if (ids.size === 0) return
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i]!
      if (!ids.has(m.id)) continue
      this.messages.splice(i, 1)
      this.byId.delete(m.id)
      this.repliedTo.delete(m.id)
      this.openRequests.delete(m.id)
    }
  }

  private removeEvents(ids: Set<string>): void {
    if (ids.size === 0) return
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i]!
      if (!ids.has(e.id)) continue
      this.events.splice(i, 1)
      this.eventById.delete(e.id)
    }
    // 変換は session の直前の Event を見るので、残っている中の最新に付け替える
    this.lastEventBySession.clear()
    for (const e of this.events) if (e.sessionId) this.lastEventBySession.set(e.sessionId, e)
  }

  deleteMessage(id: string): boolean {
    return this.deleteMessages([id]).length > 0
  }

  deleteEvent(id: string): boolean {
    return this.deleteEvents([id]).length > 0
  }

  // まとめて消す。走査と追記を 1 度で済ませる (1 件ずつだと 消す件数 × 全件 になり、その間 Hub が止まる)。応答は実際に消した id
  deleteMessages(ids: readonly string[]): string[] {
    const found = [...new Set(ids)].filter((id) => this.byId.has(id))
    this.removeMessages(new Set(found))
    this.appendDeletes('message.delete', found)
    return found
  }

  deleteEvents(ids: readonly string[]): string[] {
    const found = [...new Set(ids)].filter((id) => this.eventById.has(id))
    this.removeEvents(new Set(found))
    this.appendDeletes('event.delete', found)
    return found
  }

  private appendDeletes(op: 'message.delete' | 'event.delete', ids: readonly string[]): void {
    if (ids.length === 0) return
    this.deletesSinceCompact += ids.length
    if (this.file) appendFileSync(this.file, ids.map((id) => JSON.stringify({ op, id }) + '\n').join(''))
  }

  // 返信待ちの request (kind: request で、それを replyTo に持つ Message がまだなく、相手からの後の Message でも閉じていない)
  isAwaitingReply(m: Message): boolean {
    return m.kind === 'request' && !this.repliedTo.has(m.id)
  }

  // 渡し終えた: 今ある受け手の Mailbox すべてで cursor ≥ seq。受け手の Mailbox がなければ送った時点で渡し終えている
  isHandedToAll(m: Message): boolean {
    for (const mb of this.mailboxes.values()) {
      if (m.seq > mb.cursor && this.isRecipient(mb.name, m)) return false
    }
    return true
  }

  // 自動で消してよい Message: cutoff (ms) 以前に送られ、渡し終えていて、返信待ちの request でない
  expiredMessages(cutoff: number): Message[] {
    return this.messages.filter((m) => Date.parse(m.ts) <= cutoff && !this.isAwaitingReply(m) && this.isHandedToAll(m))
  }

  expiredEvents(cutoff: number): HubEvent[] {
    return this.events.filter((e) => Date.parse(e.ts) <= cutoff)
  }

  // 削除の行があれば、今の状態だけを書いたファイルに置き換える。一時ファイルに書いてから rename する。
  // 失敗しても削除の行は残っているので、状態は変わらない (次の機会に詰め直す)
  compact(): boolean {
    if (!this.file || this.deletesSinceCompact === 0) return false
    const recs: LogRecord[] = [{ op: 'seq', seq: this.seq }]
    // 削除した Mailbox の削除時点の seq (作り直したときに古い直接宛てを再送しないため)。作り直した Mailbox の create より前に置く
    for (const [name, seq] of this.deletedAt) recs.push({ op: 'mailbox.delete', name, seq })
    for (const mb of this.mailboxes.values()) {
      // create の seq は role を持った時点 (roleSince) として読まれる
      recs.push({ op: 'mailbox.create', name: mb.name, role: mb.role, createdAt: mb.createdAt, cursor: mb.cursor, received: mb.received, seq: mb.roleSince })
      if (mb.project !== null) recs.push({ op: 'mailbox.project', name: mb.name, project: mb.project })
      for (const [topic, seq] of mb.subscriptions) recs.push({ op: 'subscribe', name: mb.name, topic, seq })
    }
    for (const message of this.messages) {
      recs.push({ op: 'message', message })
      if (this.repliedTo.has(message.id)) recs.push({ op: 'replied', id: message.id })
    }
    for (const event of this.events) recs.push({ op: 'event', event })
    const tmp = `${this.file}.tmp`
    try {
      writeFileSync(tmp, recs.map((r) => JSON.stringify(r) + '\n').join(''))
      renameSync(tmp, this.file)
    } catch (e) {
      console.warn(`[store] ${this.file} を詰め直せなかった: ${(e as Error).message}`)
      return false
    }
    this.deletesSinceCompact = 0
    return true
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
