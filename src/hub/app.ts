// HTTP ルート (protocol.md §3)。入力の検証と応答への変換だけを行い、振る舞いは Hub に任せる
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { setCookie } from 'hono/cookie'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { isValidName, nameSchema, postMessageSchema, type PostMessageInput, type Sender } from '../shared/types.js'
import { Auth, COOKIE_NAME, type AuthEnv } from './auth.js'
import { Hub, HubError } from './hub.js'
import { pump } from './sse.js'
import { SettingsError, SettingsStore } from './settings.js'
import { FileError, FileStore, MAX_UPLOAD_BYTES, resolveMeta } from './files.js'
import { readFile } from 'node:fs/promises'

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

const attachSchema = z.object({
  client: z.string().min(1).max(64).default('other'),
  // P0 では roles.json を読まないので role 名は検証しない (P2)
  role: nameSchema.nullable().optional(),
  sessionId: z.string().min(1).max(256).optional(),
  cwd: z.string().max(4096).optional(),
  // P2 で実装する。P0 では受け取るだけ
  maxAgeMs: z.number().int().positive().optional(),
})

const ackSchema = z.object({ upTo: z.number().int().nonnegative() })

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return undefined
  }
}

// 本文の上限。bodyLimit の 413 は HTTPException で投げられるので、この経路だけ応答にする (既存の onError は変えない)
function limited(maxSize: number): MiddlewareHandler {
  const limit = bodyLimit({ maxSize })
  return async (c, next) => {
    try {
      return await limit(c, next)
    } catch (e) {
      if (e instanceof HTTPException) return e.getResponse()
      throw e
    }
  }
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

  app.post('/messages', limited(1024 * 1024), async (c) => {
    const parsed = postMessageSchema.safeParse(await readJson(c))
    if (!parsed.success) return invalid(c, parsed.error)
    const attachmentId = c.req.header('x-hub-attachment')
    let from: Sender
    if (c.get('auth') === 'cookie') from = BROWSER
    else from = attachmentId ? hub.senderOf(attachmentId) : CLI
    const m = hub.postMessage(await withMeta(parsed.data, opts.files), from)
    // recipients は応答にだけ付ける (Message には含めない)。0 件なら誰にも届いていない
    return c.json({ ...m, recipients: hub.recipientsOf(m) }, 201)
  })

  app.get('/messages', (c) => {
    const after = intParam(c.req.query('after'), 0, 0, Number.MAX_SAFE_INTEGER)
    const limit = intParam(c.req.query('limit'), 100, 1, 1000)
    if (after === null || limit === null) return invalid(c, 'after は 0 以上、limit は 1〜1000 の整数')
    return c.json({ messages: hub.store.listMessages(after, limit), lastSeq: hub.store.lastSeq })
  })

  app.get('/mailboxes', (c) => c.json({ mailboxes: hub.describeMailboxes() }))

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
    return c.json({ cursor: hub.ack(c.req.param('id'), parsed.data.upTo) })
  })

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
    app.put('/settings', limited(64 * 1024), async (c) => c.json(await settings.write(await readJson(c))))
  }

  if (opts.files) {
    const files = opts.files
    app.post('/files', limited(MAX_UPLOAD_BYTES), async (c) => {
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
