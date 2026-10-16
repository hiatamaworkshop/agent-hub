// Hub の起動。設定は環境変数だけで受け取る (design.md §3.8)
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { FileStore } from './files.js'
import { Hub } from './hub.js'
import { SettingsStore } from './settings.js'
import { Store } from './store.js'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

const host = process.env.HUB_HOST ?? '127.0.0.1'
const port = Number(process.env.HUB_PORT ?? 7777)
const token = process.env.HUB_TOKEN ?? ''
const dataDir = resolve(process.env.HUB_DATA_DIR ?? join(ROOT, 'data'))

if (token.length < 16) {
  console.error('HUB_TOKEN (16 文字以上) を .env か環境変数で設定してください。.env.example を参照')
  process.exit(1)
}
if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
  // Docker 内の 0.0.0.0 は想定どおり。その場合は公開側を 127.0.0.1:<port> に限定すること
  console.warn(`[hub] HUB_HOST=${host} はループバック以外にも bind する。外部から到達できないことを確認すること`)
}

// 画像の長辺の上限 (px) と、揮発ファイルの保存期間 (日、0 なら掃除しない)
const maxEdge = Number(process.env.HUB_FILE_MAX_EDGE ?? 1568)
const ttlDays = Number(process.env.HUB_FILE_TTL_DAYS ?? 7)
if (!Number.isInteger(maxEdge) || maxEdge < 16 || maxEdge > 8192) {
  console.error('HUB_FILE_MAX_EDGE は 16〜8192 の整数で設定してください')
  process.exit(1)
}
if (!Number.isFinite(ttlDays) || ttlDays < 0) {
  console.error('HUB_FILE_TTL_DAYS は 0 以上の数で設定してください (0 で掃除しない)')
  process.exit(1)
}

const store = new Store({ file: join(dataDir, 'hub.jsonl') })
const settings = new SettingsStore(join(dataDir, 'settings.json'))
const files = new FileStore({ dir: join(dataDir, 'files'), maxEdge, ttlDays })
const app = createApp({
  hub: new Hub(store),
  token,
  settings,
  files,
  uiHtml: async () => {
    try {
      return await readFile(join(ROOT, 'public', 'index.html'), 'utf8')
    } catch {
      return null
    }
  },
})

// 揮発ファイルの掃除: 起動時と 1 時間ごと。タイマーは終了を妨げない
const sweep = () =>
  files.sweep().then(
    (n) => { if (n > 0) console.log(`[hub] expired files removed: ${n}`) },
    (e) => console.error('[hub] file sweep failed:', (e as Error).message),
  )
void sweep()
setInterval(sweep, 60 * 60 * 1000).unref()

serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  const shown = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
  console.log(`[hub] listening on ${info.address}:${info.port} (data: ${dataDir}, lastSeq: ${store.lastSeq})`)
  console.log(`[hub] UI: http://${shown}:${info.port}/?token=${token}`)
})
