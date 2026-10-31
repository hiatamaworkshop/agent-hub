// `agent`: start Claude Code for one role with the channel enabled, in the project's root.
// The role's description in roles.json goes into the shim's instructions. If tools/dev/roles/<role>.md exists,
// it is added to the system prompt as detailed operating instructions.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { defaultMailboxName } from '../shared/types.js'
import { checkClaudeCli, checkoutWarnings, claudeCommand, hookWarning, spawnArgs, startStatusPath, testClaudeCli } from './checks.js'
import { envSetting, hubRolesFile, readRoleNames, ROOT } from './env.js'
import { checkClaudeVersion, recordStart } from './startlog.js'
import { waitForEnter } from './prompt.js'

export interface AgentOptions {
  role: string
  projectDir: string
  model?: string
  mailbox?: string
  // Passed as --permission-mode only when given; otherwise Claude Code's default applies (design.md §6.1o)
  permissionMode?: string
  // Started by `team`, which has already checked the checkout. Keep the tab open on failure so the reason can be read
  fromTeam?: boolean
}

export function claudeArgs(o: AgentOptions, root: string, mcpConfig: string, filesDir: string): string[] {
  const args = ['--mcp-config', mcpConfig, '--dangerously-load-development-channels', 'server:agent-hub']
  const roleFile = join(root, 'tools', 'dev', 'roles', `${o.role}.md`)
  if (existsSync(roleFile)) args.push('--append-system-prompt-file', roleFile)
  const model = o.model ?? (o.role === 'deployer' ? 'haiku' : undefined)
  if (model) args.push('--model', model)
  if (o.permissionMode) args.push('--permission-mode', o.permissionMode)
  // --settings is not passed: with 2.1.301 it made the model name read as "--settings" (design.md §6.1f).
  // --add-dir takes a variable number of values, so it goes last. It lets the agent Read attached images
  args.push('--add-dir', filesDir)
  return args
}

export async function runAgent(o: AgentOptions): Promise<number> {
  const mailbox = o.mailbox ?? defaultMailboxName(o.projectDir, o.role)
  const statusFile = startStatusPath(mailbox)
  const startedAt = Date.now()
  const writeStatus = (exitCode: number, reason: string | null) => {
    mkdirSync(dirname(statusFile), { recursive: true })
    writeFileSync(statusFile, JSON.stringify({ exitCode, elapsedSec: Math.round((Date.now() - startedAt) / 1000), reason, endedAt: new Date().toISOString() }, null, 2))
  }
  const fail = async (reason: string) => {
    console.error(reason)
    writeStatus(1, reason)
    if (o.fromTeam) await waitForEnter()
    return 1
  }

  // A role missing from the roles file is refused by the Hub (400 unknown_role) and the shim would only retry. Stop before claude.
  // Without the file nothing is checked (the Hub does not check role names either). Case-sensitive, like the Hub
  // Anything that throws before claude starts (a bad roles file, an unwritable folder) goes through fail(), so the reason
  // reaches the status file and the tab stays open when started by `team`
  let mcpConfig: string
  let filesDir: string
  try {
    const rolesFile = hubRolesFile()
    const known = readRoleNames(rolesFile)
    if (known && !known.includes(o.role)) return await fail(`Role ${o.role} is not in ${rolesFile} (valid roles: ${known.join(', ')})`)

    // The shim is pointed at agent-hub's dist/ by absolute path (tools/dev/mcp.json is relative to CLAUDE_PROJECT_DIR and only works inside agent-hub).
    // The content depends only on where agent-hub is, so roles started at the same time write the same file
    mcpConfig = join(tmpdir(), 'agent-hub-mcp.json')
    writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { 'agent-hub': { command: 'node', args: [join(ROOT, 'dist', 'shim', 'main.js')] } } }, null, 2))
    // Where attached images are saved (the shim's default, or HUB_FILES_DIR). Created first: passing a missing folder is unverified
    filesDir = process.env.HUB_FILES_DIR?.trim() || join(tmpdir(), 'agent-hub')
    mkdirSync(filesDir, { recursive: true })
  } catch (e) {
    return fail(`Could not prepare to start claude: ${e instanceof Error ? e.message : String(e)}`)
  }

  const cmd = claudeCommand()
  const notes: string[] = []
  const hw = hookWarning(o.projectDir, ROOT)
  if (hw) notes.push(hw)
  // Only when started on its own; `team` has already checked and recorded them (C58, C85)
  if (!o.fromTeam) {
    const cli = checkClaudeCli(cmd)
    const version = checkClaudeVersion(cli.output)
    if (version.warning) notes.push(version.warning)
    notes.push(...await checkoutWarnings(o.projectDir))
    await recordStart({ projectDir: o.projectDir, roles: [o.role], mailboxes: [mailbox], claudeVersion: cli.output, check: version, warnings: notes })
  }
  for (const w of notes) console.warn(`WARNING: ${w}`)

  console.log(`project: ${o.projectDir} / Mailbox: ${mailbox}`)
  const s = spawnArgs(cmd, claudeArgs(o, ROOT, mcpConfig, filesDir))
  // The HTTP hooks expand Authorization from HUB_TOKEN and do not read .env, so pass it. HUB_MAILBOX goes into the hooks' X-Hub-Mailbox header
  const env = { ...process.env, HUB_ROLE: o.role, HUB_MAILBOX: mailbox, HUB_TOKEN: envSetting('HUB_TOKEN', '') }
  // Ctrl+C belongs to claude. Without this, Node would exit and leave claude without its parent
  const ignore = () => {}
  process.on('SIGINT', ignore)
  const code = await new Promise<number>((done) => {
    const child = spawn(s.file, s.args, { cwd: o.projectDir, env, stdio: 'inherit', shell: s.shell })
    child.on('error', (e) => { console.error(`cannot start claude: ${e.message}`); done(1) })
    child.on('exit', (c, signal) => done(c ?? (signal ? 1 : 0)))
  })
  process.off('SIGINT', ignore)
  // On failure, take the reason from claude --version (claude's own output is not redirected so its screen is not broken)
  const reason = code !== 0 ? testClaudeCli(cmd) : null
  writeStatus(code, reason)
  if (code !== 0 && o.fromTeam) {
    console.error(`claude ended with exit code ${code}${reason ? `: ${reason}` : ''}`)
    await waitForEnter()
  }
  return code
}

export function clearStartStatus(mailbox: string): void {
  rmSync(startStatusPath(mailbox), { force: true })
}
