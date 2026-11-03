// roadmap の項目の索引を Hub に送る (design.md §3.15 の索引の置き場所 b)。Hub は作業ツリーを読まないので、ホストで作って送る
// npm run docs:index [-- --project <フォルダ>] [--file <project からの相対パス>] [--if-touched]
//   --project: 既定は npm を呼んだフォルダ (INIT_CWD)。別のプロジェクトは `npm --prefix <agent-hub> run docs:index` をそのルートで呼ぶ
//   --file: 既定はそのプロジェクトの .agent-hub.json の "ledger" (なければ docs/roadmap.md。C107、src/shared/ledger.ts)
//   --if-touched: 標準入力の変わったパス (git diff-tree -z の出力、NUL 区切り) に台帳があるときだけ送る。post-commit フックが使う (C52, C107, C126)
//   台帳の path は src/shared/ledger.ts の canonicalPath の形にそろえて比べる (--file も同じ。書き方は docs/usage.md)
// 接続先とトークンは shim と同じ (HUB_URL か HUB_PORT、HUB_TOKEN。なければ agent-hub の .env を読む)
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { envValue } from '../shim/config.js'
import { envOverrides, overrideWarning, tokenFromEnvironment } from '../shared/env-override.js'
import { canonicalPath, readLedgerSetting, touchesLedger } from '../shared/ledger.js'
import { sendLedgerIndex } from './send-index.js'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

function option(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  if (i < 0) return undefined
  const v = process.argv[i + 1]
  if (v === undefined || v.startsWith('--')) {
    console.error(`${name} には値が要る`)
    process.exit(2)
  }
  return v
}

const project = resolve(option('--project') ?? process.env.INIT_CWD ?? process.cwd())
const setting = readLedgerSetting(project)
if (setting.warning) console.warn(`${join(project, '.agent-hub.json')}: ${setting.warning}`)
// --file と設定は同じ形にそろえる (C126)。同じファイルは 1 つの source になる。形にできない --file は警告を出し、
// プロジェクトの台帳 (設定、なければ docs/roadmap.md) を使う。送るかどうかは、その台帳で決まる
const fileOption = option('--file')
let source = setting.source
if (fileOption !== undefined) {
  const named = canonicalPath(fileOption)
  if (named === null) console.warn(`--file ${fileOption} is not a path inside the project (relative, without ..), so ${setting.source} (the project's ledger) is used`)
  else source = named
}

// フックから呼ばれたとき: この commit で台帳が変わっていなければ、何も送らずに終わる
if (process.argv.includes('--if-touched')) {
  // 標準入力は git diff-tree -z の出力 (NUL 区切り。引用されないので、非 ASCII・空白・改行のあるパスもそのまま) (C126)
  const changed = readFileSync(0, 'utf8').split('\0')
  if (!touchesLedger(changed, source)) process.exit(0)
}

// A variable in this terminal that overrides agent-hub's .env (C119): one warning each, names only. Printed after the --if-touched exit,
// so a commit that does not change the ledger stays silent
for (const name of envOverrides(ROOT)) console.warn(`WARNING: ${overrideWarning(name)}`)

const envFile = join(ROOT, '.env')
if (!envValue(process.env, 'HUB_TOKEN') && existsSync(envFile)) process.loadEnvFile(envFile)
const hubUrl = (envValue(process.env, 'HUB_URL') ?? `http://127.0.0.1:${envValue(process.env, 'HUB_PORT') ?? '7777'}`).replace(/\/+$/, '')
const token = envValue(process.env, 'HUB_TOKEN') ?? ''

const r = await sendLedgerIndex({ project, source, hubUrl, token, tokenFromEnv: tokenFromEnvironment() })
if (!r.sent) {
  console.error(`${source} を送れない: ${r.reason}`)
  process.exit(1)
}
for (const w of r.warnings) console.warn(w)
console.log(`${r.items} items from ${r.source} → ${hubUrl} (project: ${project}${r.warnings.length ? `, ${r.warnings.length} rule errors` : ''})`)
