// A variable set in the shell that overrides agent-hub's `.env` (roadmap C119). Node's --env-file and the readers keep a variable that is
// already set, so `.env` is ignored for that name. This check reports only the NAMES among CHECKED_VARIABLES that are set in the
// environment and in `.env` with different values. It never returns or prints a value (a token above all).
// HUB_ROLE and HUB_MAILBOX are not checked: the team sets them on purpose in each role's environment (C119).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const CHECKED_VARIABLES = ['HUB_TOKEN', 'HUB_PORT', 'HUB_URL'] as const

// The values of a dotenv-style file: `NAME=value` lines, an optional `export `, `#` comment lines, quotes removed, and a trailing
// ` # comment` removed from an unquoted value. When a name appears twice the last line wins, as team/env.ts reads it
export function parseDotEnv(text: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (m) values.set(m[1]!, unquote(m[2]!.trim()))
  }
  return values
}

function unquote(raw: string): string {
  const q = raw[0]
  if (q === '"' || q === "'") {
    const end = raw.indexOf(q, 1)
    return end > 0 ? raw.slice(1, end) : raw.slice(1)
  }
  return raw.replace(/\s+#.*$/, '').trim()
}

// The names among CHECKED_VARIABLES that are set in `env` and in the `.env` text with different values. `dotEnvText` is undefined
// when there is no `.env`. An empty value counts as not set, as the readers treat it
export function overriddenNames(env: NodeJS.ProcessEnv, dotEnvText: string | undefined): string[] {
  if (dotEnvText === undefined) return []
  const file = parseDotEnv(dotEnvText)
  return CHECKED_VARIABLES.filter((name) => {
    const shell = env[name]?.trim()
    const dot = file.get(name)?.trim()
    return !!shell && !!dot && shell !== dot
  })
}

// The same for agent-hub's `.env` in `root`. An unreadable `.env` lists nothing (the readers report their own errors)
export function envOverrides(root: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const file = join(root, '.env')
  try {
    return overriddenNames(env, existsSync(file) ? readFileSync(file, 'utf8') : undefined)
  } catch {
    return []
  }
}

// The warning for one listed name: the environment's value is used, and how to unset it in this terminal. Names only, no value
export function overrideWarning(name: string): string {
  return `${name} is set in this terminal's environment and differs from agent-hub's .env. The environment's value is used, not .env's. To use .env's, unset it in this terminal (PowerShell: Remove-Item Env:${name}; bash: unset ${name})`
}

// Whether HUB_TOKEN comes from the environment (a non-empty value there is what the readers use, before .env)
export function tokenFromEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.HUB_TOKEN?.trim()
}

// The message for a token the Hub refused (401). When the token came from the environment, `.env` is not the value in use (C119)
export function refusedTokenMessage(fromEnvironment: boolean): string {
  if (fromEnvironment) {
    return "the Hub refused the token. HUB_TOKEN is set in this terminal's environment, and that value is used, not .env's. To use .env's, unset it in this terminal (PowerShell: Remove-Item Env:HUB_TOKEN; bash: unset HUB_TOKEN)"
  }
  return "the Hub refused the token (HUB_TOKEN in agent-hub's .env)"
}
