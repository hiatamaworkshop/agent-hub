// `agent`: start Claude Code for one role with the channel enabled, in the project's root.
// The role's description in roles.json goes into the shim's instructions. If tools/dev/roles/<role>.md exists,
// it is added to the system prompt as detailed operating instructions.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { chooseMailboxName, defaultMailboxName } from '../shared/types.js'
import { checkClaudeCli, checkoutWarnings, claudeCommand, hookWarning, spawnArgs, startStatusPath, testClaudeCli } from './checks.js'
import { envSetting, hubRolesFile, readRoleNames, ROOT } from './env.js'
import { checkClaudeVersion, emptyOutcome, recordResult, recordStart, type StartOutcome } from './startlog.js'
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
  // How long to wait for the attach on the Hub before the role is `failed` (`--attach-timeout`; 60 when not given). C100
  attachTimeoutSec?: number
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

export interface HubMailbox { name: string; project: string | null; attachment?: { attachmentId: string } | null }

// The Mailboxes the Hub lists, or null when it cannot be read (not 2xx, a timeout, a connection error). Without a token nothing is asked (C103)
export async function readHubMailboxes(token: string): Promise<HubMailbox[] | null> {
  if (!token) return null
  const port = Number(envSetting('HUB_PORT', '7777'))
  try {
    const r = await fetch(`http://127.0.0.1:${port}/mailboxes`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) })
    if (!r.ok) return null
    return ((await r.json()) as { mailboxes: HubMailbox[] }).mailboxes
  } catch {
    return null
  }
}

// The Attachment id the Hub holds for a Mailbox (C100). null: the Hub was read and the Mailbox is not attached.
// undefined: the Hub could not be read, so nothing is known about the attach.
// The two must not be mixed up: an unreadable baseline must not make another claude's attach look like this start's attach.
export async function attachmentOf(mailbox: string, token: string): Promise<string | null | undefined> {
  const list = await readHubMailboxes(token)
  if (!list) return undefined
  return list.find((m) => m.name === mailbox)?.attachment?.attachmentId ?? null
}

// Waits until the Hub shows an Attachment different from the baseline (C100). `attachmentOf` is asked every `intervalMs`.
// The baseline is `before` (the id held before claude started; null = not attached). If `before` could not be read (undefined),
// the first successful read becomes the baseline, and an unreadable read never counts as an attach. Only an id that differs from the baseline
// counts (an id when the baseline was null is new). Calls onAttached once when it is seen, or onTimeout once when `timeoutMs` passes first.
// The returned function stops the watch
export function watchAttach(w: {
  attachmentOf: () => Promise<string | null | undefined>
  before: string | null | undefined
  timeoutMs: number
  intervalMs: number
  onAttached: () => void
  onTimeout: () => void
}): () => void {
  let open = true
  let baseline = w.before
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = setTimeout(() => {
    if (!open) return
    stop()
    w.onTimeout()
  }, w.timeoutMs)
  const stop = () => {
    open = false
    clearTimeout(timer)
    clearTimeout(deadline)
  }
  const check = async () => {
    const now = await w.attachmentOf()
    if (!open) return
    if (now === undefined) {
      // Unreadable: nothing is known, so neither the baseline nor an attach
    } else if (baseline === undefined) {
      baseline = now
    } else if (now && now !== baseline) {
      stop()
      w.onAttached()
      return
    }
    timer = setTimeout(() => void check(), w.intervalMs)
  }
  void check()
  return stop
}

// Writes the result line at most once per start (C100): the first outcome counts, and a later one (an exit after a timeout, say) does not add a line
export function recordOnce(write: (outcome: StartOutcome) => void): (outcome: StartOutcome) => void {
  let written = false
  return (outcome) => {
    if (written) return
    written = true
    write(outcome)
  }
}

// Runs one start and guarantees one result line on every exit path (C100): a throw is recorded as `aborted` and rethrown, and a
// return that recorded nothing gets a line saying so
export async function withResult<T>(record: (outcome: StartOutcome) => void, body: () => Promise<T>): Promise<T> {
  try {
    return await body()
  } catch (e) {
    record({ ...emptyOutcome(), aborted: e instanceof Error ? e.message : String(e) })
    throw e
  } finally {
    record({ ...emptyOutcome(), aborted: 'the start ended without a result' })
  }
}

// The Mailbox an `agent` uses (C103). An explicit --mailbox is used as given. With a token, the name is chosen from the Hub's list, and a list
// that cannot be read is an error (the start then says to start the Hub or pass --mailbox; the default is not guessed). Without a token
// there is nothing to read, so the default name is used (usage.md)
export async function chooseAgentMailbox(
  o: { role: string; projectDir: string; mailbox?: string },
  token: string,
  read: (token: string) => Promise<HubMailbox[] | null>,
): Promise<string> {
  if (o.mailbox) return o.mailbox
  const list = await read(token)
  if (token && list === null) {
    throw new Error(`The Hub's Mailbox list cannot be read, so no Mailbox name is chosen. Start the Hub (or check HUB_TOKEN in .env), or pass --mailbox`)
  }
  return chooseMailboxName(o.projectDir, o.role, list ?? [])
}

