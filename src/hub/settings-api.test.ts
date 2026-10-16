import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { createApp } from './app.js'
import { COOKIE_NAME } from './auth.js'
import { Hub } from './hub.js'
import { SettingsStore } from './settings.js'
import { Store } from './store.js'

const TOKEN = 'test-token-0123456789'
const ORIGIN = 'http://localhost' // app.request() の既定オリジン
const bearer = { authorization: `Bearer ${TOKEN}` }

const dirs: string[] = []
after(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})

async function setup(withSettings = true) {
  const dir = await mkdtemp(join(tmpdir(), 'hub-settings-api-'))
  dirs.push(dir)
  const file = join(dir, 'settings.json')
  const app = createApp({
    hub: new Hub(new Store()),
    token: TOKEN,
    uiHtml: async () => '<html>ui</html>',
    settings: withSettings ? new SettingsStore(file) : undefined,
  })
  return { app, file }
}

async function browserCookie(app: Awaited<ReturnType<typeof setup>>['app']): Promise<string> {
  const res = await app.request(`/?token=${TOKEN}`)
  return (res.headers.get('set-cookie') ?? '').split(';')[0]!
}

function put(app: Awaited<ReturnType<typeof setup>>['app'], body: unknown, headers: Record<string, string>) {
  return app.request('/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('/settings: HTTP', () => {
  it('settings を渡さなければ /settings は存在しない (古い Hub と同じ 404)', async () => {
    const { app } = await setup(false)
    assert.equal((await app.request('/settings', { headers: bearer })).status, 404)
  })

  it('トークンなし・不正は 401', async () => {
    const { app } = await setup()
    assert.equal((await app.request('/settings')).status, 401)
    assert.equal((await app.request('/settings', { headers: { authorization: 'Bearer nope' } })).status, 401)
    assert.equal((await put(app, { commands: [] }, {})).status, 401)
  })

  it('GET はファイルがなければ空の設定を返す', async () => {
    const { app } = await setup()
    const res = await app.request('/settings', { headers: bearer })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { version: 1, commands: [] })
  })

  it('PUT で保存し、保存後の設定を返す。GET で同じものが読める', async () => {
    const { app, file } = await setup()
    const body = { commands: [{ name: 'cp', text: 'commit and push' }] }
    const res = await put(app, body, bearer)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { version: 1, commands: body.commands })
    const got = await app.request('/settings', { headers: bearer })
    assert.deepEqual(await got.json(), { version: 1, commands: body.commands })
    assert.match(await readFile(file, 'utf8'), /commit and push/)
  })

  it('ブラウザ (cookie) の PUT は同一オリジンなら通る', async () => {
    const { app } = await setup()
    const cookie = await browserCookie(app)
    const res = await put(app, { commands: [{ name: 'cp', text: 'x' }] }, { cookie, origin: ORIGIN })
    assert.equal(res.status, 200)
  })

  it('cookie でも別オリジンからの PUT は 403 (既存の CSRF 対策の対象)', async () => {
    const { app, file } = await setup()
    const cookie = await browserCookie(app)
    const res = await put(app, { commands: [{ name: 'cp', text: 'x' }] }, { cookie, origin: 'http://evil.example' })
    assert.equal(res.status, 403)
    await assert.rejects(readFile(file, 'utf8'))
  })

  it('cookie でも Origin がない PUT は 403', async () => {
    const { app } = await setup()
    const cookie = await browserCookie(app)
    assert.equal((await put(app, { commands: [] }, { cookie })).status, 403)
  })

  it('検証違反は 400 で、message に英語の理由が入る', async () => {
    const { app } = await setup()
    const res = await put(app, { commands: [{ name: 'CP', text: 'x' }] }, bearer)
    assert.equal(res.status, 400)
    const json = (await res.json()) as { error: string; message: string }
    assert.equal(json.error, 'invalid_request')
    assert.match(json.message, /lowercase/)
  })

  it('JSON として読めない本文は 400', async () => {
    const { app } = await setup()
    const res = await put(app, '{ not json', bearer)
    assert.equal(res.status, 400)
  })

  it('64KB を超える本文は 413', async () => {
    const { app } = await setup()
    const big = JSON.stringify({ commands: [{ name: 'cp', text: 'x'.repeat(70 * 1024) }] })
    const res = await put(app, big, bearer)
    assert.equal(res.status, 413)
    assert.equal(((await res.json()) as { error: string }).error, 'payload_too_large')
  })

  it('壊れたファイルの GET は 500 settings_invalid。PUT は退避して 200', async () => {
    const { app, file } = await setup()
    await writeFile(file, '{ broken')
    const got = await app.request('/settings', { headers: bearer })
    assert.equal(got.status, 500)
    const json = (await got.json()) as { error: string; message: string }
    assert.equal(json.error, 'settings_invalid')
    assert.ok(!json.message.includes('broken'))

    const res = await put(app, { commands: [{ name: 'cp', text: 'x' }] }, bearer)
    assert.equal(res.status, 200)
    const after2 = await app.request('/settings', { headers: bearer })
    assert.equal(after2.status, 200)
  })
})

describe('/settings: defaultTo の往復', () => {
  it('手編集の defaultTo は GET に出て、PUT (commands) の後も file に残る', async () => {
    const { app, file } = await setup()
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, JSON.stringify({ version: 1, commands: [], defaultTo: 'mailbox:leader' }))
    const got = await app.request('/settings', { headers: bearer })
    assert.deepEqual(await got.json(), { version: 1, commands: [], defaultTo: 'mailbox:leader' })
    const res = await put(app, { commands: [{ name: 'cp', text: 'commit and push' }] }, bearer)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { version: 1, commands: [{ name: 'cp', text: 'commit and push' }], defaultTo: 'mailbox:leader' })
    const onDisk = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(onDisk.defaultTo, 'mailbox:leader')
  })
})
