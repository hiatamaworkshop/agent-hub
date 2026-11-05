// `team`: start the Hub (if stopped) and several roles, one at a time, each in its own tab.
// Each role is started with `agent`, and the next starts only after this one attaches (or fails).
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { sendLedgerIndex } from '../docs-check/send-index.js'
import { readLedgerSetting } from '../shared/ledger.js'
import { envOverrides, overrideWarning, refusedTokenMessage, tokenFromEnvironment } from '../shared/env-override.js'
import { chooseMailboxName, defaultMailboxName, normalizeProjectPath } from '../shared/types.js'
import { clearStartStatus, interrupted, onStartSignals, readHubMailboxes, type HubMailbox } from './agent.js'
import { checkClaudeCli, checkoutWarnings, hookWarning, startStatusPath } from './checks.js'
import { envSetting, hubRolesFile, readRoleNames, ROOT } from './env.js'
import { writeMissingHooks } from './hooks.js'
import { statusCommand } from './status.js'
import { checkClaudeVersion, emptyOutcome, parseVersion, recordResult, recordStart, splitByConnection, type StartOutcome, versionWarnedBefore } from './startlog.js'
import { ask } from './prompt.js'
import { commandLine } from './quote.js'
import { openTab, TMUX_SESSION, type Opener } from './tabs.js'
import { startSummaryLines, usageDocPath } from './summary-lines.js'

export interface TeamOptions {
  roles: string[]
  projectDir: string
  attachTimeoutSec: number
  force: boolean
  noBuild: boolean
  // C111: do not write the missing Hub hooks at the start (warn only, as before)
  noHooks: boolean
  permissionMode?: string
  opener: Opener
}

// The Hub hooks at a team start (C111). Writes the missing ones with the one writer `hooks --write` uses, unless noHooks; a project whose
// hooks are set is not touched. Returns the summary lines (what was written) and the warnings (a failed write, or hook problems that remain)
export function hooksForStart(projectDir: string, root: string, noHooks: boolean, home = homedir()): { infos: string[]; warnings: string[] } {
  const infos: string[] = []
  const warnings: string[] = []
  if (!noHooks) {
    const w = writeMissingHooks(projectDir, root, home)
    if (w.kind === 'added') infos.push(`Hub hooks written to ${w.local}${w.backup ? ` (the previous file is ${w.backup})` : ''}`)
    if (w.kind === 'failed') warnings.push(`Could not write the Hub hooks: ${w.reason}. The start goes on without them`)
  }
  const hw = hookWarning(projectDir, root, home)
  if (hw) warnings.push(hw)
  return { infos, warnings }
}

// The start's index (C107): the project's ledger (.agent-hub.json, else docs/roadmap.md) sent to the Hub. Never throws, and returns
// the one line for the summary: what was sent, or why not (no file, Hub not reachable, token refused, an old Hub)
export async function sendStartIndex(projectDir: string, source: string, hubUrl: string, token: string): Promise<string> {
  try {
    const r = await sendLedgerIndex({ project: projectDir, source, hubUrl, token, tokenFromEnv: tokenFromEnvironment() })
    if (!r.sent) return `not sent: ${r.reason}`
    for (const w of r.warnings) console.warn(`WARNING: ${w}`)
    return `sent ${r.source} (${r.items} items) to ${hubUrl}`
  } catch (e) {
    return `not sent: ${e instanceof Error ? e.message : String(e)}`
  }
}

