// 添付画像 (shim 側)。meta.files の画像を Hub から取り、ローカルのパスを足して agent に渡す。
// Hub の files.ts を import しない (sharp を shim に持ち込まないため)。id の形式だけここでも検証する
import { existsSync } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Message } from '../shared/types.js'

const FILE_ID_RE = /^f_[0-9a-f]{32}$/
const LOCAL_NAME_RE = /^f_[0-9a-f]{32}\.(jpg|png)$/
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' }
export const FETCH_TIMEOUT_MS = 15_000
export const MAX_FETCH_BYTES = 25 * 1024 * 1024
export const SWEEP_AGE_MS = 24 * 60 * 60 * 1000

export interface FileContext {
  hubUrl: string
  token: string
  // 保存先のルート。その下に <mailbox>/ を作る
  baseDir: string
  mailbox: string
  timeoutMs?: number
  maxBytes?: number
  log?: (msg: string) => void
}

// 取得の失敗は code だけを agent に渡す (expired は期限切れ、fetch_failed はそれ以外)
class FetchError extends Error {
  constructor(readonly code: 'expired' | 'fetch_failed') {
    super(code)
  }
}

// パスは区切りを / に統一する (JSON の \\ をモデルが誤って扱うのを避ける)
const slashed = (p: string) => p.replace(/\\/g, '/')

// 画像をローカルに取得する。同じ id が既にあれば取得しない (同じ id は同じ内容)
async function fetchToLocal(id: string, ctx: FileContext): Promise<string> {
  const dir = join(ctx.baseDir, ctx.mailbox)
  for (const ext of ['jpg', 'png']) {
    const existing = join(dir, `${id}.${ext}`)
    if (existsSync(existing)) return existing
  }
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), ctx.timeoutMs ?? FETCH_TIMEOUT_MS)
  try {
    let res: Response
    try {
      res = await fetch(`${ctx.hubUrl}/files/${id}`, { headers: { authorization: `Bearer ${ctx.token}` }, signal: ac.signal })
    } catch {
      throw new FetchError('fetch_failed')
    }
    if (res.status === 404) throw new FetchError('expired')
    if (!res.ok) throw new FetchError('fetch_failed')
    const maxBytes = ctx.maxBytes ?? MAX_FETCH_BYTES
    const ext = EXT[(res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()]
    if (!ext || Number(res.headers.get('content-length') ?? 0) > maxBytes) throw new FetchError('fetch_failed')
    let bytes: Buffer
    try {
      bytes = Buffer.from(await res.arrayBuffer())
    } catch {
      throw new FetchError('fetch_failed')
    }
    if (bytes.length === 0 || bytes.length > maxBytes) throw new FetchError('fetch_failed')
    const final = join(dir, `${id}.${ext}`)
    await mkdir(dir, { recursive: true })
    // 一時ファイルに書いてから rename する (途中で壊れた画像を agent に渡さない)
    const tmp = `${final}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(tmp, bytes)
      await rename(tmp, final)
    } catch {
      await rm(tmp, { force: true }).catch(() => undefined)
      throw new FetchError('fetch_failed')
    }
    return final
  } finally {
    clearTimeout(timer)
  }
}

async function resolveOne(f: unknown, ctx: FileContext): Promise<unknown> {
  // 想定外の形は触らずに通す
  if (typeof f !== 'object' || f === null || Array.isArray(f)) return f
  const id = (f as { id?: unknown }).id
  if (typeof id !== 'string' || !FILE_ID_RE.test(id)) return f
  try {
    return { ...f, path: slashed(await fetchToLocal(id, ctx)) }
  } catch (e) {
    const code = e instanceof FetchError ? e.code : 'fetch_failed'
    ctx.log?.(`file ${id}: ${code}`)
    return { ...f, error: code }
  }
}

// 配信用のコピーを返す。元のメッセージ (Hub の値) は書き換えない。例外にはしない
export async function resolveFiles(m: Message, ctx: FileContext): Promise<Message> {
  const meta = m.meta
  if (!meta || !Array.isArray(meta.files)) return m
  const files: unknown[] = []
  for (const f of meta.files) files.push(await resolveOne(f, ctx))
  return { ...m, meta: { ...meta, files } }
}

// 保存先の古いファイルを消す (起動時だけ。取得した画像だけを対象にする)。失敗しても 0 を返す
export async function sweepFiles(baseDir: string, now = Date.now(), maxAgeMs = SWEEP_AGE_MS): Promise<number> {
  let removed = 0
  try {
    for (const sub of await readdir(baseDir, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue
      const dir = join(baseDir, sub.name)
      for (const name of await readdir(dir)) {
        if (!LOCAL_NAME_RE.test(name)) continue
        const path = join(dir, name)
        const st = await stat(path).catch(() => undefined)
        if (!st || now - st.mtimeMs < maxAgeMs) continue
        await unlink(path).then(() => removed++, () => undefined)
      }
    }
  } catch {
    // 保存先がまだない、などは正常
  }
  return removed
}
