// Command-line options of `npm run team` (roadmap C62)
import { parseArgs } from 'node:util'
import { OPENERS, type Opener } from './tabs.js'

export const USAGE = `Usage:
  npm run team -- [--roles leader,deployer] [--project <dir>] [--attach-timeout 60] [--force] [--no-build]
                  [--permission-mode <mode>] [--tabs ${OPENERS.join('|')}]
  npm run team -- agent --role <role> [--project <dir>] [--model <model>] [--mailbox <name>] [--permission-mode <mode>]`

export interface Parsed {
  command: 'team' | 'agent' | 'hub' | 'help'
  roles: string[]
  role?: string
  project?: string
  attachTimeoutSec: number
  force: boolean
  noBuild: boolean
  permissionMode?: string
  model?: string
  mailbox?: string
  fromTeam: boolean
  tabs?: Opener
}

export function parse(argv: string[]): Parsed {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      roles: { type: 'string', multiple: true },
      role: { type: 'string' },
      project: { type: 'string' },
      'attach-timeout': { type: 'string' },
      force: { type: 'boolean' },
      'no-build': { type: 'boolean' },
      'permission-mode': { type: 'string' },
      model: { type: 'string' },
      mailbox: { type: 'string' },
      'from-team': { type: 'boolean' },
      tabs: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  const sub = positionals[0] ?? 'team'
  if (positionals.length > 1 || !['team', 'agent', 'hub'].includes(sub)) throw new Error(`Unknown command: ${positionals.join(' ')}`)
  const timeout = values['attach-timeout'] === undefined ? 60 : Number(values['attach-timeout'])
  if (!Number.isInteger(timeout) || timeout <= 0) throw new Error(`--attach-timeout must be a positive whole number of seconds: ${values['attach-timeout']}`)
  const tabs = values.tabs
  if (tabs !== undefined && !(OPENERS as readonly string[]).includes(tabs)) throw new Error(`--tabs must be one of ${OPENERS.join(', ')}: ${tabs}`)
  if (sub === 'agent' && !values.role && !values.help) throw new Error('agent needs --role')
  return {
    command: values.help ? 'help' : (sub as Parsed['command']),
    roles: (values.roles ?? []).flatMap((r) => r.split(',')).map((r) => r.trim()).filter(Boolean),
    role: values.role,
    project: values.project,
    attachTimeoutSec: timeout,
    force: values.force ?? false,
    noBuild: values['no-build'] ?? false,
    permissionMode: values['permission-mode'],
    model: values.model,
    mailbox: values.mailbox,
    fromTeam: values['from-team'] ?? false,
    tabs: tabs as Opener | undefined,
  }
}