const MAIN = join(ROOT, 'src', 'team', 'main.ts')
// What a tab runs. tsx is resolved from the tab's folder, which is always the agent-hub root
const self = (...args: string[]) => [process.execPath, '--import', 'tsx', MAIN, ...args]
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// The Mailbox each role takes (C103): the default name, or another one when another project holds it. Called once the Hub is up.
// With a token, a list that cannot be read is an error, because the default name cannot be checked then. Without a token there is
// nothing to read, so the default names are used (attach is not checked either). `read` is the Hub's list (readHubMailboxes)
export async function chooseStartNames(
  roles: string[],
  projectDir: string,
  token: string,
  read: (token: string) => Promise<HubMailbox[] | null>,
  tokenFromEnv = false,
): Promise<Map<string, string>> {
  const list = await read(token)
  if (token && list === null) {
    // When the token came from the environment, the message says so rather than pointing at .env (C119)
    const check = tokenFromEnv
      ? 'Check that the Hub is up. HUB_TOKEN is set in this terminal\'s environment, and that value is used, not .env\'s (to use .env\'s, unset it in this terminal: PowerShell Remove-Item Env:HUB_TOKEN; bash unset HUB_TOKEN)'
      : 'Check that the Hub is up and HUB_TOKEN in .env'
    throw new Error(`The Hub's Mailbox list cannot be read, so no Mailbox name is chosen and nothing is started. ${check}`)
  }
  const known = list ?? []
  return new Map(roles.map((role) => [role, chooseMailboxName(projectDir, role, known)]))
}

// The subcommand a role's tab runs. The Mailbox name `team` chose is passed on, so the agent uses it as given (C103)
export function agentSub(role: string, projectDir: string, permissionMode?: string, mailbox?: string): string[] {
  const sub = ['agent', '--role', role, '--project', projectDir, '--from-team']
  if (permissionMode) sub.push('--permission-mode', permissionMode)
  if (mailbox) sub.push('--mailbox', mailbox)
  return sub
}

// Choose roles by number when none were named
export async function chooseRoles(): Promise<string[] | null> {
  let file = hubRolesFile()
  if (!existsSync(file)) file = join(ROOT, 'roles.example.json')
  const known = readRoleNames(file) ?? []
  if (known.length === 0) throw new Error(`No role list (${file}). Name roles with --roles`)
  console.log(`Choose roles to start (${basename(file)}):`)
  known.forEach((r, i) => console.log(`  ${i + 1}) ${r}`))
  const answer = (await ask('Numbers separated by commas (e.g. 1,2), all for every role, empty to cancel: ')).trim()
  if (!answer) return null
  if (answer === 'all') return known
  return answer.split(/[,\s]+/).filter(Boolean).map((n) => {
    const i = Number(n)
    if (!Number.isInteger(i) || i < 1 || i > known.length) throw new Error(`Number ${n} is out of range`)
    return known[i - 1]!
  })
}

function distIsStale(): boolean {
  const dist = join(ROOT, 'dist', 'shim', 'main.js')
  if (!existsSync(dist)) return true
  const built = statSync(dist).mtimeMs
  const walk = (dir: string): boolean => readdirSync(dir, { withFileTypes: true }).some((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return walk(p)
    return e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && statSync(p).mtimeMs > built
  })
  return walk(join(ROOT, 'src'))
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((done) => {
    const s = connect({ host: '127.0.0.1', port })
    const end = (ok: boolean) => { s.destroy(); done(ok) }
    s.setTimeout(500, () => end(false))
    s.once('connect', () => end(true))
    s.once('error', () => end(false))
  })
}

interface Mailbox { name: string; attachment?: { attachmentId: string } | null }

// A start always leaves its result line (C88), also when it stops early: the outcome is filled in as the start goes, and the finally writes it
// Ctrl+C or a closed terminal while `team` runs writes the line with what was recorded so far, then exits (C116)
export async function runTeam(o: TeamOptions): Promise<number> {
  const startTime = new Date().toISOString()
  const outcome = emptyOutcome()
  const offSignals = onStartSignals((signal) => recordResult(startTime, o.projectDir, interrupted(outcome, signal)))
  try {
    return await teamStart(o, startTime, outcome)
  } catch (e) {
    outcome.aborted = e instanceof Error ? e.message : String(e)
    throw e
  } finally {
    offSignals()
    recordResult(startTime, o.projectDir, outcome)
  }
}

// Where a role goes when there is no token and the attach cannot be checked (C100): the print opener opened nothing, so `printed`;
// a tab opener opened the tab, so `started` (a tab gets the opener's token, design.md §6.1y)
export function noTokenOutcome(opener: string): 'printed' | 'started' {
  return opener === 'print' ? 'printed' : 'started'
}

