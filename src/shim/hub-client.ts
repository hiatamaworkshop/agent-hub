// Hub との通信。attach → stream → ack を繰り返し、切れたら attach からやり直す。
// 未読の正本は Hub の cursor にあるので、ここで持つのは重複除去用の直近 id と、今の Attachment で渡し終えた seq だけ
import type { Message } from '../shared/types.js'
import type { ShimConfig } from './config.js'

export class HubHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export interface AttachInfo {
  attachmentId: string
  role: string | null
  roleDescription: string | null
  cursor: number
  truncated: boolean
  skipped: number
}

export type ShimState = 'connecting' | 'attached' | 'terminated'

interface SseEvent {
  event: string
  data: string
}

const HEARTBEAT_TIMEOUT_MS = 60_000
const BACKOFF_MIN_MS = 1_000
const BACKOFF_MAX_MS = 30_000
const DEDUPE_SIZE = 1000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class HubClient {
  state: ShimState = 'connecting'
  attachment: AttachInfo | undefined
  terminatedReason: string | undefined
  lastError: string | undefined
  private delivered = 0
  // attach で古い未読が省略された件数。stream を開いたら 1 度だけ伝える (initialize 前の通知は捨てられうるため)。
  // push しないとき (inbox 経路) は takeSkipped で inbox の結果に載せる
  private pendingSkipped = 0
  // false なら stream で受けた Message を渡さず ack もしない (inbox 経路。未読は inbox で取り出すまで残す)。
  // stream は生存の確認のために開いたままにする
  private push = true
  // Attachment を失った (404) ときの ID。attach し直しで Hub に示し、後継がいれば取り返さない (design.md §3.3)
  private previousAttachment: string | undefined
  // attach で名乗るクライアント名。initialize の clientInfo.name が分かるまでは claude-code とする
  // (role の説明を取るため initialize より前に attach するので。setClient で直す)
  private client = 'claude-code'
  private readonly seen = new Set<string>()
  private inflight: Promise<void> | undefined
  private stopped = false
  private abort: AbortController | undefined

  constructor(
    private readonly cfg: ShimConfig,
    // Claude へ渡す。解決したら ack する
    private readonly deliver: (m: Message) => Promise<void>,
    private readonly log: (msg: string) => void,
    // 古い未読を省略したことを Claude へ伝える (protocol.md §6.3)
    private readonly notifySkipped: (skipped: number) => Promise<void> = async () => undefined,
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.cfg.token}` }
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (this.attachment) headers['x-hub-attachment'] = this.attachment.attachmentId
    const res = await fetch(this.cfg.hubUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string; issues?: unknown }
    if (!res.ok) {
      const detail = json.message ?? (json.issues ? JSON.stringify(json.issues) : '')
      throw new HubHttpError(res.status, json.error ?? 'http_error', `${method} ${path} → ${res.status} ${json.error ?? ''} ${detail}`.trim())
    }
    return json as T
  }

  start(): void {
    void this.run()
  }

  // initialize で経路が決まったら、start より前に呼ぶ
  setPush(on: boolean): void {
    this.push = on
  }

  // initialize で分かったクライアント名を Hub に伝える。attach 済みなら Attachment を更新し、以後の attach でも名乗る
  setClient(name: string): void {
    const client = name.slice(0, 64)
    if (client.length === 0 || client === this.client) return
    this.client = client
    if (this.attachment) void this.sendClient()
  }

  private async sendClient(): Promise<void> {
    const at = this.attachment
    if (!at) return
    try {
      await this.request('PATCH', `/attachments/${at.attachmentId}`, { client: this.client })
    } catch (e) {
      // 表示だけの情報なので、失敗しても attach や配送は続ける (古い Hub はこの口を持たない)
      this.log(`client の更新に失敗: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  takeSkipped(): number {
    const n = this.pendingSkipped
    this.pendingSkipped = 0
    return n
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.abort?.abort()
    // start の前に primeAttach で取った Attachment も、ここで解放する
    if (this.attachment) {
      await this.request('DELETE', `/attachments/${this.attachment.attachmentId}`).catch(() => undefined)
    }
  }

  // initialize の応答 (instructions) より前に attach して、role の説明を取る (design.md §3.7)。
  // 時間切れや失敗は undefined を返して先へ進む。attach は start の後に run が受け持つ (説明なしで動く)
  async primeAttach(timeoutMs: number): Promise<AttachInfo | undefined> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`attach が ${timeoutMs}ms 以内に終わらなかった`)), timeoutMs)
    })
    try {
      await Promise.race([this.attach(), timeout])
      return this.attachment
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e)
      this.log(`hub: ${this.lastError}${this.cfg.role ? ' (role の説明なしで起動する)' : ''}`)
      return undefined
    } finally {
      clearTimeout(timer)
    }
  }

  // streamOnce の中で state が変わるので、毎回メソッド越しに読む
  private finished(): boolean {
    return this.stopped || this.state === 'terminated'
  }

  private async run(): Promise<void> {
    let backoff = BACKOFF_MIN_MS
    while (!this.finished()) {
      try {
        if (!this.attachment) await this.attach()
        await this.streamOnce(() => (backoff = BACKOFF_MIN_MS))
      } catch (e) {
        if (this.stopped) break
        // Hub の再起動などで Attachment が消えたら attach し直す (protocol.md §3)
        if (e instanceof HubHttpError && e.status === 404 && this.attachment) {
          this.previousAttachment = this.attachment.attachmentId
          this.attachment = undefined
        }
        // 切れている間に別のセッションが attach していた。terminated (superseded) と同じく attach し直さない
        if (e instanceof HubHttpError && e.status === 409 && e.code === 'successor_attached') {
          this.state = 'terminated'
          this.terminatedReason = 'superseded'
          this.log(`terminated: superseded (${e.message})`)
          break
        }
        this.lastError = e instanceof Error ? e.message : String(e)
        this.log(`hub: ${this.lastError}`)
      }
      if (this.finished()) break
      this.state = 'connecting'
      await sleep(backoff)
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS)
    }
  }

  // 進行中の attach があれば、それを待つ (primeAttach の時間切れの後に run が二重に attach しないように)
  private attach(): Promise<void> {
    this.inflight ??= this.doAttach().finally(() => (this.inflight = undefined))
    return this.inflight
  }

  private async doAttach(): Promise<void> {
    this.attachment = undefined
    const client = this.client
    const r = await this.request<AttachInfo & { superseded: string | null }>('POST', `/mailboxes/${this.cfg.mailbox}/attach`, {
      client,
      ...(this.cfg.role ? { role: this.cfg.role } : {}),
      ...(this.cfg.sessionId ? { sessionId: this.cfg.sessionId } : {}),
      cwd: this.cfg.cwd,
      ...(this.previousAttachment ? { previous: this.previousAttachment } : {}),
    })
    this.attachment = r
    this.previousAttachment = undefined
    // attach の途中で initialize が来て名前が変わっていたら直す
    if (client !== this.client) void this.sendClient()
    // stream の after は Hub の cursor から数え直す。Hub の data/ を消して再起動すると seq が 1 から振り直されるため、
    // 前の Hub で覚えた seq を使うと attach 時の未読を黙って捨てる。ack 漏れで再送された分は id の重複除去で落ちる
    this.delivered = r.cursor
    // 古い Hub は truncated / skipped を返さない
    if (r.truncated && r.skipped > 0) this.pendingSkipped += r.skipped
    this.log(`attached mailbox=${this.cfg.mailbox} attachment=${r.attachmentId} cursor=${r.cursor}${r.superseded ? ` superseded=${r.superseded}` : ''}${r.skipped ? ` skipped=${r.skipped}` : ''}`)
  }

  private async streamOnce(onData: () => void): Promise<void> {
    const at = this.attachment!
    const abort = new AbortController()
    this.abort = abort
    let watchdog = setTimeout(() => abort.abort(), HEARTBEAT_TIMEOUT_MS)
    try {
      const res = await fetch(`${this.cfg.hubUrl}/attachments/${at.attachmentId}/stream?after=${this.delivered}`, {
        headers: { authorization: `Bearer ${this.cfg.token}`, accept: 'text/event-stream' },
        signal: abort.signal,
      })
      if (!res.ok || !res.body) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new HubHttpError(res.status, json.error ?? 'http_error', `stream → ${res.status} ${json.error ?? ''}`.trim())
      }
      this.state = 'attached'
      this.lastError = undefined
      // 未読より先に、省略したことを 1 件で伝える
      if (this.push && this.pendingSkipped > 0) {
        await this.notifySkipped(this.takeSkipped()).catch((e) => this.log(`notice: ${e}`))
      }
      for await (const ev of parseSse(res.body)) {
        clearTimeout(watchdog)
        watchdog = setTimeout(() => abort.abort(), HEARTBEAT_TIMEOUT_MS)
        onData()
        if (ev.event === 'message') await this.onMessage(JSON.parse(ev.data) as Message)
        else if (ev.event === 'terminated') {
          // 別のセッションに引き継がれた等。取り返しの応酬を避けるため attach し直さない (protocol.md §3)
          const { reason } = JSON.parse(ev.data) as { reason: string }
          this.state = 'terminated'
          this.terminatedReason = reason
          this.attachment = undefined
          this.log(`terminated: ${reason}`)
          return
        }
      }
    } catch (e) {
      if (abort.signal.aborted && !this.stopped) throw new Error(`stream が ${HEARTBEAT_TIMEOUT_MS / 1000} 秒途絶えたので再接続する`)
      throw e
    } finally {
      clearTimeout(watchdog)
      abort.abort()
    }
  }

  // 渡し終えた id を覚える。inbox で渡した分も覚え、stream から重ねて渡さない
  remember(id: string): void {
    this.seen.add(id)
    if (this.seen.size > DEDUPE_SIZE) this.seen.delete(this.seen.values().next().value!)
  }

  private async onMessage(m: Message): Promise<void> {
    if (!this.push) return
    if (!this.seen.has(m.id)) {
      await this.deliver(m)
      this.remember(m.id)
    }
    this.delivered = Math.max(this.delivered, m.seq)
    const at = this.attachment
    if (at) {
      // 失敗しても次の attach で再送され、id で重複除去される
      this.request('POST', `/attachments/${at.attachmentId}/ack`, { upTo: m.seq }).catch((e) => this.log(`ack: ${e}`))
    }
  }
}

// text/event-stream を event ごとに切り出す。コメント行 (`:`) は読み飛ばす
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder()
  let buf = ''
  let event = 'message'
  let data: string[] = []
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true })
    let i: number
    while ((i = buf.search(/\r?\n/)) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + (buf[i] === '\r' ? 2 : 1))
      if (line === '') {
        if (data.length > 0) yield { event, data: data.join('\n') }
        event = 'message'
        data = []
      } else if (line.startsWith(':')) {
        // comment
      } else {
        const c = line.indexOf(':')
        const field = c < 0 ? line : line.slice(0, c)
        const value = c < 0 ? '' : line.slice(c + 1).replace(/^ /, '')
        if (field === 'event') event = value
        else if (field === 'data') data.push(value)
      }
    }
  }
}
