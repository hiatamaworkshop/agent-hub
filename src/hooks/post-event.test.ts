import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, describe, it } from 'node:test'

// command hook の本体 (design.md §3.11)。子プロセスとして起動し、偽の Hub (ローカルの HTTP サーバー) に POST させて確かめる
const SCRIPT = resolve(import.meta.dirname, '../../tools/hooks/post-event.mjs')
const TOKEN = 'test-token-0123456789'

interface Received {
  headers: IncomingHttpHeaders
  body: Record<string, unknown>
}

let server: Server
let port: number
let received: Received[] = []
const dirs: string[] = []

before(async () => {
  server = createServer((req, res) => {
    let text = ''
    req.on('data', (c) => (text += c))
    req.on('end', () => {
      received.push({ headers: req.headers, body: JSON.parse(text) })
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"id":"e_x","kind":"turn.end","mailbox":null,"duplicate":false}')
    })
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  port = (server.address() as { port: number }).port
})

after(async () => {
  await new Promise<void>((ok) => server.close(() => ok()))
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})

// hook を起動する。env は HUB_* だけを上書きし、PATH はそのまま (git を探せるように)
function runHook(stdin: string, env: Record<string, string | undefined> = {}) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((ok, fail) => {
    const child = spawn(process.execPath, [SCRIPT], {
      env: { ...process.env, HUB_PORT: String(port), HUB_TOKEN: TOKEN, HUB_MAILBOX: 'deployer', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => (stdout += c))
    child.stderr.on('data', (c) => (stderr += c))
    child.on('error', fail)
    child.on('close', (code) => ok({ code, stdout, stderr }))
    child.stdin.end(stdin)
  })
}

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout
}

async function tempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'agent-hub-hook-'))
  dirs.push(d)
  return d
}

// コミット 1 件、変更 1 件、未追跡 1 件 (サブフォルダ内)、無視される未追跡 1 件を持つリポジトリ
async function makeRepo(): Promise<string> {
  const repo = await tempDir()
  git(repo, 'init', '-q')
  await writeFile(join(repo, 'a.txt'), 'one\n')
  await writeFile(join(repo, '.gitignore'), '*.log\n')
  git(repo, 'add', '.')
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'init')
  await writeFile(join(repo, 'a.txt'), 'two\n')
  await mkdir(join(repo, 'sub'))
  await writeFile(join(repo, 'sub', 'new.md'), '# new\n')
  await writeFile(join(repo, 'ignored.log'), 'x\n')
  return repo
}

const stop = (cwd: string) => ({ session_id: 's1', cwd, hook_event_name: 'Stop', last_assistant_message: 'done', stop_hook_active: false })

describe('tools/hooks/post-event.mjs', () => {
  it('git リポジトリ: HEAD・変更・未追跡を agent_hub_git に足し、認証と mailbox のヘッダーを付けて送る', async () => {
    const repo = await makeRepo()
    const sub = join(repo, 'sub')
    received = []
    const r = await runHook(JSON.stringify(stop(sub)))
    assert.equal(r.code, 0)
    assert.equal(r.stdout + r.stderr, '')
    assert.equal(received.length, 1)
    const { headers, body } = received[0]!
    assert.equal(headers.authorization, `Bearer ${TOKEN}`)
    assert.equal(headers['x-hub-mailbox'], 'deployer')
    // 入力の欄はそのまま残り、足すのは 1 つだけ
    assert.equal(body.session_id, 's1')
    assert.equal(body.hook_event_name, 'Stop')
    // パスはリポジトリのルートから。cwd が sub でも揃う。無視される *.log は含まない
    assert.deepEqual(body.agent_hub_git, {
      head: git(repo, 'rev-parse', 'HEAD').trim(),
      changed: ['a.txt'],
      untracked: ['sub/new.md'],
    })
  })

  it('git リポジトリでないフォルダ: 入力をそのまま送る (欄は足さない)', async () => {
    const dir = await tempDir()
    const input = stop(dir)
    received = []
    const r = await runHook(JSON.stringify(input))
    assert.equal(r.code, 0)
    assert.equal(r.stderr, '')
    assert.equal(received.length, 1)
    assert.deepEqual(received[0]!.body, input)
  })

  it('git がない (PATH が空): 入力をそのまま送り、exit 0 で、何も出さない', async () => {
    const dir = await tempDir()
    const input = stop(dir)
    received = []
    const r = await runHook(JSON.stringify(input), { PATH: '', Path: '' })
    assert.equal(r.code, 0)
    assert.equal(r.stdout + r.stderr, '')
    assert.equal(received.length, 1)
    assert.deepEqual(received[0]!.body, input)
  })

  it('Hub が止まっている: exit 0 で、何も出さない', async () => {
    // 空いているポートを取ってから閉じる
    const probe = createServer()
    await new Promise<void>((ok) => probe.listen(0, '127.0.0.1', ok))
    const deadPort = (probe.address() as { port: number }).port
    await new Promise<void>((ok) => probe.close(() => ok()))
    const r = await runHook(JSON.stringify(stop(await tempDir())), { HUB_PORT: String(deadPort) })
    assert.equal(r.code, 0)
    assert.equal(r.stdout + r.stderr, '')
  })

  it('JSON でない入力・オブジェクトでない入力: exit 0 で、送らない', async () => {
    const count = received.length
    for (const stdin of ['not json', '[1,2]', '', 'null']) {
      const r = await runHook(stdin)
      assert.equal(r.code, 0)
      assert.equal(r.stdout + r.stderr, '')
    }
    assert.equal(received.length, count)
  })
})
