// ドキュメントの決定的な検査 (design.md §3.12 の層 1)。今は roadmap の項目の規則だけ (roadmap.md 冒頭、§3.15)
// npm run docs:check [-- <roadmap.md のパス>] [--index]
//   --index: 検査の代わりに項目の索引を JSON で出す
import { readFileSync } from 'node:fs'
import { checkRoadmap, parseRoadmap } from '../shared/roadmap.js'

const args = process.argv.slice(2)
const indexOnly = args.includes('--index')
const path = args.find((a) => !a.startsWith('--')) ?? 'docs/roadmap.md'
const text = readFileSync(path, 'utf8')

if (indexOnly) {
  process.stdout.write(JSON.stringify(parseRoadmap(text), null, 2) + '\n')
  process.exit(0)
}

const problems = checkRoadmap(text)
for (const p of problems) console.log(`${path}:${p.line}: ${p.level}: ${p.message}`)
const errors = problems.filter((p) => p.level === 'error').length
const { items } = parseRoadmap(text)
console.log(`${items.length} items, ${errors} errors, ${problems.length - errors} warnings`)
process.exit(errors > 0 ? 1 : 0)
