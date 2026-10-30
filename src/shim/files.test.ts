import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it, test } from 'node:test'
import { serve, type ServerType } from '@hono/node-server'
import sharp from 'sharp'
import { createApp } from '../hub/app.js'
import { FileStore, MAX_UPLOAD_BYTES } from '../hub/files.js'
import { Hub } from '../hub/hub.js'
import { Store } from '../hub/store.js'
import type { Message } from '../shared/types.js'
import { MAX_FETCH_BYTES, resolveFiles, sweepFiles, type FileContext } from './files.js'

const TOKEN = 'test-token-0123456789'
const dirs: string[] = []
const servers: { close: (cb?: () => void) => void }[] = []

async function tempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'shim-files-'))
  dirs.push(d)
  return d
}

// 実際の Hub (app) を立てる。ファイルは FileStore で保存する
async function startHub() {
  const dir = await tempDir()
  const files = new FileStore({ dir: join(dir, 'files') })
  const hub = new Hub(new Store())
  const app = createApp({ hub, token: TOKEN, uiHtml: async () => null, files })
  const server: ServerType = await new Promise((resolve) => {
    const s = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () => resolve(s))
  })
  servers.push(server)
  const port = (server.address() as { port: number }).port
  return { url: `http://127.0.0.1:${port}`, files, hub }
}

const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 40, g: 110, b: 60 } } }).png().toBuffer()

function message(meta: Record<string, unknown> | undefined): Message {
  return {
    id: 'm_01',
    seq: 1,
    ts: '2026-01-01T00:00:00.000Z',
    kind: 'request',
    from: { type: 'user', id: 'browser', role: null },
    to: { type: 'mailbox', id: 'deployer' },
    body: 'look',
    ...(meta === undefined ? {} : { meta }),
  }
}

function ctxFor(url: string, baseDir: string, extra: Partial<FileContext> = {}): FileContext {
  return { hubUrl: url, token: TOKEN, baseDir, mailbox: 'deployer', ...extra }
}

after(async () => {
  for (const s of servers) await new Promise<void>((r) => s.close(() => r()))
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})