async function teamStart(o: TeamOptions, startTime: string, outcome: StartOutcome): Promise<number> {
  const port = Number(envSetting('HUB_PORT', '7777'))
  const token = envSetting('HUB_TOKEN', '')
  const hubUrl = `http://127.0.0.1:${port}`
  const auth = { Authorization: `Bearer ${token}` }
  const print = o.opener === 'print'

  const mailboxes = async (): Promise<Mailbox[] | null> => {
    try {
      const r = await fetch(`${hubUrl}/mailboxes`, { headers: auth, signal: AbortSignal.timeout(3000) })
      if (!r.ok) return null
      return ((await r.json()) as { mailboxes: Mailbox[] }).mailboxes
    } catch { return null }
  }
  const attachmentId = async (name: string) => (await mailboxes())?.find((m) => m.name === name)?.attachment?.attachmentId ?? null

  // Open a tab running a subcommand of this script, or with no way to open one, print it for the human (through npm, which is shorter to read)
  const start = (title: string, sub: string[]): string | null => {
    if (o.opener === 'print') {
      console.log(`  [${title}] ${commandLine(ROOT, ['npm', 'run', 'team', '--', ...sub])}`)
      return null
    }
    return openTab(o.opener, title, ROOT, self(...sub))
  }

  // --- roles: keep the order given, drop duplicates. A role missing from the Hub's roles file stops here (case-sensitive, like the Hub)
  const roles = [...new Set(o.roles)]
  const rolesFile = hubRolesFile()
  const known = readRoleNames(rolesFile)
  const unknown = known ? roles.filter((r) => !known.includes(r)) : []
  if (unknown.length) throw new Error(`Roles not in the roles file (${rolesFile}): ${unknown.join(', ')}`)

  // A variable set in this terminal that overrides agent-hub's .env (C119): one warning each, names only, printed before the checks
  // below so a start that stops early still shows it, and kept in the start record (notes)
  const notes: string[] = []
  for (const name of envOverrides(ROOT)) { const w = overrideWarning(name); console.warn(`WARNING: ${w}`); notes.push(w) }
  // The warnings reach the result line if the start stops before its pre-start line (see recordStart below)
  outcome.warnings = notes
  // --- checks before starting. If claude does not run (blocked by NVM, an exe being replaced), start no role (C56)
  const cli = checkClaudeCli()
  if (cli.problem) {
    console.error(`WARNING: claude does not run, so no role is started: ${cli.problem}`)
    outcome.aborted = `claude does not run, so no role is started: ${cli.problem}`
    return 1
  }
  const infos: string[] = []
  // A warning is printed as WARNING; a repeat is only a plain note in the summary. The start record keeps every note (C111)
  const note = (w: string, loud = true) => { if (loud) console.warn(`WARNING: ${w}`); notes.push(w) }
  const version = checkClaudeVersion(cli.output)
  if (version.warning) {
    // Read before this start's record is written, so this start is not counted as an earlier warning (C111)
    const running = parseVersion(cli.output)
    note(version.warning, !(running && versionWarnedBefore(running)))
  }
  // The Hub hooks: written as `hooks --write` would, unless --no-hooks (C111). The write's summary line is information, not a warning
  const hooks = hooksForStart(o.projectDir, ROOT, o.noHooks)
  infos.push(...hooks.infos)
  for (const w of hooks.warnings) note(w)
  for (const w of await checkoutWarnings(o.projectDir)) note(w)
  // --- build (the shim is started from dist/)
  if (!o.noBuild && distIsStale()) {
    console.log('dist/ is older than src/, building')
    const r = spawnSync('npm run build', { cwd: ROOT, stdio: 'inherit', shell: true })
    if (r.status !== 0) throw new Error('The build failed')
  }

  // --- Hub
  if (await portOpen(port)) {
    console.log(`The Hub is running (${hubUrl})`)
  } else {
    if (print) console.log('Start the Hub in a terminal of its own:')
    else console.log(`Starting the Hub (${hubUrl})`)
    const err = start('hub', ['hub'])
    if (err) throw new Error(`Could not open a tab for the Hub: ${err}`)
    // A human opening a terminal needs longer than a tab does
    const deadline = Date.now() + (print ? Math.max(o.attachTimeoutSec, 120) : 30) * 1000
    while (!(await portOpen(port))) {
      if (Date.now() > deadline) throw new Error('The Hub did not start in time. Check its tab')
      await sleep(500)
    }
    console.log('The Hub started')
  }
  // --- the index (C107). A failure is only the summary's line, so the start goes on
  const setting = readLedgerSetting(o.projectDir)
  if (setting.warning) note(setting.warning)
  const indexLine = await sendStartIndex(o.projectDir, setting.source, hubUrl, token)
  // The names are chosen only now, with the Hub up, so a Mailbox that exists on a Hub that was down is seen (C103).
  // A Hub list that cannot be read with a token stops the start here: the default name is not guessed
  const names = await chooseStartNames(roles, o.projectDir, token, readHubMailboxes, tokenFromEnvironment())
  const nameOf = (role: string) => names.get(role)!
  const connected = new Set<string>()
  if (token && !o.force) {
    for (const role of roles) if (await attachmentId(nameOf(role))) connected.add(role)
  }
  const toStart = splitByConnection(roles, connected, o.force).start
  // The start's warnings go to logs/ before the roles start, so they are kept even if a role fails (C85).
  // Only the roles that will start are listed: a connected Mailbox is skipped without --force, so it is left out here (C88)
  await recordStart({
    projectDir: o.projectDir,
    roles: toStart,
    mailboxes: toStart.map(nameOf),
    claudeVersion: cli.output,
    check: version,
    warnings: notes,
    time: startTime,
  })
  outcome.warnings = undefined // now in the pre-start line; the result line does not repeat them
  if (!token) console.warn('WARNING: no HUB_TOKEN, so attach cannot be checked. Starting without waiting')
  if (print) {
    console.log(`No way to open tabs here. Run each command below in a terminal of its own, in this order (waiting up to ${o.attachTimeoutSec} seconds for each to attach):`)
  } else if (o.opener === 'tmux' && !process.env.TMUX) {
    console.log(`Roles open in the tmux session "${TMUX_SESSION}". In another terminal: tmux attach -t ${TMUX_SESSION}`)
  }

  // --- roles, one at a time. The Mailbox name is <project folder>.<role>, as in `agent`
  for (const role of roles) {
    const mailbox = nameOf(role)
    const ref = { role, mailbox }
    const defaultName = defaultMailboxName(o.projectDir, role)
    console.log(`${role}: Mailbox ${mailbox}${mailbox === defaultName ? '' : ` (${defaultName} belongs to another project)`}`)
    const before = token ? await attachmentId(mailbox) : null
    if (before && !o.force) {
      console.log(`${mailbox} is connected, skipping (--force to restart it)`)
      outcome.skipped.push(ref)
      continue
    }
    // With --force the previous Attachment lingers until its lease ends. Only a new id counts as attached (roadmap C33)
    if (!print) console.log(`Starting ${mailbox} (${o.projectDir})`)
    // Remove what the previous start left, so only this start's ending is read (C56)
    clearStartStatus(mailbox)
    const err = start(mailbox, agentSub(role, o.projectDir, o.permissionMode, mailbox))
    if (err) { outcome.failed.push({ ...ref, reason: `Could not open a tab for ${mailbox}: ${err}` }); continue }
    // Without a token the attach is not checked. With the print opener nothing was opened, so the role is only printed (C100)
    if (!token) { outcome[noTokenOutcome(o.opener)].push(ref); await sleep(3000); continue }
    const deadline = Date.now() + o.attachTimeoutSec * 1000
    const statusFile = startStatusPath(mailbox)
    let attached = false
    let ended: { exitCode?: unknown; elapsedSec?: unknown; reason?: unknown } | null = null
    for (;;) {
      const now = await attachmentId(mailbox)
      if (now && now !== before) { attached = true; break }
      // claude ended before attaching: do not wait for the limit
      if (existsSync(statusFile)) {
        try { ended = JSON.parse(readFileSync(statusFile, 'utf8')) } catch { ended = { exitCode: '?', elapsedSec: '?' } }
        break
      }
      if (Date.now() > deadline) break
      await sleep(1000)
    }
    if (attached) {
      console.log(`${mailbox} attached`)
      outcome.started.push(ref)
    } else if (ended) {
      const why = ended.reason ? `. Reason: ${ended.reason}` : '. See its tab for the reason'
      const line = `claude for ${mailbox} ended before attaching (exit code ${ended.exitCode}, ${ended.elapsedSec} seconds)${why}`
      console.warn(`WARNING: ${line}. Moving on`)
      outcome.failed.push({ ...ref, reason: line })
    } else {
      // The previous connection may just be lingering, so this is not read as success
      console.warn(`WARNING: ${mailbox} did not newly attach within ${o.attachTimeoutSec} seconds (failure). Check its tab (the first-run warning dialog, a claude startup error and so on). Moving on`)
      outcome.failed.push({ ...ref, reason: `${mailbox} did not attach within ${o.attachTimeoutSec} seconds` })
    }
  }

  // --- summary: warnings and failures gathered here so they are not lost in the tabs (C56-C58), then the UI URL (C55)
  // The index line is always printed (C107), so a start that sent nothing says why
  console.log('\n--- summary ---')
  console.log(`index: ${indexLine}`)
  for (const i of infos) console.log(`hooks: ${i}`)
  console.log(`status: ${statusCommand(o.projectDir)} (the project's Mailboxes and latest report)`)
  for (const n of notes) console.log(`note: ${n}`)
  for (const f of outcome.failed) console.log(`failed: ${f.reason}`)
  // C132: the session that started the team is pointed at how requests and closes work. No reviewer connected at the end
  // (none in --roles and none attached or already connected) means the close waits for the user's word (C133)
  const reviewerConnected = roles.includes('reviewer')
    ? [...outcome.started, ...outcome.skipped].some((r) => r.role === 'reviewer')
    : Boolean(token && (await attachmentId(defaultMailboxName(o.projectDir, 'reviewer'))))
  for (const line of startSummaryLines(usageDocPath(), reviewerConnected)) console.log(line)
  await printUiUrl(hubUrl, token, o.projectDir, tokenFromEnvironment())
  if (outcome.failed.length) return 1
  console.log('Done')
  return 0
}

