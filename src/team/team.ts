// `team`: start the Hub (if stopped) and several roles, one at a time, each in its own tab.
// Each role is started with `agent`, and the next starts only after this one attaches (or fails).
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { connect } from 'node:net'
import { basename, join } from 'node:path'
import { defaultMailboxName } from '../shared/types.js'
import { clearStartStatus } from './agent.js'
import { checkoutWarnings, hookWarning, startStatusPath, testClaudeCli } from './checks.js'
import { envSetting, hubRolesFile, readRoleNames, ROOT } from './env.js'
import { ask } from './prompt.js'
import { commandLine } from './quote.js'
import { openTab, TMUX_SESSION, type Opener } from './tabs.js'

export interface TeamOptions {
  roles: string[]
  projectDir: string
  attachTimeoutSec: number
  force: boolean
  noBuild: boolean
  permissionMode?: string
  opener: Opener
}

const MAIN = join(ROOT, 'src', 'team', 'main.ts')
// What a tab runs. tsx is resolved from the tab's folder, which is always the agent-hub root
const self = (...args: string[]) => [process.execPath, '--import', 'tsx', MAIN, ...args]
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// The subcommand a role's tab runs
export function agentSub(role: string, projectDir: string, permissionMode?: string): string[] {
  const sub = ['agent', '--role', role, '--project', projectDir, '--from-team']
  if (permissionMode) sub.push('--permission-mode', permissionMode)
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

export async function runTeam(o: TeamOptions): Promise<number> {
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

  // --- checks before starting. If claude does not run (blocked by NVM, an exe being replaced), start no role (C56)
  const cliError = testClaudeCli()
  if (cliError) {
    console.error(`WARNING: claude does not run, so no role is started: ${cliError}`)
    return 1
  }
  const notes: string[] = []
  const note = (w: string) => { console.warn(`WARNING: ${w}`); notes.push(w) }
  const hw = hookWarning(o.projectDir, ROOT)
  if (hw) note(hw)
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
  if (!token) console.warn('WARNING: no HUB_TOKEN, so attach cannot be checked. Starting without waiting')
  if (print) {
    console.log(`No way to open tabs here. Run each command below in a terminal of its own, in this order (waiting up to ${o.attachTimeoutSec} seconds for each to attach):`)
  } else if (o.opener === 'tmux' && !process.env.TMUX) {
    console.log(`Roles open in the tmux session "${TMUX_SESSION}". In another terminal: tmux attach -t ${TMUX_SESSION}`)
  }

  // --- roles, one at a time. The Mailbox name is <project folder>.<role>, as in `agent`
  const failed: string[] = []
  for (const role of roles) {
    const mailbox = defaultMailboxName(o.projectDir, role)
    const before = token ? await attachmentId(mailbox) : null
    if (before && !o.force) {
      console.log(`${mailbox} is connected, skipping (--force to restart it)`)
      continue
    }
    // With --force the previous Attachment lingers until its lease ends. Only a new id counts as attached (roadmap C33)
    if (!print) console.log(`Starting ${mailbox} (${o.projectDir})`)
    // Remove what the previous start left, so only this start's ending is read (C56)
    clearStartStatus(mailbox)
    const err = start(mailbox, agentSub(role, o.projectDir, o.permissionMode))
    if (err) { failed.push(`Could not open a tab for ${mailbox}: ${err}`); continue }
    if (!token) { await sleep(3000); continue }
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
    } else if (ended) {
      const why = ended.reason ? `. Reason: ${ended.reason}` : '. See its tab for the reason'
      const line = `claude for ${mailbox} ended before attaching (exit code ${ended.exitCode}, ${ended.elapsedSec} seconds)${why}`
      console.warn(`WARNING: ${line}. Moving on`)
      failed.push(line)
    } else {
      // The previous connection may just be lingering, so this is not read as success
      console.warn(`WARNING: ${mailbox} did not newly attach within ${o.attachTimeoutSec} seconds (failure). Check its tab (the first-run warning dialog, a claude startup error and so on). Moving on`)
      failed.push(`${mailbox} did not attach within ${o.attachTimeoutSec} seconds`)
    }
  }

  // --- summary: warnings and failures gathered here so they are not lost in the tabs (C56-C58), then the UI URL (C55)
  if (notes.length || failed.length) {
    console.log('\n--- summary ---')
    for (const n of notes) console.log(`note: ${n}`)
    for (const f of failed) console.log(`failed: ${f}`)
  }
  await printUiUrl(hubUrl, token)
  if (failed.length) return 1
  console.log('Done')
  return 0
}

// Print the UI's URL only when the token gets through to the Hub
async function printUiUrl(hubUrl: string, token: string): Promise<void> {
  if (!token) { console.log('No HUB_TOKEN, so the UI URL cannot be built (check .env)'); return }
  try {
    const r = await fetch(`${hubUrl}/mailboxes`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) })
    if (r.ok) { console.log(`UI: ${hubUrl}/?token=${token}`); return }
    if (r.status === 401) { console.warn('WARNING: HUB_TOKEN in .env does not match the Hub. The UI URL is in the Hub\'s log (with compose: docker compose logs hub)'); return }
    console.warn(`WARNING: the Hub answered ${r.status}, so the UI URL cannot be checked`)
  } catch {
    console.warn(`WARNING: cannot reach the Hub (${hubUrl}), so the UI URL cannot be checked`)
  }
}
