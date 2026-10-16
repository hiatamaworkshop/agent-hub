import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import sharp from 'sharp'
import { createApp } from './app.js'
import { COOKIE_NAME } from './auth.js'
import { FileStore, MAX_UPLOAD_BYTES } from './files.js'
import { Hub } from './hub.js'
import { Store } from './store.js'

const TOKEN = 'test-token-0123456789'
const ORIGIN = 'http://localhost' // app.request() の既定オリジン
const bearer = { authorization: `Bearer ${TOKEN}` }

const dirs: string[] = []
after(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})

async function setup(withFiles = true) {
  const dir = await mkdtemp(join(tmpdir(), 'hub-files-api-'))
  dirs.push(dir)
  const app = createApp({
    hub: new Hub(new Store()),
    token: TOKEN,
    uiHtml: async () => '<html>ui</html>',
    files: withFiles ? new FileStore({ dir: join(dir, 'files') }) : undefined,
  })
  return { app }
}
type App = Awaited<ReturnType<typeof setup>>['app']

const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer()

function upload(app: App, bytes: Buffer, headers: Record<string, string> = {}, query = '') {
  return app.request(`/files${query}`, { method: 'POST', headers: { 'content-type': 'image/png', ...headers }, body: bytes })
}

async function browserCookie(app: App): Promise<string> {
  const res = await app.request(`/?token=${TOKEN}`)
  return (res.headers.get('set-cookie') ?? '').split(';')[0]!
}

describe('/files: HTTP', () => {
  it('files を渡さなければ /files は存在しない', async () => {
    const { app } = await setup(false)
    assert.equal((await app.request('/files/f_' + '0'.repeat(32), { headers: bearer })).status, 404)
    assert.equal((await upload(app, Buffer.from('x'), bearer)).status, 404)
  })

  it('トークンなしは 401', async () => {
    const { app } = await setup()
    assert.equal((await upload(app, await png(10, 10))).status, 401)
  })

  it('cookie で別オリジンからの POST / PATCH は 403', async () => {
    const { app } = await setup()
    const cookie = await browserCookie(app)
    const bytes = await png(10, 10)
    assert.equal((await upload(app, bytes, { cookie, origin: 'http://evil.example' })).status, 403)
    const created = await upload(app, bytes, { cookie, origin: ORIGIN })
    assert.equal(created.status, 201)
    const { id } = (await created.json()) as { id: string }
    const patch = await app.request(`/files/${id}`, { method: 'PATCH', headers: { cookie, origin: 'http://evil.example', 'content-type': 'application/json' }, body: '{"persistent":true}' })
    assert.equal(patch.status, 403)
  })

  it('POST は 201 (新規)、同じ画像は 200、persistent=1 で永続になる', async () => {
    const { app } = await setup()
    const bytes = await png(300, 200)
    const first = await upload(app, bytes, bearer)
    assert.equal(first.status, 201)
    const rec = (await first.json()) as { id: string; width: number; height: number; persistent: boolean; mime: string }
    assert.equal(rec.width, 300)
    assert.equal(rec.persistent, false)
    const again = await upload(app, bytes, bearer, '?persistent=1')
    assert.equal(again.status, 200)
    assert.equal(((await again.json()) as { persistent: boolean; id: string }).persistent, true)
  })

  it('デコードできない本文は 400 invalid_image', async () => {
    const { app } = await setup()
    const res = await upload(app, Buffer.from('nope'), bearer)
    assert.equal(res.status, 400)
    const json = (await res.json()) as { error: string; message: string }
    assert.equal(json.error, 'invalid_image')
    assert.match(json.message, /not a valid/)
  })

  it('20MB を超える本文は 413', async () => {
    const { app } = await setup()
    const res = await upload(app, Buffer.alloc(MAX_UPLOAD_BYTES + 1), bearer)
    assert.equal(res.status, 413)
    assert.equal(((await res.json()) as { error: string }).error, 'file_too_large')
  })

  it('GET は画像本体を、安全なヘッダーつきで返す', async () => {
    const { app } = await setup()
    const bytes = await png(120, 80)
    const { id } = (await (await upload(app, bytes, bearer)).json()) as { id: string }
    const res = await app.request(`/files/${id}`, { headers: bearer })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'image/png')
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(res.headers.get('content-security-policy'), "sandbox; default-src 'none'")
    assert.equal(res.headers.get('cache-control'), 'private, max-age=3600')
    const got = Buffer.from(await res.arrayBuffer())
    assert.equal((await sharp(got).metadata()).width, 120)
  })

  it('不正な id と存在しない id は 404', async () => {
    const { app } = await setup()
    assert.equal((await app.request('/files/../etc/passwd', { headers: bearer })).status, 404)
    assert.equal((await app.request('/files/f_' + 'A'.repeat(32), { headers: bearer })).status, 404)
    assert.equal((await app.request('/files/f_' + '1'.repeat(32) + '/meta', { headers: bearer })).status, 404)
    assert.equal((await app.request('/files/nope/meta', { headers: bearer })).status, 404)
  })

  it('GET /files/:id/meta は記録を返す', async () => {
    const { app } = await setup()
    const { id } = (await (await upload(app, await png(30, 20), bearer)).json()) as { id: string }
    const rec = (await (await app.request(`/files/${id}/meta`, { headers: bearer })).json()) as { id: string; original: { width: number } }
    assert.equal(rec.id, id)
    assert.equal(rec.original.width, 30)
  })

  it('PATCH は persistent の切り替え。未知のキーや型違いは 400', async () => {
    const { app } = await setup()
    const { id } = (await (await upload(app, await png(31, 20), bearer)).json()) as { id: string }
    const patch = (body: string) => app.request(`/files/${id}`, { method: 'PATCH', headers: { ...bearer, 'content-type': 'application/json' }, body })
    const on = await patch('{"persistent":true}')
    assert.equal(on.status, 200)
    assert.equal(((await on.json()) as { persistent: boolean }).persistent, true)
    assert.equal(((await (await patch('{"persistent":false}')).json()) as { persistent: boolean }).persistent, false)
    assert.equal((await patch('{"persistent":"yes"}')).status, 400)
    assert.equal((await patch('{"persistent":true,"x":1}')).status, 400)
    assert.equal((await patch('[]')).status, 400)
    assert.equal((await app.request(`/files/f_${'2'.repeat(32)}`, { method: 'PATCH', headers: { ...bearer, 'content-type': 'application/json' }, body: '{"persistent":true}' })).status, 404)
  })
})

