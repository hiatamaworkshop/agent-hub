// Command-line options of `npm run team` (roadmap C62)
import { parseArgs } from 'node:util'
import { OPENERS, type Opener } from './tabs.js'

export const USAGE = `Usage:
  npm run team -- [--roles leader,deployer] [--project <dir>] [--attach-timeout 60] [--force] [--no-build] [--no-hooks]
                  [--permission-mode <mode>] [--tabs ${OPENERS.join('|')}]
  npm run team -- agent --role <role> [--project <dir>] [--model <model>] [--mailbox <name>] [--permission-mode <mode>]
  npm run team -- hooks [--project <dir>] [--write]   (list the Hub hooks the project lacks; --write adds them)
  npm run team -- git-hook [--project <dir>] [--write]   (the post-commit hook that sends the ledger index; --write adds it)
  npm run team -- status [--project <dir>] [--item C<n>]   (the project's Mailboxes on the Hub, its latest report to the human, the items with a request in flight, and whether the ledger changed after its index was sent (C108, C139); --item prints that item's thread instead)
  npm run team -- reports --follow [--project <dir>] [--json] [--since <seq>]   (C135: prints the reports the project's Mailboxes send to the human as they arrive; read-only, opt-in; --json prints one Message per line; --since first prints the reports after that seq)`

export interface Parsed {
  command: 'team' | 'agent' | 'hub' | 'hooks' | 'git-hook' | 'status' | 'reports' | 'help'
  roles: string[]
  role?: string
  project?: string
  attachTimeoutSec: number
  force: boolean
  noBuild: boolean
  // C111: a team start writes the missing Hub hooks unless this is set (then it only warns)
  noHooks: boolean
  permissionMode?: string
  model?: string
  mailbox?: string
  fromTeam: boolean
  write: boolean
  tabs?: Opener
  // C139: status --item C<n> prints that item's thread
  item?: string
  // C135: reports --follow (the only mode), --json (one Message per line) and --since <seq>
  follow: boolean
  json: boolean
  since?: number
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
      'no-hooks': { type: 'boolean' },
      'permission-mode': { type: 'string' },
      model: { type: 'string' },
      mailbox: { type: 'string' },
      'from-team': { type: 'boolean' },
      write: { type: 'boolean' },
      tabs: { type: 'string' },
      item: { type: 'string' },
      follow: { type: 'boolean' },
      json: { type: 'boolean' },
      since: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  const sub = positionals[0] ?? 'team'
  if (positionals.length > 1 || !['team', 'agent', 'hub', 'hooks', 'git-hook', 'status', 'reports'].includes(sub)) throw new Error(`Unknown command: ${positionals.join(' ')}`)
  const timeout = values['attach-timeout'] === undefined ? 60 : Number(values['attach-timeout'])
  if (!Number.isInteger(timeout) || timeout <= 0) throw new Error(`--attach-timeout must be a positive whole number of seconds: ${values['attach-timeout']}`)
  const tabs = values.tabs
  if (tabs !== undefined && !(OPENERS as readonly string[]).includes(tabs)) throw new Error(`--tabs must be one of ${OPENERS.join(', ')}: ${tabs}`)
  if (sub === 'agent' && !values.role && !values.help) throw new Error('agent needs --role')
  if (values.item !== undefined && sub !== 'status') throw new Error('--item is only for status')
  if (values.item !== undefined && !/^C\d+$/.test(values.item)) throw new Error(`--item must be a roadmap item ID such as C139: ${values.item}`)
  const reportsOnly = values.follow || values.json || values.since !== undefined
  if (reportsOnly && sub !== 'reports') throw new Error('--follow, --json and --since are only for reports')
  if (sub === 'reports' && !values.follow && !values.help) throw new Error('reports needs --follow (it keeps reading the Hub; see usage.md)')
  const since = values.since === undefined ? undefined : Number(values.since)
  if (since !== undefined && (!Number.isInteger(since) || since < 0)) throw new Error(`--since must be a seq of 0 or more: ${values.since}`)
  return {
    command: values.help ? 'help' : (sub as Parsed['command']),
    roles: (values.roles ?? []).flatMap((r) => r.split(',')).map((r) => r.trim()).filter(Boolean),
    role: values.role,
    project: values.project,
    attachTimeoutSec: timeout,
    force: values.force ?? false,
    noBuild: values['no-build'] ?? false,
    noHooks: values['no-hooks'] ?? false,
    permissionMode: values['permission-mode'],
    model: values.model,
    mailbox: values.mailbox,
    fromTeam: values['from-team'] ?? false,
    write: values.write ?? false,
    tabs: tabs as Opener | undefined,
    item: values.item,
    follow: values.follow ?? false,
    json: values.json ?? false,
    since,
  }
}