describe('resolveFiles: 取得と meta への反映', () => {
  it('Hub の画像をローカルに取り、path を足す。中身は Hub と一致し、パスは / 区切りで id と ext だけから作る', async () => {
    const { url, files } = await startHub()
    const { record } = await files.save(await png(640, 480))
    const base = await tempDir()
    const m = message({ note: 'kept', files: [{ id: record.id, mime: record.mime, size: record.size, width: record.width, height: record.height }] })
    const out = await resolveFiles(m, ctxFor(url, base))
    const f = (out.meta!.files as { path: string; id: string; width: number }[])[0]!
    assert.equal(f.id, record.id)
    assert.equal(f.width, record.width)
    assert.equal(f.path, `${base.replace(/\\/g, '/')}/deployer/${record.id}.png`)
    assert.ok(!f.path.includes('\\'))
    assert.deepEqual(await readFile(f.path), await readFile(files.imagePath(record)))
    assert.equal(out.meta!.note, 'kept', '他のキーはそのまま通す')
    // 元のメッセージ (Hub の値) は書き換えない
    assert.equal((m.meta!.files as { path?: string }[])[0]!.path, undefined)
  })

  it('404 は error: "expired"、接続できない場合は error: "fetch_failed"。メッセージは落とさない', async () => {
    const { url } = await startHub()
    const base = await tempDir()
    const gone = `f_${'9'.repeat(32)}`
    const out = await resolveFiles(message({ files: [{ id: gone }] }), ctxFor(url, base))
    assert.deepEqual(out.meta!.files, [{ id: gone, error: 'expired' }])
    const refused = await resolveFiles(message({ files: [{ id: gone }] }), ctxFor('http://127.0.0.1:1', base))
    assert.deepEqual(refused.meta!.files, [{ id: gone, error: 'fetch_failed' }])
    assert.equal(refused.body, 'look')
  })

  it('同じ id は 2 回目から取得しない (Hub にないものでもローカルにあれば path を返す)', async () => {
    const { url, files } = await startHub()
    const { record } = await files.save(await png(50, 40))
    const base = await tempDir()
    const first = await resolveFiles(message({ files: [{ id: record.id }] }), ctxFor(url, base))
    assert.ok((first.meta!.files as { path?: string }[])[0]!.path)
    await rm(files.imagePath(record))
    await rm(join(files.dir, `${record.id}.json`))
    const second = await resolveFiles(message({ files: [{ id: record.id }] }), ctxFor(url, base))
    assert.deepEqual(second.meta!.files, (first.meta!.files as object[]))
  })

  it('タイムアウトは fetch_failed', async () => {
    const hang = createServer(() => {
      // 応答しない
    })
    await new Promise<void>((r) => hang.listen(0, '127.0.0.1', () => r()))
    servers.push(hang)
    const port = (hang.address() as { port: number }).port
    const base = await tempDir()
    const out = await resolveFiles(message({ files: [{ id: `f_${'8'.repeat(32)}` }] }), ctxFor(`http://127.0.0.1:${port}`, base, { timeoutMs: 200 }))
    assert.deepEqual(out.meta!.files, [{ id: `f_${'8'.repeat(32)}`, error: 'fetch_failed' }])
  })

  it('サイズの上限を超えた画像と、画像でない Content-Type は fetch_failed', async () => {
    const { url, files } = await startHub()
    const { record } = await files.save(await png(200, 200))
    const base = await tempDir()
    const big = await resolveFiles(message({ files: [{ id: record.id }] }), ctxFor(url, base, { maxBytes: 10 }))
    assert.equal((big.meta!.files as { error?: string }[])[0]!.error, 'fetch_failed')
    const odd = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html>nope</html>')
    })
    await new Promise<void>((r) => odd.listen(0, '127.0.0.1', () => r()))
    servers.push(odd)
    const port = (odd.address() as { port: number }).port
    const bad = await resolveFiles(message({ files: [{ id: record.id }] }), ctxFor(`http://127.0.0.1:${port}`, await tempDir()))
    assert.equal((bad.meta!.files as { error?: string }[])[0]!.error, 'fetch_failed')
  })

  it('meta がない・想定外の形は、そのまま通す (例外にしない)', async () => {
    const base = await tempDir()
    const ctx = ctxFor('http://127.0.0.1:1', base)
    const plain = message(undefined)
    assert.equal(await resolveFiles(plain, ctx), plain)
    for (const meta of [{ files: 'nope' }, { files: [null, 3, 'x', { id: 'bad id' }, { nothing: true }] }, { files: {} }]) {
      const out = await resolveFiles(message(meta), ctx)
      assert.deepEqual(out.meta, meta)
    }
  })
})

describe('sweepFiles: 起動時の掃除', () => {
  it('24 時間より古い画像だけを消す。ほかのファイルと新しい画像は残す', async () => {
    const base = await tempDir()
    const dir = join(base, 'deployer')
    await mkdir(dir, { recursive: true })
    const old = join(dir, `f_${'a'.repeat(32)}.png`)
    const fresh = join(dir, `f_${'b'.repeat(32)}.jpg`)
    const other = join(dir, 'notes.txt')
    for (const p of [old, fresh, other]) await writeFile(p, 'x')
    const past = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await utimes(old, past, past)
    await utimes(other, past, past)
    assert.equal(await sweepFiles(base), 1)
    await assert.rejects(stat(old))
    assert.ok(await stat(fresh))
    assert.ok(await stat(other), '画像の名前でないものは消さない')
  })

  it('保存先がなくても失敗せず 0 を返す', async () => {
    assert.equal(await sweepFiles(join(tmpdir(), `does-not-exist-${Date.now()}`)), 0)
  })
})

test('the shim can fetch any image the Hub accepts: MAX_FETCH_BYTES is not below MAX_UPLOAD_BYTES (C75)', () => {
  assert.ok(MAX_FETCH_BYTES >= MAX_UPLOAD_BYTES, `shim ${MAX_FETCH_BYTES} < hub ${MAX_UPLOAD_BYTES}`)
})
