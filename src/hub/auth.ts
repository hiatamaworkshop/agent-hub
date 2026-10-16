// 認証 (protocol.md §1, design.md §4)。shim / hooks は Bearer、ブラウザは cookie
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'

export const COOKIE_NAME = 'hub_session'

export type AuthKind = 'bearer' | 'cookie'
export type AuthEnv = { Variables: { auth: AuthKind } }

function same(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export class Auth {
  // cookie にはトークンそのものではなく派生値を入れる
  readonly cookieValue: string

  constructor(private readonly token: string) {
    this.cookieValue = createHmac('sha256', token).update('agent-hub browser session').digest('base64url')
  }

  checkToken(t: string | undefined): boolean {
    return t !== undefined && same(t, this.token)
  }

  // Authorization があればそれだけで判定する (誤ったトークンを cookie で救わない)
  middleware(): MiddlewareHandler<AuthEnv> {
    return async (c, next) => {
      const header = c.req.header('authorization')
      if (header !== undefined) {
        const m = /^Bearer\s+(.+)$/i.exec(header)
        if (!m || !this.checkToken(m[1])) return c.json({ error: 'unauthorized' }, 401)
        c.set('auth', 'bearer')
        return next()
      }
      const cookie = getCookie(c, COOKIE_NAME)
      if (cookie === undefined || !same(cookie, this.cookieValue)) return c.json({ error: 'unauthorized' }, 401)
      // cookie 認証の状態変更は同一オリジンからだけ受け付ける (CSRF 対策)
      if (!SAFE_METHODS.has(c.req.method) && c.req.header('origin') !== new URL(c.req.url).origin) {
        return c.json({ error: 'forbidden_origin' }, 403)
      }
      c.set('auth', 'cookie')
      return next()
    }
  }
}
