// HTTP ルート (protocol.md §3)。入力の検証と応答への変換だけを行い、振る舞いは Hub に任せる
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { setCookie } from 'hono/cookie'
import { bodyLimit } from 'hono/body-limit'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { forwardSchema, isValidName, nameSchema, postMessageSchema, type PostMessageInput, type Sender } from '../shared/types.js'
import { Auth, COOKIE_NAME, type AuthEnv } from './auth.js'
import { Hub, HubError } from './hub.js'
import { pump } from './sse.js'
import { SettingsError, SettingsStore } from './settings.js'
import { FileError, FileStore, MAX_UPLOAD_BYTES, resolveMeta } from './files.js'
import { IndexStore, MAX_INDEX_BYTES, indexInputSchema } from './indexes.js'
import { readFile } from 'node:fs/promises'
import { defaultConfig, type ConfigResult } from './config.js'

export interface AppOptions {
  hub: Hub
  token: string
  // UI の HTML。null なら未配置
  uiHtml: () => Promise<string | null>
  heartbeatMs?: number
  // カスタムコマンドの設定。省略時は /settings を公開しない
  settings?: SettingsStore
  // 画像ファイル。省略時は /files を公開しない
  files?: FileStore
  // roadmap の項目の索引。省略時は /indexes を公開しない
  indexes?: IndexStore
  // hub.config.json の検証済みの値。省略時はすべて既定
  config?: ConfigResult
}

const BROWSER: Sender = { type: 'user', id: 'browser', role: null }
// Bearer で Attachment を名乗らない呼び出し (curl など)
const CLI: Sender = { type: 'user', id: 'cli', role: null }

function intParam(v: string | undefined, def: number, min: number, max: number): number | null {
  if (v === undefined) return def
  if (!/^\d+$/.test(v)) return null
  const n = Number(v)
  return n < min || n > max ? null : n
}

function invalid(c: Context, error: z.ZodError | string) {
  if (typeof error === 'string') return c.json({ error: 'invalid_request', message: error }, 400)
  return c.json({ error: 'invalid_request', issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, 400)
}

const clientSchema = z.string().min(1).max(64)

const attachSchema = z.object({
  client: clientSchema.default('other'),
  // 形だけ検証する。roles.json にあるかは Hub が見る (unknown_role, protocol.md §3)
  role: nameSchema.nullable().optional(),
  sessionId: z.string().min(1).max(256).optional(),
  cwd: z.string().max(4096).optional(),
  // 流し込み量の上限。省略したら Hub の既定、0 なら制限なし
  maxAgeMs: z.number().int().nonnegative().optional(),
  maxUnread: z.number().int().nonnegative().optional(),
  // attach し直しのとき、失った前の Attachment ID。後継がいれば 409 successor_attached (protocol.md §3)
  previous: z.string().min(1).max(64).optional(),
})

// initialize の後に分かったクライアント名だけを更新する (protocol.md §3)
const attachmentPatchSchema = z.object({ client: clientSchema }).strict()

// received: 受け手が受け取ったと言える範囲 (inbox で返した最初と最後の seq)。省略は「渡した」だけ (protocol.md §4)
const seqSchema = z.number().int().nonnegative()
const ackSchema = z.object({
  upTo: seqSchema,
  received: z.object({ first: seqSchema, last: seqSchema }).refine((r) => r.first <= r.last, 'first は last 以下').optional(),
})

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return undefined
  }
}

// 本文の上限。超えたら 413 を共通のエラー形式 (protocol.md §1) で返す。message は UI にそのまま出すので英語
function limited(maxSize: number, error: string, message: string): MiddlewareHandler {
  return bodyLimit({ maxSize, onError: (c) => c.json({ error, message }, 413) })
}

// meta.files を Hub の記録から書き直す。空になった meta は保存しない
async function withMeta(input: PostMessageInput, files: FileStore | undefined): Promise<PostMessageInput> {
  if (input.meta === undefined) return input
  const meta = await resolveMeta(input.meta, files)
  const { meta: _raw, ...rest } = input
  return Object.keys(meta).length > 0 ? { ...rest, meta } : rest
}

