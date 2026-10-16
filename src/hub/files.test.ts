import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import sharp from 'sharp'
import { FILE_ID_RE, FileError, FileStore, MAX_UPLOAD_BYTES, resolveMeta } from './files.js'

const dirs: string[] = []
after(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})

async function tempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'hub-files-'))
  dirs.push(d)
  return d
}

// テスト用の画像は sharp で生成する (リポジトリにバイナリを置かない)
const solid = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } } })
const png = (w: number, h: number) => solid(w, h).png().toBuffer()
const jpeg = (w: number, h: number) => solid(w, h).jpeg().toBuffer()

async function failure(p: Promise<unknown>): Promise<FileError> {
  try {
    await p
  } catch (e) {
    assert.ok(e instanceof FileError, `expected FileError, got ${String(e)}`)
    return e
  }
  assert.fail('expected a failure')
}

describe('FileStore: 正規化', () => {
  it('長辺が上限を超える画像は縮小する (縦横比を保つ)', async () => {
    const store = new FileStore({ dir: await tempDir() })
    const { record, created } = await store.save(await png(4000, 3000))
    assert.equal(created, true)
    assert.equal(record.width, 1568)
    assert.equal(record.height, 1176)
    assert.equal(record.resized, true)
    assert.equal(record.mime, 'image/png')
    assert.deepEqual(record.original, { mime: 'image/png', size: record.original.size, width: 4000, height: 3000 })
    assert.match(record.id, FILE_ID_RE)
  })

  it('上限より小さい画像は拡大しない。小さくても再エンコードする', async () => {
    const store = new FileStore({ dir: await tempDir() })
    const { record } = await store.save(await jpeg(100, 50))
    assert.equal(record.width, 100)
    assert.equal(record.height, 50)
    assert.equal(record.resized, false)
    assert.equal(record.mime, 'image/jpeg')
  })

  it('保存した画像から EXIF の向きを反映し、メタデータを落とす', async () => {
    const dir = await tempDir()
    const store = new FileStore({ dir })
    // 横長 200x100 に向き 6 (90 度回転) を付ける。表示上は縦長 100x200
    const src = await solid(200, 100).withMetadata({ orientation: 6 }).jpeg().toBuffer()
    assert.equal((await sharp(src).metadata()).orientation, 6)
    const { record } = await store.save(src)
    assert.equal(record.width, 100)
    assert.equal(record.height, 200)
    const saved = await sharp(store.imagePath(record)).metadata()
    assert.equal(saved.orientation, undefined)
    assert.equal(saved.exif, undefined)
  })

  it('GIF / WebP は 1 フレーム目を PNG にして保存する', async () => {
    const store = new FileStore({ dir: await tempDir() })
    const gif = await solid(40, 30).gif().toBuffer()
    const { record } = await store.save(gif)
    assert.equal(record.mime, 'image/png')
    assert.equal(record.original.mime, 'image/gif')
    assert.equal(record.width, 40)
  })

  it('デコードできないデータと SVG は 400 で保存しない', async () => {
    const dir = await tempDir()
    const store = new FileStore({ dir })
    const junk = await failure(store.save(Buffer.from('not an image at all')))
    assert.equal(junk.status, 400)
    assert.equal(junk.code, 'invalid_image')
    const svg = await failure(store.save(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="5" height="5"/></svg>')))
    assert.equal(svg.code, 'unsupported_image')
    // 失敗したときは何も書かない
    assert.deepEqual(await readdir(dir), [])
  })

  it('画素数が上限を超える画像は 400 で断る', async () => {
    const store = new FileStore({ dir: await tempDir(), maxPixels: 1_000_000 })
    const e = await failure(store.save(await png(1200, 1200)))
    assert.equal(e.status, 400)
    assert.equal(e.code, 'image_too_large')
  })

  it('20MB を超える入力は、デコードする前に 413', async () => {
    const store = new FileStore({ dir: await tempDir() })
    const e = await failure(store.save(Buffer.alloc(MAX_UPLOAD_BYTES + 1)))
    assert.equal(e.status, 413)
  })
})

describe('FileStore: id・persistent・掃除', () => {
  it('同じバイト列は同じ id で、2 回目は作らずに既存を返す', async () => {
    const store = new FileStore({ dir: await tempDir() })
    const bytes = await png(300, 200)
    const a = await store.save(bytes)
    const b = await store.save(bytes)
    assert.equal(a.record.id, b.record.id)
    assert.equal(a.created, true)
    assert.equal(b.created, false)
  })

  it('persistent は再アップロードで格上げだけする。PATCH では切り替えられる', async () => {
    const store = new FileStore({ dir: await tempDir() })
    const bytes = await png(50, 50)
    const first = await store.save(bytes)
    assert.equal(first.record.persistent, false)
    const up = await store.save(bytes, { persistent: true })
    assert.equal(up.record.persistent, true)
    const down = await store.save(bytes, { persistent: false })
    assert.equal(down.record.persistent, true, '再アップロードでは下げない')
    assert.equal((await store.setPersistent(first.record.id, false))?.persistent, false)
    assert.equal(await store.setPersistent('f_' + '0'.repeat(32), true), undefined)
  })

  it('掃除は期限を過ぎた非 persistent だけを消す (記録と画像の両方)', async () => {
    const dir = await tempDir()
    let now = new Date('2026-01-01T00:00:00Z')
    const store = new FileStore({ dir, ttlDays: 1, now: () => now })
    const old = await store.save(await png(20, 20))
    const kept = await store.save(await png(21, 21), { persistent: true })
    now = new Date('2026-01-03T00:00:00Z')
    assert.equal(await store.sweep(), 1)
    assert.equal(await store.get(old.record.id), undefined)
    await assert.rejects(stat(store.imagePath(old.record)))
    assert.ok(await store.get(kept.record.id))
  })

  it('保存期間 0 では掃除しない', async () => {
    const dir = await tempDir()
    let now = new Date('2026-01-01T00:00:00Z')
    const store = new FileStore({ dir, ttlDays: 0, now: () => now })
    const { record } = await store.save(await png(22, 22))
    now = new Date('2030-01-01T00:00:00Z')
    assert.equal(await store.sweep(), 0)
    assert.ok(await store.get(record.id))
  })

  it('記録のない古い画像 (書き込み途中で落ちたもの) も消す', async () => {
    const dir = await tempDir()
    const store = new FileStore({ dir, ttlDays: 1 })
    await writeFile(join(dir, `f_${'a'.repeat(32)}.png`), 'orphan')
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    await utimes(join(dir, `f_${'a'.repeat(32)}.png`), past, past)
    const later = new FileStore({ dir, ttlDays: 1, now: () => new Date() })
    assert.equal(await later.sweep(), 1)
  })
})

describe('resolveMeta: meta.files', () => {
  it('記録から書き直し、送り手が付けた値は使わない。重複は 1 つにまとめる', async () => {
    const store = new FileStore({ dir: await tempDir() })
    const { record } = await store.save(await png(64, 48))
    const out = await resolveMeta(
      { note: 'kept', files: [{ id: record.id, mime: 'image/evil', size: 1, width: 9999, height: 9999 }, { id: record.id }] },
      store,
    )
    assert.deepEqual(out, {
      note: 'kept',
      files: [{ id: record.id, mime: 'image/png', size: record.size, width: 64, height: 48 }],
    })
  })

  it('存在しない id は 400 で、message に id が入る', async () => {
    const store = new FileStore({ dir: await tempDir() })
    const missing = `f_${'b'.repeat(32)}`
    const e = await failure(resolveMeta({ files: [{ id: missing }] }, store))
    assert.equal(e.status, 400)
    assert.match(e.message, new RegExp(missing))
  })

  it('形式違反・5 件以上・files を受けない Hub は 400', async () => {
    const store = new FileStore({ dir: await tempDir() })
    assert.equal((await failure(resolveMeta({ files: [{ id: 'nope' }] }, store))).status, 400)
    assert.equal((await failure(resolveMeta({ files: 'x' }, store))).status, 400)
    const ids = Array.from({ length: 5 }, (_, i) => ({ id: `f_${String(i).padStart(32, '0')}` }))
    assert.match((await failure(resolveMeta({ files: ids }, store))).message, /at most 4/)
    assert.match((await failure(resolveMeta({ files: [{ id: `f_${'c'.repeat(32)}` }] }, undefined))).message, /does not accept/)
  })

  it('files がなければ meta はそのまま', async () => {
    assert.deepEqual(await resolveMeta({ a: 1 }, undefined), { a: 1 })
  })
})
