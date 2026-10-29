import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { claudeArgs } from './agent.js'
import { claudeCommand, hookWarning, spawnArgs } from './checks.js'
import { hookTemplate, runHooks } from './hooks.js'
import { envSetting, hubRolesFile, ROOT } from './env.js'
import { parse } from './options.js'
import { commandLine, quoteForPlatform } from './quote.js'
import { detectOpener, launchFor, wtSeparatorError } from './tabs.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'agent-hub-team-'))

test('options: roles split on commas, defaults, and errors', () => {
  const p = parse(['--roles', 'leader,deployer', '--roles', 'reviewer', '--project', 'x'])
  assert.equal(p.command, 'team')
  assert.deepEqual(p.roles, ['leader', 'deployer', 'reviewer'])
  assert.equal(p.attachTimeoutSec, 60)
  assert.equal(p.tabs, undefined)
  const a = parse(['agent', '--role', 'deployer', '--from-team', '--permission-mode', 'default'])
  assert.equal(a.command, 'agent')
  assert.equal(a.fromTeam, true)
  assert.equal(a.permissionMode, 'default')
  assert.throws(() => parse(['agent']), /--role/)
  assert.throws(() => parse(['--tabs', 'konsole']), /--tabs/)
  assert.throws(() => parse(['--attach-timeout', '0']), /attach-timeout/)
  assert.throws(() => parse(['start']), /Unknown command/)
})

test('env: environment wins over .env, and roles file paths resolve from the root', () => {
  const root = tmp()
  writeFileSync(join(root, '.env'), 'HUB_PORT=8000\nHUB_TOKEN="abc"\r\nHUB_PORT=9000\nHUB_ROLES_FILE=conf/roles.json\n')
  assert.equal(envSetting('HUB_PORT', '7777', root, {}), '9000')
  assert.equal(envSetting('HUB_TOKEN', '', root, {}), 'abc')
  assert.equal(envSetting('HUB_PORT', '7777', root, { HUB_PORT: '1234' }), '1234')
  assert.equal(envSetting('MISSING', 'd', root, {}), 'd')
  assert.equal(hubRolesFile(root, {}), join(root, 'conf', 'roles.json'))
  assert.equal(hubRolesFile(tmp(), {}).endsWith('roles.json'), true)
})

test('quote: each shell reads one argument back', () => {
  assert.equal(quoteForPlatform('plain/path.ts', 'posix'), 'plain/path.ts')
  assert.equal(quoteForPlatform("it's here", 'posix'), `'it'\\''s here'`)
  assert.equal(quoteForPlatform("C:\\a b\\it's", 'powershell'), `'C:\\a b\\it''s'`)
  assert.equal(quoteForPlatform('C:\\Program Files\\x\\', 'win32'), '"C:\\Program Files\\x\\\\"')
  assert.equal(quoteForPlatform('C:\\x\\node.exe', 'win32'), 'C:\\x\\node.exe')
  assert.equal(commandLine('/srv/hub', ['node', 'a b'], 'linux'), "cd /srv/hub && node 'a b'")
  assert.equal(commandLine('C:\\hub dir', ['C:\\n\\node.exe', '--role', 'x'], 'win32'), "Set-Location 'C:\\hub dir'; & C:\\n\\node.exe --role x")
})

test('tabs: the opener per platform, falling back to print', () => {
  const has = (...names: string[]) => (n: string) => names.includes(n)
  assert.equal(detectOpener('win32', {}, has('wt.exe')), 'wt')
  assert.equal(detectOpener('win32', {}, has()), 'window')
  assert.equal(detectOpener('darwin', {}, has()), 'terminal')
  assert.equal(detectOpener('darwin', { TMUX: '/tmp/x' }, has('tmux')), 'tmux')
  assert.equal(detectOpener('linux', {}, has('tmux')), 'tmux')
  assert.equal(detectOpener('linux', {}, has()), 'print')
  assert.equal(detectOpener('linux', { TMUX: '/tmp/x' }, has()), 'print')
})

