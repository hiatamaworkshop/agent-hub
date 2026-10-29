// Checks before starting (does claude run, the hook settings, how stale the checkout is) and the file the agent
// leaves when claude ends (roadmap C56-C58). Shared by `team` and `agent`.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { envSetting } from './env.js'
import { hookState, hookTemplate } from './hooks.js'
import { quoteForPlatform } from './quote.js'

// The file `agent` writes when claude ends. `team` deletes it before starting a role and reads it while waiting for attach (C56)
export function startStatusPath(mailbox: string): string {
  return join(tmpdir(), 'agent-hub-start', `${mailbox}.json`)
}

export interface Command {
  file: string
  // true: a .cmd on Windows, which Node can only start through cmd.exe
  viaCmd: boolean
}

// How to start claude. On Windows prefer claude.exe on PATH, then claude.cmd (an npm or nvm install)
export function claudeCommand(platform = process.platform, env: NodeJS.ProcessEnv = process.env): Command {
  if (platform !== 'win32') return { file: 'claude', viaCmd: false }
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)
  for (const name of ['claude.exe', 'claude.cmd']) {
    for (const d of dirs) {
      const p = join(d, name)
      if (existsSync(p)) return { file: p, viaCmd: name.endsWith('.cmd') }
    }
  }
  return { file: 'claude', viaCmd: false }
}

// spawn arguments for a Command. A .cmd goes through cmd.exe with the line quoted here (Node does not quote for shell: true)
export function spawnArgs(cmd: Command, args: string[]): { file: string; args: string[]; shell: boolean } {
  if (!cmd.viaCmd) return { file: cmd.file, args, shell: false }
  return { file: [cmd.file, ...args].map((a) => quoteForPlatform(a, 'win32')).join(' '), args: [], shell: true }
}

// Run `claude --version`. Returns null if it passes, else the head of its output.
// NVM blocking claude.cmd (NVM4306) shows up here too. The interactive claude's output is not redirected, so the reason is taken here
export function testClaudeCli(cmd = claudeCommand()): string | null {
  const s = spawnArgs(cmd, ['--version'])
  const r = spawnSync(s.file, s.args, { shell: s.shell, encoding: 'utf8', timeout: 30_000, windowsHide: true })
  if (r.error) return `cannot start claude: ${r.error.message}`
  if (r.status === 0) return null
  const lines = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 3)
  return lines.length ? lines.join(' / ') : `claude --version ended with exit code ${r.status}`
}

// The Hub's hook settings for a project, per event (C57, C69). Returns a warning, or null if every event is set.
// The fix offered is `hooks --write`, which adds only the missing events and never overwrites what is there
export function hookWarning(projectDir: string, root: string, home = homedir()): string | null {
  const st = hookState(projectDir, hookTemplate(root, envSetting('HUB_PORT', '7777', root)), home)
  const parts: string[] = []
  if (st.missing.length === st.events.length) parts.push(`No Hub hook settings found (${projectDir}). Question waits and turn ends will not show in the UI.`)
  else if (st.missing.length) parts.push(`Hub hooks missing for ${st.missing.join(', ')} (${projectDir}); the card cannot show what they carry.`)
  for (const f of st.unreadable) parts.push(`${f} is not valid JSON.`)
  for (const p of st.brokenScripts) parts.push(`A hook runs ${p}, which does not exist here.`)
  if (!parts.length) return null
  if (st.missing.length) parts.push(`To add them: npm run team -- hooks --project ${quoteForPlatform(projectDir, process.platform === 'win32' ? 'powershell' : 'posix')} --write`)
  return parts.join(' ')
}

interface GitResult { code: number; out: string; err: string; timedOut: boolean }

// Run git without prompting for anything. On a timeout, kill git together with its children (git-remote-https and so on)
export function runGit(dir: string, args: string[], timeoutSec = 10): Promise<GitResult> {
  return new Promise((done) => {
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }
    if (!env.GIT_SSH_COMMAND) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes'
    const posix = process.platform !== 'win32'
    let child
    try {
      child = spawn('git', ['-C', dir, ...args], { env, windowsHide: true, detached: posix, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      done({ code: -1, out: '', err: (e as Error).message, timedOut: false })
      return
    }
    let out = ''
    let err = ''
    let timedOut = false
    child.stdout.setEncoding('utf8').on('data', (d: string) => { out += d })
    child.stderr.setEncoding('utf8').on('data', (d: string) => { err += d })
    const timer = setTimeout(() => {
      timedOut = true
      if (!child.pid) return
      if (posix) { try { process.kill(-child.pid, 'SIGKILL') } catch { /* already gone */ } }
      else spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
    }, timeoutSec * 1000)
    child.on('error', (e) => { clearTimeout(timer); done({ code: -1, out: '', err: e.message, timedOut: false }) })
    child.on('close', (code) => {
      clearTimeout(timer)
      done({ code: timedOut ? -1 : (code ?? -1), out: out.trim(), err: err.trim(), timedOut })
    })
  })
}

// Warnings when the checkout is stale (empty if none or not a git repository). A failed or slow fetch is a warning; never stops (C58)
export async function checkoutWarnings(projectDir: string, fetchTimeoutSec = 15): Promise<string[]> {
  const warnings: string[] = []
  const inside = await runGit(projectDir, ['rev-parse', '--is-inside-work-tree'])
  if (inside.code !== 0 || inside.out !== 'true') return warnings
  const fetch = await runGit(projectDir, ['fetch', '--quiet'], fetchTimeoutSec)
  if (fetch.timedOut) {
    warnings.push(`git fetch did not finish in ${fetchTimeoutSec} seconds (${projectDir}). Comparing with origin uses the last fetch`)
  } else if (fetch.code !== 0) {
    const first = fetch.err.split(/\r?\n/).find((l) => l.trim()) ?? ''
    warnings.push(`git fetch failed (${projectDir}): ${first}. Comparing with origin uses the last fetch`)
  }
  const branch = (await runGit(projectDir, ['rev-parse', '--abbrev-ref', 'HEAD'])).out
  if (branch === 'HEAD') {
    const sha = (await runGit(projectDir, ['rev-parse', '--short', 'HEAD'])).out
    let msg = `Starting on a detached HEAD (${sha}) (${projectDir}). If it is a submodule, it may be an old version`
    const def = await runGit(projectDir, ['rev-parse', '--abbrev-ref', 'origin/HEAD'])
    if (def.code === 0 && def.out) {
      const behind = Number((await runGit(projectDir, ['rev-list', '--count', `HEAD..${def.out}`])).out)
      if (behind > 0) msg += `. ${behind} commits behind ${def.out}`
    }
    warnings.push(msg)
    return warnings
  }
  const up = await runGit(projectDir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  if (up.code !== 0 || !up.out) {
    warnings.push(`Branch ${branch} has no upstream (${projectDir}). Cannot compare with origin`)
    return warnings
  }
  const behind = Number((await runGit(projectDir, ['rev-list', '--count', 'HEAD..@{u}'])).out)
  if (behind > 0) warnings.push(`${branch} is ${behind} commits behind ${up.out} (${projectDir}). Pull before starting`)
  return warnings
}
