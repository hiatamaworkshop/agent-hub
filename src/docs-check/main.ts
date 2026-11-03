// ドキュメントの決定的な検査 (design.md §3.12 の層 1)。roadmap の項目の規則 (roadmap.md 冒頭、§3.15) を検査し、
// 検査する台帳がこのリポジトリの docs/roadmap.md のときは agent-hub 自身の文書の検査 (地図、protocol.md の表と names、§9 の日付。C9、C124、repo.ts) も加える
// npm run docs:check [-- <roadmap.md のパス>] [--index]
//   パス: 相対なら npm を呼んだフォルダ (INIT_CWD) から読む。docs:index の --file と同じ基準 (npm --prefix で別のプロジェクトから呼んでも、そのプロジェクトのファイル)
//   --index: 検査の代わりに項目の索引を JSON で出す
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkRoadmap, parseRoadmap } from '../shared/roadmap.js'
import { codeNames } from './code-names.js'
import { hubRoutes } from './hub-routes.js'
import { checkRepo } from './repo.js'

const args = process.argv.slice(2)
const indexOnly = args.includes('--index')
const path = args.find((a) => !a.startsWith('--')) ?? 'docs/roadmap.md'
const full = resolve(process.env.INIT_CWD ?? process.cwd(), path)
const text = readFileSync(full, 'utf8')

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const sameFile = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
const ownLedger = sameFile(full, resolve(repoRoot, 'docs/roadmap.md'))

// process.exit は使わない。パイプへの書き込みが終わる前に止まり、出力の終わりが欠けうるため (exitCode を置いて自然に終わる)
if (indexOnly) {
  process.stdout.write(JSON.stringify(parseRoadmap(text), null, 2) + '\n')
} else {
  const problems = checkRoadmap(text).map((p) => ({ ...p, file: path }))
  if (ownLedger) {
    // 表示はこのリポジトリからの相対パス。台帳と同じ書き方にそろえるため、呼んだフォルダから見た形にする
    const base = process.env.INIT_CWD ?? process.cwd()
    for (const p of checkRepo(repoRoot, hubRoutes(), codeNames())) problems.push({ ...p, file: relative(base, resolve(repoRoot, p.file)).replace(/\\/g, '/') })
  }
  for (const p of problems) console.log(`${p.file}:${p.line}: ${p.level}: ${p.message}`)
  const errors = problems.filter((p) => p.level === 'error').length
  const { items } = parseRoadmap(text)
  console.log(`${items.length} items, ${errors} errors, ${problems.length - errors} warnings${ownLedger ? ' (with the checks of agent-hub\'s own docs)' : ''}`)
  if (errors > 0) process.exitCode = 1
}
