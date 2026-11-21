// shim の設定。shim は状態を持たないので、ここで決まるのは接続先と名乗る名前だけ
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultMailboxName, isValidName } from '../shared/types.js'

export const ROOT = fileURLToPath(new URL('../..', import.meta.url))

// プロジェクトの出どころ (C180)。HUB_PROJECT → CLAUDE_PROJECT_DIR → クライアントの roots (initialize で決める) → process.cwd()
export type ProjectSource = 'HUB_PROJECT' | 'CLAUDE_PROJECT_DIR' | 'roots' | 'cwd'

export interface ShimConfig {
  hubUrl: string
  token: string
  mailbox: string
  role: string | null
  sessionId: string | undefined
  // attach で declare する作業フォルダ (project)。roots で決まるときは setProject で差し替える
  cwd: string
  projectSource: ProjectSource
  // HUB_MAILBOX で名前を与えたか。与えたときは、プロジェクトが変わっても Mailbox 名は変えない
  mailboxGiven: boolean
  // 添付画像の保存先のルート (既定は OS の一時フォルダの agent-hub。その下に <mailbox>/ を作る)
  filesDir: string
}

// 環境変数で決まるプロジェクト。どちらもなければ undefined (roots か process.cwd() に任せる)
export function projectFromEnv(env: NodeJS.ProcessEnv): { dir: string; source: 'HUB_PROJECT' | 'CLAUDE_PROJECT_DIR' } | undefined {
  const hub = envValue(env, 'HUB_PROJECT')
  if (hub) return { dir: hub, source: 'HUB_PROJECT' }
  const claude = envValue(env, 'CLAUDE_PROJECT_DIR')
  return claude ? { dir: claude, source: 'CLAUDE_PROJECT_DIR' } : undefined
}

// 環境変数がプロジェクトを決めているか。決めていれば roots は問い合わせない
export function envDecidesProject(cfg: Pick<ShimConfig, 'projectSource'>): boolean {
  return cfg.projectSource === 'HUB_PROJECT' || cfg.projectSource === 'CLAUDE_PROJECT_DIR'
}

// プロジェクトを決めて反映する。Mailbox 名は、HUB_MAILBOX で与えられていなければ決めたプロジェクトから作る (C180)
export function setProject(cfg: ShimConfig, dir: string, source: ProjectSource): void {
  cfg.cwd = dir
  cfg.projectSource = source
  if (!cfg.mailboxGiven) cfg.mailbox = defaultMailboxName(dir, cfg.role)
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

  // プロジェクトは環境変数から決まらなければ、initialize で roots を見て決める (C180)。ここでは process.cwd() を仮に置く
  const fromEnv = projectFromEnv(env)
  const cwd = fromEnv?.dir ?? process.cwd()
  const role = envValue(env, 'HUB_ROLE') ?? null
  // 優先順: HUB_MAILBOX → HUB_ROLE なら <フォルダ名>.<role> → フォルダ名 (design.md §3.3)
  const hubMailbox = envValue(env, 'HUB_MAILBOX')
  const mailbox = hubMailbox ?? defaultMailboxName(cwd, role)
  if (!isValidName(mailbox)) throw new Error(`Mailbox name "${mailbox}" does not match ^[a-z0-9][a-z0-9_.-]{0,63}$`)
  if (role !== null && !isValidName(role)) throw new Error(`role name "${role}" does not match ^[a-z0-9][a-z0-9_.-]{0,63}$`)
  const port = envValue(env, 'HUB_PORT') ?? '7777'
  return {
    hubUrl: (envValue(env, 'HUB_URL') ?? `http://127.0.0.1:${port}`).replace(/\/+$/, ''),
    token: envValue(env, 'HUB_TOKEN') ?? '',
    mailbox,
    role,
    // 公式資料には記載がないが、stdio サーバーの環境に設定され hook の session_id と一致する (design.md §6.1c)
    sessionId: envValue(env, 'CLAUDE_CODE_SESSION_ID'),
    cwd,
    projectSource: fromEnv?.source ?? 'cwd',
    mailboxGiven: hubMailbox !== undefined,
    filesDir: envValue(env, 'HUB_FILES_DIR') ?? join(tmpdir(), 'agent-hub'),
  }
}
