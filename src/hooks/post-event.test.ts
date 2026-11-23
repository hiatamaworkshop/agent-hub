import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fromClaudeCodeHook } from '../hub/events.js'

// command hook の本体 (design.md §3.11)。子プロセスとして起動し、偽の Hub (ローカルの HTTP サーバー) に POST させて確かめる
const SCRIPT = resolve(import.meta.dirname, '../../tools/hooks/post-event.mjs')
const TOKEN = 'test-token-0123456789'

interface Received {
  headers: IncomingHttpHeaders
  body: Record<string, unknown>
  // the request path (C182: /events/claude-code or /events/antigravity)
  path: string
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
      received.push({ headers: req.headers, body: JSON.parse(text), path: req.url ?? '' })
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
function runHook(stdin: string, env: Record<string, string | undefined> = {}, args: string[] = [], script = SCRIPT) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((ok, fail) => {
    const child = spawn(process.execPath, [script, ...args], {
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
const sessionStart = (cwd: string) => ({ session_id: 's1', cwd, hook_event_name: 'SessionStart', source: 'startup', model: 'claude-opus-5' })

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

  it('--no-git: git リポジトリの中でも git を呼ばず、入力をそのまま送る (agent_hub_git は足さない)', async () => {
    const repo = await makeRepo()
    const input = sessionStart(repo)
    received = []
    const r = await runHook(JSON.stringify(input), {}, ['--no-git'])
    assert.equal(r.code, 0)
    assert.equal(r.stdout + r.stderr, '')
    assert.equal(received.length, 1)
    assert.deepEqual(received[0]!.body, input)
    assert.equal('agent_hub_git' in received[0]!.body, false)
  })

  it('--no-git で Hub が止まっている: exit 0 で、何も出さない', async () => {
    const probe = createServer()
    await new Promise<void>((ok) => probe.listen(0, '127.0.0.1', ok))
    const deadPort = (probe.address() as { port: number }).port
    await new Promise<void>((ok) => probe.close(() => ok()))
    const r = await runHook(JSON.stringify(sessionStart(await tempDir())), { HUB_PORT: String(deadPort) }, ['--no-git'])
    assert.equal(r.code, 0)
    assert.equal(r.stdout + r.stderr, '')
  })

  // Hub が受け取るときの変換 (src/hub/events.ts の fromClaudeCodeHook) を、fake Hub が受けた body に掛けて確かめる
  it('SessionStart は --no-git の有無のどちらでも session.start になる。changes は git の欄があるときだけ付く', async () => {
    const repo = await makeRepo()
    const input = sessionStart(repo)

    received = []
    await runHook(JSON.stringify(input), {}, ['--no-git'])
    const plain = fromClaudeCodeHook(received[0]!.body, undefined, new Date())
    assert.ok('event' in plain)
    assert.equal(plain.event.kind, 'session.start')
    assert.equal('changes' in plain.event, false)

    received = []
    await runHook(JSON.stringify(input))
    const withGit = fromClaudeCodeHook(received[0]!.body, undefined, new Date())
    assert.ok('event' in withGit)
    assert.equal(withGit.event.kind, 'session.start')
    assert.equal(withGit.event.changes?.untracked.includes('sub/new.md'), true)
  })
})

// C189: the Mailbox is named with --mailbox, and the token comes from agent-hub's .env when the environment has none. The .env cases run a copy
// of the poster in a temp tree that has its own .env (the poster reads .env from the tree it is in, so the real .env is not touched)
describe('tools/hooks/post-event.mjs: --mailbox and the .env token (C189)', () => {
  const agStart = { conversationId: 'conv-2', hookEventName: 'Stop', cwd: 'C:\\work\\agent-hub', workspacePaths: ['C:\\work\\agent-hub'] }
  const args = ['--no-git', '--source', 'antigravity']

  // A copy of the poster in its own tree with a .env, and the path of the copy
  async function treeWithEnv(dotEnv: string): Promise<string> {
    const root = await tempDir()
    await mkdir(join(root, 'tools', 'hooks'), { recursive: true })
    await copyFile(SCRIPT, join(root, 'tools', 'hooks', 'post-event.mjs'))
    await writeFile(join(root, '.env'), dotEnv)
    return join(root, 'tools', 'hooks', 'post-event.mjs')
  }

  it('--mailbox sends its name as X-Hub-Mailbox, and wins over HUB_MAILBOX', async () => {
    received = []
    await runHook(JSON.stringify(agStart), {}, [...args, '--mailbox', 'flagged'])
    assert.equal(received[0]!.headers['x-hub-mailbox'], 'flagged', 'the flag wins over HUB_MAILBOX=deployer')
    received = []
    await runHook(JSON.stringify(agStart), { HUB_MAILBOX: undefined }, [...args, '--mailbox', 'flagged'])
    assert.equal(received[0]!.headers['x-hub-mailbox'], 'flagged')
  })

  it('a --mailbox value that is not a Mailbox name is ignored: HUB_MAILBOX is used as before', async () => {
    received = []
    await runHook(JSON.stringify(agStart), {}, [...args, '--mailbox', '<mailbox>'])
    assert.equal(received[0]!.headers['x-hub-mailbox'], 'deployer')
    received = []
    await runHook(JSON.stringify(agStart), {}, [...args])
    assert.equal(received[0]!.headers['x-hub-mailbox'], 'deployer')
  })

  it('without HUB_TOKEN in the environment, the token is read from agent-hub\'s .env (the copy\'s own .env here)', async () => {
    received = []
    const script = await treeWithEnv('# comment\nHUB_TOKEN="dotenv-token-0123456789"  # the token\nHUB_MAILBOX=wrong\n')
    await runHook(JSON.stringify(agStart), { HUB_TOKEN: undefined, HUB_MAILBOX: undefined }, [...args, '--mailbox', 'rev-a'], script)
    assert.equal(received[0]!.headers.authorization, 'Bearer dotenv-token-0123456789')
    assert.equal(received[0]!.headers['x-hub-mailbox'], 'rev-a', 'the flag names the Mailbox; HUB_MAILBOX in .env is not read')
  })

  it('with no --mailbox and no HUB_MAILBOX, .env\'s HUB_MAILBOX is not used: the header is left out', async () => {
    received = []
    const script = await treeWithEnv('HUB_TOKEN=dotenv-token-0123456789\nHUB_MAILBOX=wrong\n')
    await runHook(JSON.stringify(agStart), { HUB_TOKEN: undefined, HUB_MAILBOX: undefined }, [...args], script)
    assert.equal(received[0]!.headers.authorization, 'Bearer dotenv-token-0123456789')
    assert.equal(received[0]!.headers['x-hub-mailbox'], undefined)
  })

  it('with HUB_TOKEN set, .env is not read: the environment\'s token is sent', async () => {
    received = []
    const script = await treeWithEnv('HUB_TOKEN=dotenv-token-0123456789\n')
    await runHook(JSON.stringify(agStart), {}, [...args, '--mailbox', 'rev-a'], script)
    assert.equal(received[0]!.headers.authorization, `Bearer ${TOKEN}`)
  })
})

// C182: Antigravity's hooks run the same poster with --source antigravity (no git), and tools/hooks/hooks.json is its template
describe('tools/hooks/post-event.mjs --source antigravity (C182)', () => {
  const agStart = { conversationId: 'conv-1', modelName: 'gemini-3.8-flash-low', hookEventName: 'SessionStart', cwd: 'C:\work\agent-hub', workspacePaths: ['C:\work\agent-hub'] }

  it('posts the input as is to /events/antigravity with the Mailbox header and the token, exits 0 and prints nothing', async () => {
    received = []
    const r = await runHook(JSON.stringify(agStart), {}, ['--no-git', '--source', 'antigravity'])
    assert.equal(r.code, 0)
    assert.equal(r.stdout + r.stderr, '')
    assert.equal(received.length, 1)
    assert.equal(received[0]!.path, '/events/antigravity')
    assert.deepEqual(received[0]!.body, agStart)
    assert.equal(received[0]!.headers['x-hub-mailbox'], 'deployer')
    assert.equal(received[0]!.headers.authorization, `Bearer ${TOKEN}`)
  })

  it('without --source the path is still /events/claude-code', async () => {
    received = []
    await runHook(JSON.stringify(agStart), {}, ['--no-git'])
    assert.equal(received[0]!.path, '/events/claude-code')
  })

  it('a --source that is not a plain name falls back to claude-code; a Hub that is down still exits 0 with no output', async () => {
    received = []
    await runHook(JSON.stringify(agStart), {}, ['--no-git', '--source', '../x'])
    assert.equal(received[0]!.path, '/events/claude-code')
    const down = await runHook(JSON.stringify(agStart), { HUB_PORT: '1' }, ['--no-git', '--source', 'antigravity'])
    assert.equal(down.code, 0)
    assert.equal(down.stdout + down.stderr, '')
  })

  it('tools/hooks/hooks.json: the handlers are command hooks that run the poster for Antigravity at SessionStart and Stop, with no git', async () => {
    const template = JSON.parse(await readFile(resolve(import.meta.dirname, '../../tools/hooks/hooks.json'), 'utf8')) as Record<string, Record<string, { type: string; command: string; timeout: number }[]>>
    const hooks = Object.values(template)[0]!
    assert.deepEqual(Object.keys(hooks).sort(), ['SessionStart', 'Stop'])
    for (const name of ['SessionStart', 'Stop']) {
      const handlers = hooks[name]!
      assert.equal(handlers.length, 1)
      assert.equal(handlers[0]!.type, 'command')
      assert.match(handlers[0]!.command, /post-event\.mjs" --source antigravity --mailbox <mailbox> --no-git$/)
      assert.ok(handlers[0]!.timeout > 0)
    }
    // C189: the template names the Mailbox and carries no token (the token comes from agent-hub's .env)
    const text = await readFile(resolve(import.meta.dirname, '../../tools/hooks/hooks.json'), 'utf8')
    assert.doesNotMatch(text, /HUB_TOKEN|Bearer|authorization/i)
  })
})
