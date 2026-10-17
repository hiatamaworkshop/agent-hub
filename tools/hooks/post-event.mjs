#!/usr/bin/env node
// Stop の command hook (design.md §3.11 の未決 1)。hook の入力 JSON に作業フォルダの git の事実を 1 つの欄 (agent_hub_git) で足し、
// Hub の POST /events に送る。Hub は git を実行しない。
// 取れなくても、失敗しても、必ず exit 0 で終わる。取れた分がなければ入力をそのまま送る。stdout / stderr には何も出さない。
//
//   agent_hub_git: { head: "<HEAD の full sha>", changed: [...], untracked: [...] }
//   changed   = git diff --name-only HEAD (追跡ファイルの変更。staged と unstaged の両方)
//   untracked = git ls-files --others --exclude-standard (無視されていない未追跡ファイル)
//   パスはどちらもリポジトリのルートからの相対パス。配列はそれぞれ 1000 件まで
//
// 環境変数 (HTTP hook と同じもの): HUB_TOKEN (Bearer)、HUB_MAILBOX (X-Hub-Mailbox、空なら省く)、HUB_PORT (既定 7777)
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const FIELD = 'agent_hub_git'
const MAX_ITEMS = 1000
// hook 全体の上限。settings 側の timeout (6 秒) より先にこちらで終わらせる
const BUDGET_MS = 5000

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

async function send(body, headers) {
  const port = process.env.HUB_PORT || '7777'
  await fetch(`http://127.0.0.1:${port}/events`, {
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
  const facts = await gitFacts(cwd)
  const body = facts ? { ...input, [FIELD]: facts } : input

  const headers = { 'content-type': 'application/json' }
  if (process.env.HUB_TOKEN) headers.authorization = `Bearer ${process.env.HUB_TOKEN}`
  if (process.env.HUB_MAILBOX) headers['x-hub-mailbox'] = process.env.HUB_MAILBOX
  await send(body, headers)
}

// 全体の上限。入力が来ない・Hub が応答しない場合もここで終わる
setTimeout(() => process.exit(0), BUDGET_MS)
main()
  .catch(() => {})
  .finally(() => process.exit(0))