describe('messages: meta', () => {
  const post = (app: App, body: unknown) =>
    app.request('/messages', { method: 'POST', headers: { ...bearer, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const base = { kind: 'request', to: { type: 'topic', id: 'user.message' }, body: 'look' }

  it('meta.files は Hub の記録で書き直して保存し、履歴にも出る', async () => {
    const { app } = await setup()
    const { id } = (await (await upload(app, await png(400, 300), bearer)).json()) as { id: string }
    const res = await post(app, { ...base, meta: { files: [{ id, mime: 'image/evil', width: 1, size: 9 }], note: 'kept' } })
    assert.equal(res.status, 201)
    const m = (await res.json()) as { meta: { files: unknown[]; note: string } }
    assert.equal(m.meta.note, 'kept')
    assert.deepEqual(m.meta.files, [{ id, mime: 'image/png', size: (m.meta.files[0] as { size: number }).size, width: 400, height: 300 }])
    const hist = (await (await app.request('/messages?after=0', { headers: bearer })).json()) as { messages: { meta?: unknown }[] }
    assert.deepEqual(hist.messages[0]!.meta, m.meta)
  })

  it('空の meta は保存しない', async () => {
    const { app } = await setup()
    const m = (await (await post(app, { ...base, meta: {} })).json()) as Record<string, unknown>
    assert.equal('meta' in m, false)
  })

  it('検証違反は 400 (キー・サイズ・存在しない id・files を受けない Hub)', async () => {
    const { app } = await setup()
    assert.equal((await post(app, { ...base, meta: { Bad: 1 } })).status, 400)
    assert.equal((await post(app, { ...base, meta: { ['a'.repeat(33)]: 1 } })).status, 400)
    assert.equal((await post(app, { ...base, meta: { big: 'x'.repeat(9000) } })).status, 400)
    const missing = await post(app, { ...base, meta: { files: [{ id: `f_${'3'.repeat(32)}` }] } })
    assert.equal(missing.status, 400)
    assert.match(((await missing.json()) as { message: string }).message, /not found/)
    const { app: noFiles } = await setup(false)
    const res = await post(noFiles, { ...base, meta: { files: [{ id: `f_${'4'.repeat(32)}` }] } })
    assert.equal(res.status, 400)
  })

  it('meta のキーは既知でなくても通る (将来の拡張のため)', async () => {
    const { app } = await setup()
    assert.equal((await post(app, { ...base, meta: { future_key_1: { nested: [1, 2] } } })).status, 201)
  })
})

describe('UI の CSP', () => {
  it('画像の表示 (同一オリジンと blob:) を許可する', async () => {
    const { app } = await setup()
    const csp = (await app.request('/')).headers.get('content-security-policy') ?? ''
    assert.match(csp, /img-src 'self' blob:/)
  })
})