export async function runAgent(o: AgentOptions): Promise<number> {
  // The start's time: the pre-start line and this start's result line share it (C88). `team` writes the result for the roles it starts
  const startTime = new Date().toISOString()
  const record = recordOnce(o.fromTeam ? () => {} : (outcome) => recordResult(startTime, o.projectDir, outcome))
  return withResult(record, async () => {
    // Inside withResult: a start that finds no free name still writes its result line (C100)
    // An explicit --mailbox, or the name `team` chose and passed on, is used as given. Otherwise the name is chosen from the Hub's list (C103)
    const token = envSetting('HUB_TOKEN', '')
    const mailbox = await chooseAgentMailbox(o, token, readHubMailboxes)
    if (!o.mailbox && !token) console.log(`No HUB_TOKEN, so the Mailbox list is not read: using ${mailbox}`)
    if (!o.mailbox && mailbox !== defaultMailboxName(o.projectDir, o.role)) console.log(`${defaultMailboxName(o.projectDir, o.role)} belongs to another project, so ${mailbox} is used`)
    return startRole(o, { mailbox, ref: { role: o.role, mailbox }, startTime, record })
  })
}

async function startRole(
  o: AgentOptions,
  c: { mailbox: string; ref: { role: string; mailbox: string }; startTime: string; record: (outcome: StartOutcome) => void },
): Promise<number> {
  const { mailbox, ref, startTime, record } = c
  const statusFile = startStatusPath(mailbox)
  const startedAt = Date.now()
  const writeStatus = (exitCode: number, reason: string | null) => {
    mkdirSync(dirname(statusFile), { recursive: true })
    writeFileSync(statusFile, JSON.stringify({ exitCode, elapsedSec: Math.round((Date.now() - startedAt) / 1000), reason, endedAt: new Date().toISOString() }, null, 2))
  }
  const fail = async (reason: string) => {
    console.error(reason)
    writeStatus(1, reason)
    record({ ...emptyOutcome(), failed: [{ ...ref, reason }] })
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
    // Unlike `team`, a claude that does not run does not stop the start (the spawn below fails and reports it), but it is recorded
    if (cli.problem) notes.push(`claude does not run: ${cli.problem}`)
    const version = checkClaudeVersion(cli.output)
    if (version.warning) notes.push(version.warning)
    notes.push(...await checkoutWarnings(o.projectDir))
    await recordStart({ projectDir: o.projectDir, roles: [o.role], mailboxes: [mailbox], claudeVersion: cli.output, check: version, warnings: notes, time: startTime })
  }
  for (const w of notes) console.warn(`WARNING: ${w}`)

  console.log(`project: ${o.projectDir} / Mailbox: ${mailbox}`)
  const s = spawnArgs(cmd, claudeArgs(o, ROOT, mcpConfig, filesDir))
  // The HTTP hooks expand Authorization from HUB_TOKEN and do not read .env, so pass it. HUB_MAILBOX goes into the hooks' X-Hub-Mailbox header
  const token = envSetting('HUB_TOKEN', '')
  const env = { ...process.env, HUB_ROLE: o.role, HUB_MAILBOX: mailbox, HUB_TOKEN: token }
  // The attach is watched only when `agent` is on its own with a token (C100). `before` is the Attachment held before claude starts,
  // so a new id is read as this start's attach
  const watch = !o.fromTeam && token !== ''
  const before = watch ? await attachmentOf(mailbox, token) : null
  const attachSec = o.attachTimeoutSec ?? 60
  // Ctrl+C belongs to claude. Without this, Node would exit and leave claude without its parent
  const ignore = () => {}
  process.on('SIGINT', ignore)
  const code = await new Promise<number>((done) => {
    const child = spawn(s.file, s.args, { cwd: o.projectDir, env, stdio: 'inherit', shell: s.shell })
    let stopWatch: (() => void) | undefined
    // Without a token the attach cannot be checked, so the role is started once claude is running (C88). With a token it is started
    // only once the attach is seen on the Hub (C100); a claude that ends first, or does not attach in time, is `failed`
    child.on('spawn', () => {
      if (o.fromTeam) return
      if (!watch) { record({ ...emptyOutcome(), started: [ref] }); return }
      stopWatch = watchAttach({
        attachmentOf: () => attachmentOf(mailbox, token),
        before,
        timeoutMs: attachSec * 1000,
        intervalMs: 1000,
        onAttached: () => {
          console.log(`${mailbox} attached`)
          record({ ...emptyOutcome(), started: [ref] })
        },
        onTimeout: () => {
          const reason = `${mailbox} did not attach within ${attachSec} seconds`
          console.error(reason)
          record({ ...emptyOutcome(), failed: [{ ...ref, reason }] })
        },
      })
    })
    child.on('error', (e) => {
      console.error(`cannot start claude: ${e.message}`)
      stopWatch?.()
      record({ ...emptyOutcome(), failed: [{ ...ref, reason: `cannot start claude: ${e.message}` }] })
      done(1)
    })
    child.on('exit', (c, signal) => {
      const exitCode = c ?? (signal ? 1 : 0)
      stopWatch?.()
      // Recorded only if nothing was yet (a started role, or a timeout, already is)
      record({ ...emptyOutcome(), failed: [{ ...ref, reason: `claude for ${mailbox} ended before attaching (exit code ${exitCode})` }] })
      done(exitCode)
    })
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
