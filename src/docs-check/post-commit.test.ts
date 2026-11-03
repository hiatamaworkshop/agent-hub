// The post-commit hook (tools/hooks/post-commit-index.sh) and docs:index's --file, run for real in a scratch git repository (C126).
// The Hub is pointed at a port nobody listens on, so a send that is tried fails with "Hub not reachable", and a commit that does
// not reach the send prints nothing about it. Each test makes its own repository and removes it afterwards.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const AGENT_HUB = fileURLToPath(new URL('../..', import.meta.url))
const HOOK = join(AGENT_HUB, 'tools', 'hooks', 'post-commit-index.sh')
const PUSH_INDEX = join(AGENT_HUB, 'src', 'docs-check', 'push-index.ts')
const dirs: string[] = []
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

// A roadmap with one item, so a send is attempted (an empty ledger is not sent)
const ITEM = '### C1. Test\n\n#### Done when\n- [ ] one\n'

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-hub-hook-'))
  dirs.push(dir)
  git(dir, 'init', '-q')
  return dir
}

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' }
function git(dir: string, ...args: string[]) {
  const r = spawnSync('git', args, { cwd: dir, env, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  return r
}

// Writes the files (null deletes one) and commits them
function commit(dir: string, files: Record<string, string | null>): void {
  for (const [name, text] of Object.entries(files)) {
    const path = join(dir, name)
    if (text === null) rmSync(path, { force: true })
    else {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, text)
    }
  }
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'test', '--allow-empty')
}

// The hook as git runs it after a commit: in the repository, with AGENT_HUB_DIR set and the Hub unreachable
function runHook(dir: string) {
  return spawnSync('sh', [HOOK], {
    cwd: dir,
    env: { ...env, AGENT_HUB_DIR: AGENT_HUB, HUB_URL: 'http://127.0.0.1:9', HUB_TOKEN: 'test-token' },
    encoding: 'utf8',
  })
}

test('the hook sends after a commit that changed a ledger with a non-ASCII path (C126)', () => {
  const dir = repo()
  commit(dir, { '.agent-hub.json': '{ "ledger": "docs/台帳.md" }', 'docs/台帳.md': ITEM })
  const r = runHook(dir)
  assert.equal(r.status, 0)
  assert.match(r.stderr, /docs\/台帳\.md を送れない: Hub not reachable/)
})

test('the hook sends for a non-canonical spelling of the ledger (docs//items.md is docs/items.md) (C126)', () => {
  const dir = repo()
  commit(dir, { '.agent-hub.json': '{ "ledger": "docs//items.md" }', 'docs/items.md': ITEM })
  const r = runHook(dir)
  assert.equal(r.status, 0)
  assert.match(r.stderr, /docs\/items\.md を送れない: Hub not reachable/)
})

test('the hook is silent after a commit that does not change the ledger (C126)', () => {
  const dir = repo()
  commit(dir, { '.agent-hub.json': '{ "ledger": "docs/台帳.md" }', 'docs/台帳.md': ITEM })
  commit(dir, { 'src/a.txt': 'x\n' })
  const r = runHook(dir)
  assert.equal(r.status, 0)
  assert.equal(r.stderr, '')
})

test('the hook shows the warning about an unusable .agent-hub.json on a commit that does not change the ledger (C126)', () => {
  const dir = repo()
  commit(dir, { '.agent-hub.json': '{broken', 'docs/roadmap.md': ITEM })
  commit(dir, { 'src/a.txt': 'x\n' })
  const r = runHook(dir)
  assert.equal(r.status, 0)
  assert.match(r.stderr, /not valid JSON/)
  assert.doesNotMatch(r.stderr, /Hub not reachable/)
})

test('a failed send says the real reason, not "Hub stopped or no token" (C126)', () => {
  const dir = repo()
  // no item in the ledger: push-index refuses to send it and says why (the Hub is not asked)
  commit(dir, { 'docs/roadmap.md': '# no items here\n' })
  const r = runHook(dir)
  assert.equal(r.status, 0)
  assert.match(r.stderr, /agent-hub: roadmap の索引を送れなかった/)
  assert.match(r.stderr, /docs\/roadmap\.md を送れない: docs\/roadmap\.md has no `### C<n>\.` items/)
  assert.doesNotMatch(r.stderr, /Hub stopped or no token/)
})

test('docs:index --file in another spelling names the same source (./docs/items.md is docs/items.md) (C126)', () => {
  const dir = repo()
  commit(dir, { 'docs/items.md': ITEM })
  const r = spawnSync(process.execPath, ['--import', 'tsx', PUSH_INDEX, '--project', dir, '--file', './docs/items.md'], {
    cwd: AGENT_HUB,
    env: { ...env, HUB_URL: 'http://127.0.0.1:9', HUB_TOKEN: 'test-token' },
    encoding: 'utf8',
  })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /docs\/items\.md を送れない: Hub not reachable/)
})

// docs:index with --file, run for real in a project; the Hub is unreachable, so the result shows which file was sent
function indexFile(dir: string, file: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', PUSH_INDEX, '--project', dir, '--file', file], {
    cwd: AGENT_HUB,
    env: { ...env, HUB_URL: 'http://127.0.0.1:9', HUB_TOKEN: 'test-token' },
    encoding: 'utf8',
  })
}

test('docs:index --file that cannot be put in the form warns and uses the project\'s default ledger (C126)', () => {
  const dir = repo()
  commit(dir, { 'docs/roadmap.md': ITEM, 'docs/items.md': ITEM })
  const r = indexFile(dir, '../items.md')
  assert.equal(r.status, 1) // the send to the unreachable Hub fails, as with any file
  assert.match(r.stderr, /--file \.\.\/items\.md is not a path inside the project .* so docs\/roadmap\.md \(the project's ledger\) is used/)
  assert.match(r.stderr, /docs\/roadmap\.md を送れない: Hub not reachable/)
  assert.doesNotMatch(r.stderr, /docs\/items\.md/)
})

test('docs:index --file that is empty warns and uses the project\'s ledger setting (C126)', () => {
  const dir = repo()
  commit(dir, { '.agent-hub.json': '{ "ledger": "docs/items.md" }', 'docs/items.md': ITEM })
  const r = indexFile(dir, '')
  assert.equal(r.status, 1)
  assert.match(r.stderr, /--file  is not a path inside the project .* so docs\/items\.md \(the project's ledger\) is used/)
  assert.match(r.stderr, /docs\/items\.md を送れない: Hub not reachable/)
})

test('docs:index --file that is absolute warns and uses the default ledger when there is no setting (C126)', () => {
  const dir = repo()
  commit(dir, { 'docs/roadmap.md': ITEM })
  const r = indexFile(dir, '/etc/x.md')
  assert.match(r.stderr, /--file \/etc\/x\.md is not a path inside the project/)
  assert.match(r.stderr, /docs\/roadmap\.md を送れない: Hub not reachable/)
})