// The page's project value for a folder (normalizeProjectPath, the same as `projectKey` in public/index.html).
// It goes in the #fragment: the Hub redirects `/?token=` to `/` and drops the other query parameters, and a fragment is kept across the redirect (C72)
export function uiUrl(hubUrl: string, token: string, projectDir: string): string {
  return `${hubUrl}/?token=${token}#project=${encodeURIComponent(normalizeProjectPath(projectDir))}`
}

// Print the UI's URL only when the token gets through to the Hub

// tokenFromEnv: the token came from the environment, so the 401 message says so instead of blaming .env (C119)
export async function printUiUrl(hubUrl: string, token: string, projectDir: string, tokenFromEnv = false): Promise<void> {
  if (!token) { console.log('No HUB_TOKEN, so the UI URL cannot be built (check .env)'); return }
  try {
    const r = await fetch(`${hubUrl}/mailboxes`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) })
    if (r.ok) { console.log(`UI: ${uiUrl(hubUrl, token, projectDir)}`); return }
    if (r.status === 401) {
      if (tokenFromEnv) console.warn(`WARNING: ${refusedTokenMessage(true)}`)
      else console.warn('WARNING: HUB_TOKEN in .env does not match the Hub. The UI URL is in the Hub\'s log (with compose: docker compose logs hub)')
      return
    }
    console.warn(`WARNING: the Hub answered ${r.status}, so the UI URL cannot be checked`)
  } catch {
    console.warn(`WARNING: cannot reach the Hub (${hubUrl}), so the UI URL cannot be checked`)
  }
}