export function createApp(opts: AppOptions) {
  const { hub } = opts
  const auth = new Auth(opts.token)
  const heartbeatMs = opts.heartbeatMs ?? 30_000
  const app = new Hono<AuthEnv>()

  app.onError((err, c) => {
    if (err instanceof HubError) return c.json({ error: err.code, message: err.message }, err.status)
    if (err instanceof SettingsError) return c.json({ error: err.code, message: err.message }, err.status)
    if (err instanceof FileError) return c.json({ error: err.code, message: err.message }, err.status)
    console.error('[hub]', err)
    return c.json({ error: 'internal' }, 500)
  })

  // UI は認証なしで配信し、?token= があれば cookie に移して URL から消す (protocol.md §1)
  app.get('/', async (c) => {
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
    const token = c.req.query('token')
    if (token !== undefined) {
      if (!auth.checkToken(token)) return c.text('invalid token', 401)
      setCookie(c, COOKIE_NAME, auth.cookieValue, { httpOnly: true, sameSite: 'Strict', path: '/' })
      return c.redirect('/', 302)
    }
    const html = await opts.uiHtml()
    if (html === null) return c.text('UI (public/index.html) がまだない', 404)
    // 外部リソースを読まない 1 枚の HTML なので、同一オリジン以外を禁じる
    // img-src: 添付画像のサムネイル (同一オリジンの /files と、貼り付け直後の blob:)
    c.header('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
    c.header('X-Content-Type-Options', 'nosniff')
    return c.html(html)
  })

  app.use('*', async (c, next) => {
    if (c.req.method === 'GET' && c.req.path === '/') return next()
    return auth.middleware()(c, next)
  })

  // 送り手はリクエストから受け取らず、認証の種類と X-Hub-Attachment で決める (protocol.md §2 Message)
  const senderOf = (c: Context<AuthEnv>): Sender => {
    if (c.get('auth') === 'cookie') return BROWSER
    const attachmentId = c.req.header('x-hub-attachment')
    return attachmentId ? hub.senderOf(attachmentId) : CLI
  }

  app.post('/messages', limited(1024 * 1024, 'payload_too_large', 'message must be 1 MB or smaller'), async (c) => {
    const parsed = postMessageSchema.safeParse(await readJson(c))
    if (!parsed.success) return invalid(c, parsed.error)
    const m = hub.postMessage(await withMeta(parsed.data, opts.files), senderOf(c))
    // recipients / unattached は応答にだけ付ける (Message には含めない)。0 件なら誰にも届いていない。
    // unattached は配信先のうち今接続していない Mailbox で、attach するまで読まれない (C49)
    return c.json({ ...m, ...hub.deliveryOf(m) }, 201)
  })

  // 無編集転送。本文・kind・meta は元のメッセージのまま運ぶ。応答は POST /messages と同じ形
  app.post('/messages/:id/forward', async (c) => {
    const parsed = forwardSchema.safeParse(await readJson(c))
    if (!parsed.success) return invalid(c, parsed.error)
    const m = hub.forwardMessage(c.req.param('id'), parsed.data.to, senderOf(c))
    return c.json({ ...m, ...hub.deliveryOf(m) }, 201)
  })

  // 人の操作で消す (design.md §3.14)。1 件と、保存期間を待たない掃除
  app.delete('/messages/:id', (c) => {
    hub.deleteMessage(c.req.param('id'))
    return c.json({})
  })

  app.post('/messages/purge', (c) => c.json(hub.purgeNow()))

  // 保存された Message をそのまま返す (meta は解釈しない)。shim が reply の元の項目を読むのに使う (C77)
  app.get('/messages/:id', (c) => {
    const m = hub.store.getMessage(c.req.param('id'))
    if (!m) throw new HubError(404, 'message_not_found', `message ${c.req.param('id')} がない`)
    return c.json(m)
  })

  app.get('/messages', (c) => {
    const after = intParam(c.req.query('after'), 0, 0, Number.MAX_SAFE_INTEGER)
    const limit = intParam(c.req.query('limit'), 100, 1, 1000)
    if (after === null || limit === null) return invalid(c, 'after は 0 以上、limit は 1〜1000 の整数')
    return c.json({ messages: hub.store.listMessages(after, limit), lastSeq: hub.store.lastSeq })
  })

  // HTTP hook の入力 JSON をそのまま受ける。取り込まない hook も 200 で返す (非 2xx は hook 側でエラー表示になるだけで意味がない)。
  // パスの :source で変換を選ぶ。source のない /events は claude-code として扱う (protocol.md §3)
  const eventLimit = limited(1024 * 1024, 'payload_too_large', 'event must be 1 MB or smaller')
  const postEvent = async (c: Context, source?: string) => {
    const body = await readJson(c)
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return invalid(c, 'the body must be a JSON object (the hook input)')
    return c.json(hub.addEvent(body as Record<string, unknown>, c.req.header('x-hub-mailbox'), source))
  }
  app.post('/events', eventLimit, (c) => postEvent(c))
  app.post('/events/:source', eventLimit, (c) => postEvent(c, c.req.param('source')))

  app.get('/events', (c) => {
    const limit = intParam(c.req.query('limit'), 100, 1, 1000)
    if (limit === null) return invalid(c, 'limit は 1〜1000 の整数')
    return c.json({ events: hub.store.listEvents(limit) })
  })

  app.get('/mailboxes', (c) => c.json({ mailboxes: hub.describeMailboxes() }))
  // UI が、Mailbox のまだないプロジェクトでも role 宛てを選べるようにする (design.md §3.15 の「プロジェクトは値」)
  app.get('/roles', (c) => c.json({ roles: hub.listRoles() }))
  // hub.config.json の検証済みの値と警告 (読み取りだけ。書く API はない。protocol.md §3)
  app.get('/config', (c) => {
    const r = opts.config ?? defaultConfig()
    return c.json({ config: r.config, warnings: r.warnings })
  })

  // 接続中の Mailbox は 409 (mailbox_attached) で残す。未知の名前は 404
  app.delete('/mailboxes/:name', (c) => {
    const name = c.req.param('name')
    if (!isValidName(name)) return invalid(c, 'Mailbox 名が不正')
    hub.deleteMailbox(name)
    return c.json({})
  })

  app.post('/mailboxes/:name/attach', async (c) => {
    const name = c.req.param('name')
    if (!isValidName(name)) return invalid(c, 'Mailbox 名が不正')
    const parsed = attachSchema.safeParse((await readJson(c)) ?? {})
    if (!parsed.success) return invalid(c, parsed.error)
    return c.json(hub.attach(name, parsed.data))
  })

  for (const method of ['put', 'delete'] as const) {
    app[method]('/mailboxes/:name/subscriptions/:topic', (c) => {
      const { name, topic } = c.req.param()
      if (!isValidName(name) || !isValidName(topic)) return invalid(c, 'Mailbox 名またはトピック名が不正')
      const mb = method === 'put' ? hub.subscribe(name, topic) : hub.unsubscribe(name, topic)
      return c.json({ subscriptions: mb.subscriptions, effectiveSubscriptions: hub.store.effectiveSubscriptions(name) })
    })
  }

  // polling 経路。読むだけで cursor は進めない (ack は POST /attachments/:id/ack)。応答は events/poll の形 (protocol.md §5)
  app.get('/mailboxes/:name/inbox', (c) => {
    const name = c.req.param('name')
    if (!isValidName(name)) return invalid(c, 'Mailbox 名が不正')
    const after = intParam(c.req.query('after'), 0, 0, Number.MAX_SAFE_INTEGER)
    const limit = intParam(c.req.query('limit'), 20, 1, 100)
    if (after === null || limit === null) return invalid(c, 'after は 0 以上、limit は 1〜100 の整数')
    const unconfirmed = c.req.query('unconfirmed')
    if (unconfirmed !== undefined && unconfirmed !== 'true' && unconfirmed !== 'false') return invalid(c, 'unconfirmed は true か false')
    return c.json(hub.inbox(name, after, limit, unconfirmed === 'true'))
  })

  // shim 向け SSE。未読を seq 順に送ってから新着を流す (protocol.md §3)
  app.get('/attachments/:id/stream', (c) => {
    const id = c.req.param('id')
    const after = intParam(c.req.query('after'), 0, 0, Number.MAX_SAFE_INTEGER)
    if (after === null) return invalid(c, 'after は 0 以上の整数')
    hub.cursorOf(id) // 存在しなければここで 404
    return streamSSE(c, (stream) =>
      pump(stream, {
        subscribe: (send, close) =>
          hub.openStream(id, after, {
            message: (m) => send({ event: 'message', id: String(m.seq), data: JSON.stringify(m) }),
            close: (reason) => {
              if (reason) send({ event: 'terminated', data: JSON.stringify({ reason }) })
              close()
            },
          }),
        heartbeatMs,
        heartbeat: () => {
          try {
            return { event: 'heartbeat', data: JSON.stringify({ cursor: hub.cursorOf(id) }) }
          } catch {
            return ': ping\n\n'
          }
        },
      }),
    )
  })

  app.post('/attachments/:id/ack', async (c) => {
    const parsed = ackSchema.safeParse(await readJson(c))
    if (!parsed.success) return invalid(c, parsed.error)
    return c.json(hub.ack(c.req.param('id'), parsed.data.upTo, parsed.data.received))
  })

  app.patch('/attachments/:id', async (c) => {
    const parsed = attachmentPatchSchema.safeParse(await readJson(c))
    if (!parsed.success) return invalid(c, parsed.error)
    return c.json(hub.updateAttachment(c.req.param('id'), parsed.data))
  })

  // リース延長。stream を開いていないクライアント向け (開いている間はリースが切れない)
  app.post('/attachments/:id/heartbeat', (c) => c.json(hub.heartbeat(c.req.param('id'))))

  app.delete('/attachments/:id', (c) => {
    hub.detach(c.req.param('id'))
    return c.json({})
  })

  // UI 向け SSE (protocol.md §7)
  app.get('/stream', (c) =>
    streamSSE(c, (stream) =>
      pump(stream, {
        subscribe: (send) => hub.onUi((e) => send({ event: e.event, data: JSON.stringify(e.data) })),
        heartbeatMs,
        heartbeat: () => ': ping\n\n',
      }),
    ),
  )

  if (opts.settings) {
    const settings = opts.settings
    app.get('/settings', async (c) => c.json(await settings.read()))
    app.put('/settings', limited(64 * 1024, 'payload_too_large', 'settings must be 64 KB or smaller'), async (c) => c.json(await settings.write(await readJson(c))))
  }

  // roadmap の項目の索引 (design.md §3.15)。送るのはホストのスクリプト、読むのは UI
  if (opts.indexes) {
    const indexes = opts.indexes
    app.get('/indexes', (c) => c.json({ indexes: indexes.list() }))
    app.put('/indexes', limited(MAX_INDEX_BYTES, 'payload_too_large', 'index must be 1 MB or smaller'), async (c) => {
      const parsed = indexInputSchema.safeParse(await readJson(c))
      if (!parsed.success) return invalid(c, parsed.error)
      const ix = indexes.put(parsed.data)
      hub.emitUi('index.updated', { project: ix.project, source: ix.source, updatedAt: ix.updatedAt })
      return c.json({ project: ix.project, source: ix.source, updatedAt: ix.updatedAt, items: ix.items.length })
    })
    // 登録を外す。project の比較は PUT と同じ揃え方。正本はリポジトリにあるので、送り直せば戻る
    app.delete('/indexes', (c) => {
      const project = c.req.query('project')
      const source = c.req.query('source')
      if (!project || !source) return invalid(c, 'project と source が要る')
      const ix = indexes.remove(project, source)
      if (!ix) return c.json({ error: 'not_found' }, 404)
      hub.emitUi('index.deleted', { project: ix.project, source: ix.source })
      return c.json({ project: ix.project, source: ix.source })
    })
  }

  if (opts.files) {
    const files = opts.files
    app.post('/files', limited(MAX_UPLOAD_BYTES, 'file_too_large', 'image must be 20 MB or smaller'), async (c) => {
      const bytes = Buffer.from(await c.req.arrayBuffer())
      const { record, created } = await files.save(bytes, { persistent: c.req.query('persistent') === '1' })
      return c.json(record, created ? 201 : 200)
    })
    app.get('/files/:id', async (c) => {
      const record = await files.get(c.req.param('id'))
      if (!record) return c.json({ error: 'not_found' }, 404)
      let bytes: Buffer
      try {
        bytes = await readFile(files.imagePath(record))
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return c.json({ error: 'not_found' }, 404)
        throw e
      }
      return c.body(new Uint8Array(bytes), 200, {
        'content-type': record.mime,
        'x-content-type-options': 'nosniff',
        'content-security-policy': "sandbox; default-src 'none'",
        'cache-control': 'private, max-age=3600',
      })
    })
    app.get('/files/:id/meta', async (c) => {
      const record = await files.get(c.req.param('id'))
      return record ? c.json(record) : c.json({ error: 'not_found' }, 404)
    })
    app.patch('/files/:id', async (c) => {
      const body = await readJson(c)
      const ok =
        typeof body === 'object' && body !== null && !Array.isArray(body) &&
        Object.keys(body).every((k) => k === 'persistent') &&
        typeof (body as { persistent?: unknown }).persistent === 'boolean'
      if (!ok) return invalid(c, 'the body must be {"persistent": true} or {"persistent": false}')
      const record = await files.setPersistent(c.req.param('id'), (body as { persistent: boolean }).persistent)
      return record ? c.json(record) : c.json({ error: 'not_found' }, 404)
    })
  }

  return app
}
