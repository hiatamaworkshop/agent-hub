// The Hub's hook settings for a project (roadmap C69): which hook events are missing, and adding only those.
// tools/hooks/settings.json is the template. Copied as is into another project, its SessionStart would point at that
// project's folder (${CLAUDE_PROJECT_DIR}), so the copy written here points at agent-hub's script by absolute path.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { envSetting } from './env.js'

type Groups = unknown[]
export interface Settings { hooks?: Record<string, Groups>; [k: string]: unknown }

const SCRIPT_IN_TEMPLATE = '${CLAUDE_PROJECT_DIR}/tools/hooks/post-event.mjs'

// The template with agent-hub's script path and the Hub's port filled in
export function hookTemplate(root: string, port: string): Settings {
  const script = `${root.replace(/\\/g, '/')}/tools/hooks/post-event.mjs`
  const text = readFileSync(join(root, 'tools', 'hooks', 'settings.json'), 'utf8')
    .split(SCRIPT_IN_TEMPLATE).join(script)
    .split('127.0.0.1:7777').join(`127.0.0.1:${port}`)
  return JSON.parse(text) as Settings
}

// A hook group is the Hub's if it posts to /events or /events/<source> (src/hub/app.ts), or runs post-event.mjs
// (settings.command.json's Stop counts too)
function isHubGroup(g: unknown): boolean {
  const s = JSON.stringify(g)
  return /\/events(\/[^"/]+)?"/.test(s) || s.includes('post-event.mjs')
}

export function hubEvents(s: Settings): Set<string> {
  const found = new Set<string>()
  for (const [ev, groups] of Object.entries(s.hooks ?? {})) {
    if (Array.isArray(groups) && groups.some(isHubGroup)) found.add(ev)
  }
  return found
}

// The three settings files claude reads for a project, in the order it reads them
export function settingsFiles(projectDir: string, home = homedir()): string[] {
  return [join(projectDir, '.claude', 'settings.local.json'), join(projectDir, '.claude', 'settings.json'), join(home, '.claude', 'settings.json')]
}

export interface HookState {
  events: string[]          // the template's events
  missing: string[]         // in none of the files
  unreadable: string[]      // files that exist but are not JSON
  brokenScripts: string[]   // post-event.mjs paths that do not exist (e.g. a template copied with ${CLAUDE_PROJECT_DIR})
}

export function hookState(projectDir: string, template: Settings, home = homedir()): HookState {
  const found = new Set<string>()
  const unreadable: string[] = []
  const broken = new Set<string>()
  for (const f of settingsFiles(projectDir, home)) {
    if (!existsSync(f)) continue
    let s: Settings
    try {
      s = JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, '')) as Settings
    } catch {
      unreadable.push(f)
      continue
    }
    for (const ev of hubEvents(s)) found.add(ev)
    for (const m of JSON.stringify(s.hooks ?? {}).matchAll(/"([^"]*post-event\.mjs)"/g)) {
      const p = m[1]!.replace(/\\\\/g, '\\').replace('${CLAUDE_PROJECT_DIR}', projectDir)
      if (!existsSync(p)) broken.add(m[1]!)
    }
  }
  const events = Object.keys(template.hooks ?? {})
  return { events, missing: events.filter((e) => !found.has(e)), unreadable, brokenScripts: [...broken] }
}

// Add the template's groups for the missing events; everything already there is kept as it is
export function mergeHooks(existing: Settings, template: Settings, missing: string[]): Settings {
  const hooks: Record<string, Groups> = { ...(existing.hooks ?? {}) }
  for (const ev of missing) hooks[ev] = [...(hooks[ev] ?? []), ...(template.hooks?.[ev] ?? [])]
  return { ...existing, hooks }
}

// `npm run team -- hooks [--project <dir>] [--write]`: print what is missing, and with --write add it to
// <project>/.claude/settings.local.json (a backup is left next to it when the file existed)
export function runHooks(projectDir: string, root: string, write: boolean, home = homedir()): number {
  const template = hookTemplate(root, envSetting('HUB_PORT', '7777', root))
  const st = hookState(projectDir, template, home)
  for (const f of st.unreadable) console.warn(`WARNING: ${f} is not valid JSON, so its hooks were not read`)
  for (const p of st.brokenScripts) console.warn(`WARNING: a hook runs ${p}, which does not exist here. Point it at ${root.replace(/\\/g, '/')}/tools/hooks/post-event.mjs by hand`)
  if (!st.missing.length) {
    console.log(`All Hub hooks are set for ${projectDir}`)
    return st.unreadable.length || st.brokenScripts.length ? 1 : 0
  }
  console.log(`Missing Hub hooks for ${projectDir}: ${st.missing.join(', ')}`)
  const local = settingsFiles(projectDir, home)[0]!
  if (!write) {
    console.log(`To add them to ${local}, run again with --write. The hooks to add:`)
    console.log(JSON.stringify({ hooks: mergeHooks({}, template, st.missing).hooks }, null, 2))
    return 1
  }
  let existing: Settings = {}
  const had = existsSync(local)
  if (had) {
    if (st.unreadable.includes(local)) { console.error(`Not writing: ${local} is not valid JSON`); return 1 }
    existing = JSON.parse(readFileSync(local, 'utf8').replace(/^﻿/, '')) as Settings
    copyFileSync(local, `${local}.bak`)
  }
  mkdirSync(join(projectDir, '.claude'), { recursive: true })
  writeFileSync(local, `${JSON.stringify(mergeHooks(existing, template, st.missing), null, 2)}\n`)
  console.log(`Added to ${local}${had ? ` (the previous file is ${local}.bak)` : ''}. Running sessions pick hooks up by themselves; SessionStart fires from the next start`)
  return 0
}
