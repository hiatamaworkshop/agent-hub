// shim の設定。shim は状態を持たないので、ここで決まるのは接続先と名乗る名前だけ
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultMailboxName, isValidName } from '../shared/types.js'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

export interface ShimConfig {
  hubUrl: string
  token: string
  mailbox: string
  role: string | null
  sessionId: string | undefined
  cwd: string
  // 添付画像の保存先のルート (既定は OS の一時フォルダの agent-hub。その下に <mailbox>/ を作る)
  filesDir: string
}

// 環境変数の値。空や空白だけは未設定として扱う (HUB_URL= のように空で渡されたら既定値を使う)
export function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const v = env[key]
  return v === undefined || v.trim() === '' ? undefined : v
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ShimConfig {
  // ユーザースコープで登録したとき ~/.claude.json にトークンを書かずに済むよう、agent-hub の .env を読む
  // (既に設定されている環境変数は上書きされない)
  const envFile = join(ROOT, '.env')
  if (env === process.env && !envValue(env, 'HUB_TOKEN') && existsSync(envFile)) process.loadEnvFile(envFile)

  const cwd = envValue(env, 'CLAUDE_PROJECT_DIR') ?? process.cwd()
  const role = envValue(env, 'HUB_ROLE') ?? null
  // 優先順: HUB_MAILBOX → HUB_ROLE なら <フォルダ名>.<role> → フォルダ名 (design.md §3.3)
  const mailbox = envValue(env, 'HUB_MAILBOX') ?? defaultMailboxName(cwd, role)
  if (!isValidName(mailbox)) throw new Error(`Mailbox 名 "${mailbox}" は ^[a-z0-9][a-z0-9_.-]{0,63}$ に合わない`)
  if (role !== null && !isValidName(role)) throw new Error(`role 名 "${role}" は ^[a-z0-9][a-z0-9_.-]{0,63}$ に合わない`)
  const port = envValue(env, 'HUB_PORT') ?? '7777'
  return {
    hubUrl: (envValue(env, 'HUB_URL') ?? `http://127.0.0.1:${port}`).replace(/\/+$/, ''),
    token: envValue(env, 'HUB_TOKEN') ?? '',
    mailbox,
    role,
    // 公式資料には記載がないが、stdio サーバーの環境に設定され hook の session_id と一致する (design.md §6.1c)
    sessionId: envValue(env, 'CLAUDE_CODE_SESSION_ID'),
    cwd,
    filesDir: envValue(env, 'HUB_FILES_DIR') ?? join(tmpdir(), 'agent-hub'),
  }
}
