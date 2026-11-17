// npm run test:coverage (C173): runs the unit tests once more and prints line and branch coverage per file under src/.
// A measurement, not a gate: it exits 0 whatever the figures are, and 1 only when a test fails or the report cannot be read.
//
// How it measures (design.md §5): Node's own coverage for `node --test`, with the sources run by Node's type stripping
// (tools/dev/ts-resolve.mjs) instead of tsx, because the figures are only right when the text Node runs has the lines of
// the file on disk. Test files are left out of the figures, and so are child processes the tests start (the shim, docs:index;
// src/test-child.ts says why). public/index.html is outside it (ui:check covers it by scenes).
//   --lowest <n>   how many files with the lowest branch coverage to list under src/hub and src/shared (default 5)
import { spawnSync } from 'node:child_process'
import { appendFileSync, globSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const RESOLVER = pathToFileURL(join(ROOT, 'tools', 'dev', 'ts-resolve.mjs')).href
const lowestArg = process.argv.indexOf('--lowest')
const LOWEST = lowestArg >= 0 ? Number(process.argv[lowestArg + 1]) || 5 : 5

// Parses an lcov report into one entry per source file: lines and branches, found and hit
export function parseLcov(text) {
  const files = []
  let cur = null
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('SF:')) cur = { file: line.slice(3).replace(/\\/g, '/'), lines: { found: 0, hit: 0 }, branches: { found: 0, hit: 0 } }
    else if (!cur) continue
    else if (line.startsWith('LF:')) cur.lines.found = Number(line.slice(3))
    else if (line.startsWith('LH:')) cur.lines.hit = Number(line.slice(3))
    else if (line.startsWith('BRF:')) cur.branches.found = Number(line.slice(4))
    else if (line.startsWith('BRH:')) cur.branches.hit = Number(line.slice(4))
    else if (line === 'end_of_record') { files.push(cur); cur = null }
  }
  return files
}

const pct = (c) => (c.found === 0 ? 100 : (c.hit / c.found) * 100)
const cell = (c) => `${pct(c).toFixed(2).padStart(6)} (${c.hit}/${c.found})`

function main() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-hub-coverage-'))
  const lcov = join(dir, 'lcov.info')
  const run = spawnSync(process.execPath, [
    '--import', RESOLVER,
    '--test', '--experimental-test-coverage',
    '--test-coverage-exclude=src/**/*.test.ts', '--test-coverage-exclude=src/test-child.ts', '--test-coverage-exclude=tools/dev/ts-resolve.mjs',
    '--test-reporter=dot', '--test-reporter-destination=stdout',
    '--test-reporter=lcov', `--test-reporter-destination=${lcov}`,
    'src/**/*.test.ts',
  ], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, AGENT_HUB_TS_IMPORT: RESOLVER } })
  let text
  try {
    text = readFileSync(lcov, 'utf8')
  } catch (e) {
    console.error(`\ncoverage: no report was written (${e instanceof Error ? e.message : e})`)
    return 1
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  const measured = parseLcov(text).filter((f) => f.file.startsWith('src/')).sort((a, b) => a.file.localeCompare(b.file))
  const seen = new Set(measured.map((f) => f.file))
  // A file no test loads is not in the report at all, so it is listed apart: its figures are 0, not missing
  const sources = globSync('src/**/*.{ts,js}', { cwd: ROOT }).map((f) => f.replace(/\\/g, '/')).filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.d.ts') && f !== 'src/test-child.ts')
  const unloaded = sources.filter((f) => !seen.has(f)).sort()

  const width = Math.max(...measured.map((f) => f.file.length), 10)
  console.log(`\n${'file'.padEnd(width)} | ${'line % (hit/found)'.padEnd(20)} | branch % (hit/found)`)
  console.log(`${'-'.repeat(width)}-|-${'-'.repeat(20)}-|-${'-'.repeat(20)}`)
  for (const f of measured) console.log(`${f.file.padEnd(width)} | ${cell(f.lines).padEnd(20)} | ${cell(f.branches)}`)
  const sum = (key) => measured.reduce((a, f) => ({ found: a.found + f[key].found, hit: a.hit + f[key].hit }), { found: 0, hit: 0 })
  console.log(`${'-'.repeat(width)}-|-${'-'.repeat(20)}-|-${'-'.repeat(20)}`)
  console.log(`${`all ${measured.length} files loaded by a test`.padEnd(width)} | ${cell(sum('lines')).padEnd(20)} | ${cell(sum('branches'))}`)
  if (unloaded.length) console.log(`\nNo figures (not loaded by a test process; a child process a test starts is not measured, src/test-child.ts): ${unloaded.join(', ')}`)
  for (const prefix of ['src/hub/', 'src/shared/']) {
    const lowest = measured.filter((f) => f.file.startsWith(prefix)).sort((a, b) => pct(a.branches) - pct(b.branches)).slice(0, LOWEST)
    console.log(`\nLowest branch coverage under ${prefix}: ${lowest.map((f) => `${f.file.slice(prefix.length)} ${pct(f.branches).toFixed(2)}%`).join(', ')}`)
  }
  // On GitHub Actions the same table goes to the job's summary page, so the figures show without opening the log
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [
      `### Test coverage (${process.platform}, Node ${process.version})`,
      '',
      '| file | line % | branch % |',
      '|---|---:|---:|',
      ...measured.map((f) => `| ${f.file} | ${pct(f.lines).toFixed(2)} | ${pct(f.branches).toFixed(2)} |`),
      `| **all ${measured.length} files loaded by a test** | **${pct(sum('lines')).toFixed(2)}** | **${pct(sum('branches')).toFixed(2)}** |`,
      '',
      unloaded.length ? `No figures (not loaded by a test process): ${unloaded.join(', ')}` : '',
      '',
    ].join('\n')
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, md)
    } catch (e) {
      console.error(`coverage: could not write the job summary (${e instanceof Error ? e.message : e})`)
    }
  }
  if (run.status !== 0) console.error('\ncoverage: a test failed in this run (see above); the figures are of a failing run')
  return run.status === 0 ? 0 : 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main()
