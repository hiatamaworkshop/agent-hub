// 画像ファイル (<HUB_DATA_DIR>/files/)。受け取った画像は Hub でデコードして検証し、正規化してから保存する。
// メッセージには id だけを載せ、表示も agent が受け取るのも保存した (正規化後の) 画像
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp, { type Metadata, type OutputInfo } from 'sharp'

export const FILE_ID_RE = /^f_[0-9a-f]{32}$/
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
export const MAX_FILES_PER_MESSAGE = 4
const DEFAULT_MAX_EDGE = 1568
const DEFAULT_MAX_PIXELS = 100_000_000
const JPEG_QUALITY = 85

// HTTP にそのまま返せる失敗。code と status は app.ts の onError で使う
export class FileError extends Error {
  constructor(
    readonly status: 400 | 404 | 413 | 500,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export interface FileRecord {
  id: string
  mime: 'image/jpeg' | 'image/png'
  size: number
  width: number
  height: number
  persistent: boolean
  createdAt: string
  // 長辺を縮小したか
  resized: boolean
  // 受け取ったままの情報 (EXIF の向きを反映する前の寸法)
  original: { mime: string; size: number; width: number; height: number }
}

export interface FileStoreOptions {
  dir: string
  maxEdge?: number
  // 揮発ファイルの保存期間 (日)。0 なら掃除しない
  ttlDays?: number
  // デコードする画素数の上限 (展開爆弾対策)
  maxPixels?: number
  now?: () => Date
}

// 一時ファイルに書いてから rename する (途中で壊れない)
async function writeAtomic(path: string, data: Buffer | string): Promise<void> {
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(tmp, data)
    await rename(tmp, path)
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}

export class FileStore {
  readonly dir: string
  private readonly maxEdge: number
  private readonly ttlMs: number
  private readonly maxPixels: number
  private readonly now: () => Date

  constructor(opts: FileStoreOptions) {
    this.dir = opts.dir
    this.maxEdge = opts.maxEdge ?? DEFAULT_MAX_EDGE
    this.ttlMs = (opts.ttlDays ?? 7) * 24 * 60 * 60 * 1000
    this.maxPixels = opts.maxPixels ?? DEFAULT_MAX_PIXELS
    this.now = opts.now ?? (() => new Date())
  }

  // 同じ入力は同じ id (元のバイト列の sha256)。既存ならそのレコードを返し、persistent だけは格上げする
  async save(input: Buffer, opts: { persistent?: boolean } = {}): Promise<{ record: FileRecord; created: boolean }> {
    if (input.length > MAX_UPLOAD_BYTES) throw new FileError(413, 'file_too_large', 'image must be 20 MB or smaller')
    const id = `f_${createHash('sha256').update(input).digest('hex').slice(0, 32)}`
    const existing = await this.get(id)
    if (existing) {
      if (opts.persistent && !existing.persistent) return { record: (await this.setPersistent(id, true))!, created: false }
      return { record: existing, created: false }
    }

    // デコードできなければ保存しない。SVG や未対応の形式もここで落とす
    let meta: Metadata
    let data: Buffer
    let info: OutputInfo
    try {
      meta = await sharp(input, { limitInputPixels: this.maxPixels }).metadata()
    } catch (e) {
      throw this.decodeError(e)
    }
    if (!meta.format || !['jpeg', 'png', 'gif', 'webp'].includes(meta.format)) {
      throw new FileError(400, 'unsupported_image', 'only PNG, JPEG, GIF and WebP images are accepted')
    }
    const jpeg = meta.format === 'jpeg'
    try {
      // rotate() は EXIF の向きを反映して、向きの情報を外す。出力に metadata は付けないので位置情報なども落ちる
      // GIF / WebP のアニメーションは 1 フレーム目だけを使う (sharp の既定)
      const pipeline = sharp(input, { limitInputPixels: this.maxPixels })
        .rotate()
        .resize({ width: this.maxEdge, height: this.maxEdge, fit: 'inside', withoutEnlargement: true })
      const out = jpeg ? pipeline.jpeg({ quality: JPEG_QUALITY }) : pipeline.png()
      ;({ data, info } = await out.toBuffer({ resolveWithObject: true }))
    } catch (e) {
      throw this.decodeError(e)
    }

    // EXIF の向き 5〜8 は縦横が入れ替わる
    const rotated = (meta.orientation ?? 1) >= 5
    const ow = (rotated ? meta.height : meta.width) ?? 0
    const oh = (rotated ? meta.width : meta.height) ?? 0
    const record: FileRecord = {
      id,
      mime: jpeg ? 'image/jpeg' : 'image/png',
      size: data.length,
      width: info.width,
      height: info.height,
      persistent: opts.persistent === true,
      createdAt: this.now().toISOString(),
      resized: info.width < ow || info.height < oh,
      original: { mime: `image/${meta.format}`, size: input.length, width: meta.width ?? 0, height: meta.height ?? 0 },
    }
    await mkdir(this.dir, { recursive: true })
    // 画像本体を先に書き、記録を最後に書く (記録があれば完成とみなす)
    await writeAtomic(join(this.dir, `${id}.${jpeg ? 'jpg' : 'png'}`), data)
    await writeAtomic(join(this.dir, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`)
    return { record, created: true }
  }

  private decodeError(e: unknown): FileError {
    if (/pixel limit/i.test(String((e as Error).message))) {
      return new FileError(400, 'image_too_large', `image has more than ${this.maxPixels} pixels`)
    }
    return new FileError(400, 'invalid_image', 'the data is not a valid PNG, JPEG, GIF or WebP image')
  }

  async get(id: string): Promise<FileRecord | undefined> {
    if (!FILE_ID_RE.test(id)) return undefined
    try {
      return JSON.parse(await readFile(join(this.dir, `${id}.json`), 'utf8')) as FileRecord
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw e
    }
  }

  imagePath(record: FileRecord): string {
    return join(this.dir, `${record.id}.${record.mime === 'image/jpeg' ? 'jpg' : 'png'}`)
  }

  async setPersistent(id: string, persistent: boolean): Promise<FileRecord | undefined> {
    const record = await this.get(id)
    if (!record) return undefined
    const next = { ...record, persistent }
    await writeAtomic(join(this.dir, `${id}.json`), `${JSON.stringify(next, null, 2)}\n`)
    return next
  }

  // 持続でないファイルのうち、保存期間を過ぎたものを消す。消した件数を返す
  async sweep(): Promise<number> {
    if (this.ttlMs <= 0) return 0
    const cutoff = this.now().getTime() - this.ttlMs
    let removed = 0
    const names = await readdir(this.dir).catch(() => [] as string[])
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const record = await this.get(name.slice(0, -'.json'.length))
      if (!record || record.persistent || Date.parse(record.createdAt) > cutoff) continue
      // 記録を先に消す (記録がなければ完成していないものとして扱われる)
      await rm(join(this.dir, name), { force: true })
      await rm(this.imagePath(record), { force: true })
      removed++
    }
    // 記録のない画像 (書き込みの途中で落ちたもの) も期限で消す
    for (const name of names) {
      if (name.endsWith('.json') || name.endsWith('.tmp') || !FILE_ID_RE.test(name.slice(0, 34))) continue
      const path = join(this.dir, name)
      if (await this.get(name.slice(0, 34))) continue
      const st = await stat(path).catch(() => undefined)
      if (st && st.mtimeMs <= cutoff) {
        await rm(path, { force: true })
        removed++
      }
    }
    return removed
  }
}

// メッセージの meta.files を検証し、Hub の記録から書き直す。送り手の mime や size などは使わない
export async function resolveMeta(meta: Record<string, unknown>, store: FileStore | undefined): Promise<Record<string, unknown>> {
  if (meta.files === undefined) return { ...meta }
  if (!store) throw new FileError(400, 'invalid_request', 'this Hub does not accept file attachments')
  if (!Array.isArray(meta.files)) throw new FileError(400, 'invalid_request', 'meta.files must be an array')
  const ids: string[] = []
  meta.files.forEach((f: unknown, i: number) => {
    const id = typeof f === 'object' && f !== null ? (f as { id?: unknown }).id : undefined
    if (typeof id !== 'string' || !FILE_ID_RE.test(id)) {
      throw new FileError(400, 'invalid_request', `meta.files[${i}].id must be f_ followed by 32 lowercase hex characters`)
    }
    if (!ids.includes(id)) ids.push(id)
  })
  if (ids.length > MAX_FILES_PER_MESSAGE) throw new FileError(400, 'invalid_request', `at most ${MAX_FILES_PER_MESSAGE} files per message`)
  const files = []
  for (const id of ids) {
    const record = await store.get(id)
    if (!record) throw new FileError(400, 'file_not_found', `file ${id} not found (it may have expired)`)
    files.push({ id: record.id, mime: record.mime, size: record.size, width: record.width, height: record.height })
  }
  return { ...meta, files }
}
