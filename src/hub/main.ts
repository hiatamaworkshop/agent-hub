// Hub の起動。設定は環境変数だけで受け取る (design.md §3.8)
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { FileStore } from './files.js'
import { Hub } from './hub.js'
import { IndexStore } from './indexes.js'
import { loadRoles, RolesError, type Roles } from './roles.js'
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
const ttlDays = Number(process.env.HUB_FILE_TTL_DAYS ?? 1)
if (!Number.isInteger(maxEdge) || maxEdge < 16 || maxEdge > 8192) {
  console.error('HUB_FILE_MAX_EDGE は 16〜8192 の整数で設定してください')
  process.exit(1)
}
if (!Number.isFinite(ttlDays) || ttlDays < 0) {
  console.error('HUB_FILE_TTL_DAYS は 0 以上の数で設定してください (0 で掃除しない)')
  process.exit(1)
}

// attach 時に流す未読の上限: 日数 (小数可) と件数。0 なら制限なし。超えた古い未読は放棄済みにする (design.md §3.3)
const unreadMaxAgeDays = Number(process.env.HUB_UNREAD_MAX_AGE_DAYS ?? 7)
const unreadMax = Number(process.env.HUB_UNREAD_MAX ?? 50)
if (!Number.isFinite(unreadMaxAgeDays) || unreadMaxAgeDays < 0) {
  console.error('HUB_UNREAD_MAX_AGE_DAYS は 0 以上の数で設定してください (0 で制限なし)')
  process.exit(1)
}
if (!Number.isInteger(unreadMax) || unreadMax < 0) {
  console.error('HUB_UNREAD_MAX は 0 以上の整数で設定してください (0 で制限なし)')
  process.exit(1)
}

// 渡し終えた Message と Event の保存期間 (時間、小数可)。0 なら自動では消さない (design.md §3.14)
const readRetentionHours = Number(process.env.HUB_READ_RETENTION_HOURS ?? 24)
if (!Number.isFinite(readRetentionHours) || readRetentionHours < 0) {
  console.error('HUB_READ_RETENTION_HOURS は 0 以上の数で設定してください (0 で自動では消さない)')
  process.exit(1)
}

// role 定義。読めない・形が違うなら黙って既定に戻さず、ファイル名と理由を出して止まる (ファイルがなければ P0 と同じ)
const rolesFile = resolve(process.env.HUB_ROLES_FILE ?? join(ROOT, 'roles.json'))
let roles: Roles | null
try {
  roles = loadRoles(rolesFile)
} catch (e) {
  if (!(e instanceof RolesError)) throw e
  console.error(`[hub] ${e.message}`)
  process.exit(1)
}
if (roles) console.log(`[hub] roles: ${rolesFile} (${roles.size} 件)`)

const store = new Store({
  file: join(dataDir, 'hub.jsonl'),
  roleSubscriptions: (role) => roles?.get(role)?.subscribe ?? [],
})
const settings = new SettingsStore(join(dataDir, 'settings.json'))
const files = new FileStore({ dir: join(dataDir, 'files'), maxEdge, ttlDays })
const indexes = new IndexStore(join(dataDir, 'indexes.json'))
const hub = new Hub(store, {
  roles,
  unreadMaxAgeMs: Math.round(unreadMaxAgeDays * 24 * 60 * 60_000),
  unreadMax,
  readRetentionMs: Math.round(readRetentionHours * 60 * 60_000),
})
const app = createApp({
  hub,
  token,
  settings,
  files,
  indexes,
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

// 渡し終えた Message と Event の掃除: 起動時と 1 時間ごと。消したらログを詰め直す
const purge = () => {
  try {
    const r = hub.sweep()
    if (r.messages || r.events) console.log(`[hub] expired messages removed: ${r.messages}, events: ${r.events}`)
  } catch (e) {
    console.error('[hub] message sweep failed:', (e as Error).message)
  }
}
purge()
setInterval(purge, 60 * 60 * 1000).unref()

serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  const shown = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
  console.log(`[hub] listening on ${info.address}:${info.port} (data: ${dataDir}, lastSeq: ${store.lastSeq})`)
  console.log(`[hub] UI: http://${shown}:${info.port}/?token=${token}`)
})
