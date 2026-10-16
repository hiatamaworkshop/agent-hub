// Hub の起動。設定は環境変数だけで受け取る (design.md §3.8)
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { Hub } from './hub.js'
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

const store = new Store({ file: join(dataDir, 'hub.jsonl') })
const app = createApp({
  hub: new Hub(store),
  token,
  uiHtml: async () => {
    try {
      return await readFile(join(ROOT, 'public', 'index.html'), 'utf8')
    } catch {
      return null
    }
  },
})

serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  const shown = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
  console.log(`[hub] listening on ${info.address}:${info.port} (data: ${dataDir}, lastSeq: ${store.lastSeq})`)
  console.log(`[hub] UI: http://${shown}:${info.port}/?token=${token}`)
})
