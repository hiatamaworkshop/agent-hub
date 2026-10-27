// roadmap の項目の索引を Hub に送る (design.md §3.15 の索引の置き場所 b)。Hub は作業ツリーを読まないので、ホストで作って送る
// npm run docs:index [-- --project <フォルダ>] [--file <project からの相対パス>]
//   --project: 既定は npm を呼んだフォルダ (INIT_CWD)。別のプロジェクトは `npm --prefix <agent-hub> run docs:index` をそのルートで呼ぶ
//   --file: 既定は docs/roadmap.md
// 接続先とトークンは shim と同じ (HUB_URL か HUB_PORT、HUB_TOKEN。なければ agent-hub の .env を読む)
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkRoadmap, parseRoadmap } from '../shared/roadmap.js'
import { envValue } from '../shim/config.js'

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
const source = (option('--file') ?? 'docs/roadmap.md').replace(/\\/g, '/')
const path = join(project, source)

const envFile = join(ROOT, '.env')
if (!envValue(process.env, 'HUB_TOKEN') && existsSync(envFile)) process.loadEnvFile(envFile)
const hubUrl = (envValue(process.env, 'HUB_URL') ?? `http://127.0.0.1:${envValue(process.env, 'HUB_PORT') ?? '7777'}`).replace(/\/+$/, '')
const token = envValue(process.env, 'HUB_TOKEN') ?? ''

let text: string
try {
  text = readFileSync(path, 'utf8')
} catch (e) {
  console.error(`${path} を読めない: ${(e as Error).message}`)
  process.exit(1)
}

// 規則の崩れは知らせるが、送るのは止めない (崩れた項目も索引には出したほうが直しやすい)
const errors = checkRoadmap(text).filter((p) => p.level === 'error')
for (const p of errors) console.warn(`${path}:${p.line}: ${p.message}`)

// 予定の並びと閉じた行も送る (Hub は作業ツリーを読まない。design.md §3.15)
const { items, plan, closed } = parseRoadmap(text)
const res = await fetch(`${hubUrl}/indexes`, {
  method: 'PUT',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ project, source, items, plan, closed }),
}).catch((e: Error) => {
  console.error(`${hubUrl} に届かない: ${e.message}`)
  process.exit(1)
})
if (!res.ok) {
  // 404 は /indexes を持たない古い Hub
  console.error(`Hub が ${res.status} を返した: ${await res.text()}${res.status === 404 ? ' (Hub を再起動すると /indexes が使える)' : ''}`)
  process.exit(1)
}
console.log(`${items.length} items from ${source} → ${hubUrl} (project: ${project}${errors.length ? `, ${errors.length} rule errors` : ''})`)