test('tabs: the command that opens each kind of tab', () => {
  const argv = ['/usr/bin/node', '--import', 'tsx', '/hub/src/team/main.ts', 'agent', '--role', 'leader']
  assert.deepEqual(launchFor('wt', 'hub.leader', 'C:\\hub', argv).args.slice(0, 7), ['-w', 'agent-hub', 'new-tab', '--title', 'hub.leader', '-d', 'C:\\hub'])
  const win = launchFor('window', 'hub.leader', 'C:\\my hub', ['C:\\node.exe', 'x'])
  assert.equal(win.verbatim, true)
  assert.deepEqual(win.args, ['/d', '/s', '/c', '"start "hub.leader" /D "C:\\my hub" C:\\node.exe x"'])
  const mac = launchFor('terminal', 'hub.leader', '/Users/a/my hub', argv)
  assert.equal(mac.file, 'osascript')
  assert.match(mac.args[1]!, /^tell application "Terminal" to do script ".*cd '\/Users\/a\/my hub' && \/usr\/bin\/node --import tsx/)
  assert.deepEqual(launchFor('tmux', 't', '/hub', ['node', 'x'], { insideTmux: true }).args, ['new-window', '-n', 't', '-c', '/hub', 'node x'])
  assert.deepEqual(launchFor('tmux', 't', '/hub', ['node'], {}).args.slice(0, 4), ['new-session', '-d', '-s', 'agent-hub'])
  assert.deepEqual(launchFor('tmux', 't', '/hub', ['node'], { tmuxSessionExists: true }).args.slice(0, 4), ['new-window', '-d', '-t', 'agent-hub:'])
})

test('claude: claude.exe before claude.cmd on Windows, and a .cmd goes through cmd.exe', () => {
  const a = tmp()
  const b = tmp()
  writeFileSync(join(a, 'claude.cmd'), '')
  writeFileSync(join(b, 'claude.exe'), '')
  const sep = process.platform === 'win32' ? ';' : ':'
  assert.deepEqual(claudeCommand('win32', { PATH: [a, b].join(sep) }), { file: join(b, 'claude.exe'), viaCmd: false })
  assert.deepEqual(claudeCommand('win32', { PATH: a }), { file: join(a, 'claude.cmd'), viaCmd: true })
  assert.deepEqual(claudeCommand('linux', { PATH: b }), { file: 'claude', viaCmd: false })
  const s = spawnArgs({ file: 'C:\\n v\\claude.cmd', viaCmd: true }, ['--version', 'a b'])
  assert.deepEqual(s, { file: '"C:\\n v\\claude.cmd" --version "a b"', args: [], shell: true })
})

test('agent: claude arguments, with haiku for the deployer and --add-dir last', () => {
  const root = tmp()
  mkdirSync(join(root, 'tools', 'dev', 'roles'), { recursive: true })
  writeFileSync(join(root, 'tools', 'dev', 'roles', 'leader.md'), '')
  const leader = claudeArgs({ role: 'leader', projectDir: root, permissionMode: 'default' }, root, 'mcp.json', 'files')
  assert.deepEqual(leader, ['--mcp-config', 'mcp.json', '--dangerously-load-development-channels', 'server:agent-hub',
    '--append-system-prompt-file', join(root, 'tools', 'dev', 'roles', 'leader.md'), '--permission-mode', 'default', '--add-dir', 'files'])
  const deployer = claudeArgs({ role: 'deployer', projectDir: root }, root, 'mcp.json', 'files')
  assert.deepEqual(deployer.slice(4), ['--model', 'haiku', '--add-dir', 'files'])
})

test('hook warning: none, some events missing, a script that does not exist, and all set (C69)', () => {
  const home = tmp()
  const project = tmp()
  assert.match(hookWarning(project, ROOT, home)!, /No Hub hook settings found.*hooks --project .* --write/)
  mkdirSync(join(project, '.claude'))
  const local = join(project, '.claude', 'settings.local.json')
  writeFileSync(local, '{"hooks":{"Stop":[{"hooks":[{"type":"http","url":"http://127.0.0.1:7777/events/claude-code"}]}]}}')
  const partial = hookWarning(project, ROOT, home)!
  assert.match(partial, /Hub hooks missing for .*SessionStart/)
  assert.doesNotMatch(partial, /missing for Stop,/)
  writeFileSync(local, '{"hooks":{"Notification":[{"hooks":[{"type":"http","url":"http://127.0.0.1:7777/events"}]}]}}')
  assert.doesNotMatch(hookWarning(project, ROOT, home)!, /Notification/)
  writeFileSync(local, '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"node","args":["${CLAUDE_PROJECT_DIR}/tools/hooks/post-event.mjs"]}]}]}}')
  assert.match(hookWarning(project, ROOT, home)!, /post-event\.mjs, which does not exist here/)
  rmSync(local)
  mkdirSync(join(home, '.claude'))
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify(hookTemplate(ROOT, '7777')))
  assert.equal(hookWarning(project, ROOT, home), null)
})

test('hooks: the template points at agent-hub by absolute path, and --write adds only what is missing (C69)', () => {
  const t = hookTemplate(ROOT, '7795')
  const text = JSON.stringify(t)
  assert.ok(!text.includes('${CLAUDE_PROJECT_DIR}'))
  assert.ok(text.includes(`${ROOT.replace(/\\/g, '/')}/tools/hooks/post-event.mjs`))
  assert.ok(text.includes('127.0.0.1:7795') && !text.includes(':7777'))
  const home = tmp()
  const project = tmp()
  mkdirSync(join(project, '.claude'))
  const local = join(project, '.claude', 'settings.local.json')
  const mine = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node', args: [`${ROOT}/tools/hooks/post-event.mjs`] }] }] }, permissions: { allow: ['Bash(ls)'] } }
  writeFileSync(local, JSON.stringify(mine))
  const log = console.log
  console.log = () => {}
  try {
    assert.equal(runHooks(project, ROOT, false, home), 1)
    assert.deepEqual(JSON.parse(readFileSync(local, 'utf8')), mine)
    assert.equal(runHooks(project, ROOT, true, home), 0)
    const after = JSON.parse(readFileSync(local, 'utf8')) as { hooks: Record<string, unknown[]>; permissions: unknown }
    assert.deepEqual(after.permissions, mine.permissions)
    assert.deepEqual(after.hooks.Stop, mine.hooks.Stop)
    assert.deepEqual(Object.keys(after.hooks).sort(), Object.keys(t.hooks!).sort())
    assert.deepEqual(JSON.parse(readFileSync(`${local}.bak`, 'utf8')), mine)
    assert.equal(runHooks(project, ROOT, true, home), 0)
  } finally {
    console.log = log
  }
})

test('wt: an argument with ; is refused because wt would split the command there', () => {
  assert.equal(wtSeparatorError(['agent-hub', 'C:\work\a', 'node', '--role', 'leader']), null)
  assert.match(wtSeparatorError(['t', 'C:\work\a;b', 'node']) ?? '', /a;b/)
})
