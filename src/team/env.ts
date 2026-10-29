// Settings for starting a team: the agent-hub root, values from .env (environment variables win), and the roles file.
// Reading .env here instead of with --env-file keeps the other .env values out of the claude processes we start.
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

// One value: the environment variable, else the last `NAME=value` line of .env, else the default
export function envSetting(name: string, fallback: string, root = ROOT, env: NodeJS.ProcessEnv = process.env): string {
  const v = env[name]
  if (v && v.trim()) return v.trim()
  const file = join(root, '.env')
  if (existsSync(file)) {
    const re = new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`)
    let found: string | undefined
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = re.exec(line)
      if (m) found = m[1]!.trim().replace(/^["']|["']$/g, '')
    }
    if (found) return found
  }
  return fallback
}

// The roles file the Hub reads: HUB_ROLES_FILE (environment, then .env), else <root>/roles.json. Relative paths are from the root
export function hubRolesFile(root = ROOT, env: NodeJS.ProcessEnv = process.env): string {
  const f = envSetting('HUB_ROLES_FILE', '', root, env)
  if (!f) return join(root, 'roles.json')
  return isAbsolute(f) ? f : join(root, f)
}

// Role names in a roles file (null if the file does not exist)
export function readRoleNames(file: string): string[] | null {
  if (!existsSync(file)) return null
  const json = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) as Record<string, unknown>
  return Object.keys(json)
}
