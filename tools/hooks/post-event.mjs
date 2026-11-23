#!/usr/bin/env node
// Stop の command hook (design.md §3.11 の未決 1)。hook の入力 JSON に作業フォルダの git の事実を 1 つの欄 (agent_hub_git) で足し、
// Hub の POST /events/claude-code に送る。Hub は git を実行しない。
// 取れなくても、失敗しても、必ず exit 0 で終わる。取れた分がなければ入力をそのまま送る。stdout / stderr には何も出さない。
//
//   agent_hub_git: { head: "<HEAD の full sha>", changed: [...], untracked: [...] }
//   changed   = git diff --name-only HEAD (追跡ファイルの変更。staged と unstaged の両方)
//   untracked = git ls-files --others --exclude-standard (無視されていない未追跡ファイル)
//   パスはどちらもリポジトリのルートからの相対パス。配列はそれぞれ 1000 件まで
//
//   --no-git: git を一切呼ばず、入力をそのまま送る (SessionStart など、git の事実が要らない Event 用の速い道)。上限は 2 秒
//
// 環境変数 (HTTP hook と同じもの): HUB_TOKEN (Bearer)、HUB_MAILBOX (X-Hub-Mailbox、空なら省く)、HUB_PORT (既定 7777)
// --mailbox <name> (C189): the Mailbox for X-Hub-Mailbox. It wins over HUB_MAILBOX, so a command hook can name its Mailbox without
// the App's environment. Without HUB_TOKEN in the environment, the token is read from agent-hub's .env (HUB_TOKEN only, as the shim
// reads it; HUB_MAILBOX in .env is not read, so a hook without --mailbox does not pick a Mailbox from there)
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const FIELD = 'agent_hub_git'
const MAX_ITEMS = 1000
const NO_GIT = process.argv.includes('--no-git')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/
// --mailbox <name>; a value that is not a Mailbox name is ignored, and HUB_MAILBOX is used as before (C189)
const MAILBOX = (() => {
  const i = process.argv.indexOf('--mailbox')
  const v = i >= 0 ? process.argv[i + 1] : undefined
  return typeof v === 'string' && NAME_RE.test(v) ? v : undefined
})()
// --source <name>: the client whose converter the Hub uses (POST /events/<name>). Default claude-code. Antigravity's hooks use
// `--source antigravity` (C182, tools/hooks/hooks.json). A name that is not a plain word falls back to the default
const SOURCE = (() => {
  const i = process.argv.indexOf('--source')
  const v = i >= 0 ? process.argv[i + 1] : undefined
  return typeof v === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(v) ? v : 'claude-code'
})()
// hook 全体の上限。settings 側の timeout (6 秒) より先にこちらで終わらせる
const BUDGET_MS = NO_GIT ? 2000 : 5000

const run = promisify(execFile)
const started = Date.now()
const remaining = () => Math.max(1, BUDGET_MS - (Date.now() - started))

async function readStdin() {
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  return text
}

async function git(args, cwd) {
  // -z で区切ると、改行を含むファイル名も正しく分けられる。core.quotePath で日本語のファイル名を引用符で包ませない
  const { stdout } = await run('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    timeout: remaining(),
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    encoding: 'utf8',
  })
  return stdout
}

const split = (out) => out.split('\0').filter((p) => p !== '').slice(0, MAX_ITEMS)

// HEAD が決まらない (git がない、リポジトリでない、コミットがない) ときは事実ごと取らない
async function gitFacts(cwd) {
  try {
    const head = (await git(['rev-parse', 'HEAD'], cwd)).trim()
    if (!head) return undefined
    const [changed, untracked] = await Promise.all([
      git(['diff', '-z', '--name-only', 'HEAD'], cwd),
      git(['ls-files', '-z', '--others', '--exclude-standard', '--full-name'], cwd),
    ])
    return { head, changed: split(changed), untracked: split(untracked) }
  } catch {
    return undefined
  }
}

// The token: HUB_TOKEN from the environment, else HUB_TOKEN from agent-hub's .env (C189). The .env file is read only when the environment has
// no HUB_TOKEN, as the shim's loadConfig does. Lines are read the way env-override.ts parses them (the last line of a name wins)
function tokenOf() {
  if (process.env.HUB_TOKEN) return process.env.HUB_TOKEN
  const file = join(ROOT, '.env')
  try {
    if (!existsSync(file)) return undefined
    let token
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?HUB_TOKEN\s*=\s*(.*)$/.exec(line)
      if (m) token = unquote(m[1].trim())
    }
    return token || undefined
  } catch {
    return undefined
  }
}

function unquote(raw) {
  const q = raw[0]
  if (q === '"' || q === "'") {
    const end = raw.indexOf(q, 1)
    return end > 0 ? raw.slice(1, end) : raw.slice(1)
  }
  return raw.replace(/\s+#.*$/, '').trim()
}

async function send(body, headers) {
  const port = process.env.HUB_PORT || '7777'
  await fetch(`http://127.0.0.1:${port}/events/${SOURCE}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(remaining()),
  })
}

async function main() {
  const input = JSON.parse(await readStdin())
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return
  const cwd = typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : process.cwd()
  const facts = NO_GIT ? undefined : await gitFacts(cwd)
  const body = facts ? { ...input, [FIELD]: facts } : input

  const headers = { 'content-type': 'application/json' }
  const token = tokenOf()
  if (token) headers.authorization = `Bearer ${token}`
  const mailbox = MAILBOX ?? process.env.HUB_MAILBOX
  if (mailbox) headers['x-hub-mailbox'] = mailbox
  await send(body, headers)
}

// 全体の上限。入力が来ない・Hub が応答しない場合もここで終わる
setTimeout(() => process.exit(0), BUDGET_MS)
main()
  .catch(() => {})
  .finally(() => process.exit(0))
