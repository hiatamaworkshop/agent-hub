// Starting a team on any OS (roadmap C62, design.md §3.8). Run through `npm run team -- …`.
//   team   [--roles a,b] [--project <dir>] [--attach-timeout <sec>] [--force] [--no-build] [--permission-mode <m>] [--tabs <opener>]
//   agent  --role <r> [--project <dir>] [--model <m>] [--mailbox <name>] [--permission-mode <m>]
//   hub    (what the Hub's tab runs)
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { runAgent } from './agent.js'
import { ROOT } from './env.js'
import { waitForEnter } from './prompt.js'
import { parse, USAGE } from './options.js'
import { detectOpener, hasCommand } from './tabs.js'
import { chooseRoles, runTeam } from './team.js'

// The project root, where every role's claude starts (design.md §3.3). agent-hub if omitted
function projectDir(p: string | undefined): string {
  if (!p) return ROOT
  // npm runs scripts from the package root; INIT_CWD is the folder the command was typed in
  const dir = resolve(process.env.INIT_CWD ?? process.cwd(), p)
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`The project folder ${p} does not exist`)
  return dir
}

// The Hub's tab: npm run hub, kept open on failure so the error can be read
async function runHub(): Promise<number> {
  const code = await new Promise<number>((done) => {
    const child = spawn('npm run hub', { cwd: ROOT, stdio: 'inherit', shell: true })
    child.on('error', () => done(1))
    child.on('exit', (c) => done(c ?? 1))
  })
  if (code !== 0) await waitForEnter()
  return code
}

async function main(argv: string[]): Promise<number> {
  const p = parse(argv)
  if (p.command === 'help') { console.log(USAGE); return 0 }
  if (p.command === 'hub') return runHub()
  if (p.command === 'agent') {
    return runAgent({ role: p.role!, projectDir: projectDir(p.project), model: p.model, mailbox: p.mailbox, permissionMode: p.permissionMode, fromTeam: p.fromTeam })
  }
  const dir = projectDir(p.project)
  const roles = p.roles.length ? p.roles : await chooseRoles()
  if (!roles) { console.log('Cancelled'); return 0 }
  const opener = p.tabs ?? detectOpener(process.platform, process.env, (n) => hasCommand(n))
  return runTeam({ roles, projectDir: dir, attachTimeoutSec: p.attachTimeoutSec, force: p.force, noBuild: p.noBuild, permissionMode: p.permissionMode, opener })
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code },
  (e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); console.error(USAGE); process.exitCode = 1 },
)
