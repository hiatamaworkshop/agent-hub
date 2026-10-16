// HTTP ルート (protocol.md §3)。入力の検証と応答への変換だけを行い、振る舞いは Hub に任せる
import { Hono, type Context } from 'hono'
import { setCookie } from 'hono/cookie'
import { bodyLimit } from 'hono/body-limit'
import { streamSSE } from 'hono/streaming'
import type { z } from 'zod'
import { postMessageSchema, type Sender } from '../shared/types.js'
import { Auth, COOKIE_NAME, type AuthEnv } from './auth.js'
import { Hub, HubError } from './hub.js'
import { pump } from './sse.js'

export interface AppOptions {
  hub: Hub
  token: string
  // UI の HTML。null なら未配置
  uiHtml: () => Promise<string | null>
  heartbeatMs?: number
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

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return undefined
  }
}

export function createApp(opts: AppOptions) {
  const { hub } = opts
  const auth = new Auth(opts.token)
  const heartbeatMs = opts.heartbeatMs ?? 30_000
  const app = new Hono<AuthEnv>()

  app.onError((err, c) => {
    if (err instanceof HubError) return c.json({ error: err.code, message: err.message }, err.status)
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
    return html === null ? c.text('UI (public/index.html) がまだない', 404) : c.html(html)
  })

  app.use('*', async (c, next) => {
    if (c.req.method === 'GET' && c.req.path === '/') return next()
    return auth.middleware()(c, next)
  })

  app.post('/messages', bodyLimit({ maxSize: 1024 * 1024 }), async (c) => {
    const parsed = postMessageSchema.safeParse(await readJson(c))
    if (!parsed.success) return invalid(c, parsed.error)
    const attachmentId = c.req.header('x-hub-attachment')
    let from: Sender
    if (c.get('auth') === 'cookie') from = BROWSER
    else from = attachmentId ? hub.senderOf(attachmentId) : CLI
    return c.json(hub.postMessage(parsed.data, from), 201)
  })

  app.get('/messages', (c) => {
    const after = intParam(c.req.query('after'), 0, 0, Number.MAX_SAFE_INTEGER)
    const limit = intParam(c.req.query('limit'), 100, 1, 1000)
    if (after === null || limit === null) return invalid(c, 'after は 0 以上、limit は 1〜1000 の整数')
    return c.json({ messages: hub.store.listMessages(after, limit), lastSeq: hub.store.lastSeq })
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

  return app
}
