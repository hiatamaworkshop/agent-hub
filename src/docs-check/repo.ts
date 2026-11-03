// Checks of agent-hub's own documents (design.md §3.12, layer 1; roadmap C9). Deterministic, no AI.
// - map drift: CLAUDE.md's document map against the numbered headings of the files it lists
// - table drift: the Hub's routes and EVENT_KINDS / MESSAGE_KINDS against protocol.md §3 and §2
// - §9 dates: a Decision / Direction / Decided label in design.md §9 carries a date
// The functions take text so tests can feed small inputs; checkRepo reads the files of this repository.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EVENT_KINDS, MESSAGE_KINDS } from '../shared/types.js'

export interface DocProblem {
  file: string
  line: number
  level: 'error' | 'warning'
  message: string
}

export interface Route {
  method: string
  path: string
}

const MAP_FILE = 'CLAUDE.md'
const HEADING = /^(#{2,4}) (\d+(?:\.\d+[a-z]?)*)\.?\s/
const LINKED_FILE = /^- \[[^\]]+\]\(([^)]+)\)/
// A map entry is a § at the start of a nested bullet, or right after " / " in one
const MAP_REF = /(?:^\s+- |\s\/ )§(\d+(?:\.\d+[a-z]?)*)/g
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

// The lines of a `## ` section whose heading starts with `prefix` (to the next `## `), with their 1-based line numbers
function section(text: string, prefix: string): { line: number; text: string }[] {
  const lines = text.split(/\r?\n/)
  const out: { line: number; text: string }[] = []
  let inside = false
  lines.forEach((l, i) => {
    if (l.startsWith('## ')) inside = l.startsWith(prefix)
    else if (inside) out.push({ line: i + 1, text: l })
  })
  return out
}

function headingNumbers(text: string): { number: string; level: number; line: number }[] {
  const out: { number: string; level: number; line: number }[] = []
  let fenced = false
  text.split(/\r?\n/).forEach((l, i) => {
    if (l.startsWith('```')) fenced = !fenced
    const m = fenced ? null : HEADING.exec(l)
    if (m) out.push({ number: m[2]!, level: m[1]!.length, line: i + 1 })
  })
  return out
}

// One number covers another when either is the other or an ancestor of it (6 covers 6.1b; 3.2 covers 3)
function covers(listed: string, heading: string): boolean {
  const a = listed.split('.')
  const b = heading.split('.')
  const n = Math.min(a.length, b.length)
  return a.slice(0, n).join('.') === b.slice(0, n).join('.')
}

// The § entries of the map, per file they are listed under
export function parseMap(claudeMd: string): Map<string, { number: string; line: number }[]> {
  const refs = new Map<string, { number: string; line: number }[]>()
  let file: string | null = null
  for (const { line, text } of section(claudeMd, '## Document map')) {
    const linked = LINKED_FILE.exec(text)
    if (linked) {
      file = linked[1]!
      continue
    }
    if (!file || !/^\s+- /.test(text)) continue
    const list = refs.get(file) ?? []
    for (const m of text.matchAll(MAP_REF)) list.push({ number: m[1]!, line })
    if (list.length) refs.set(file, list)
  }
  return refs
}

// files: the text of each file the map lists § entries under, by the path written on the map
export function checkMap(claudeMd: string, files: Record<string, string | undefined>): DocProblem[] {
  const problems: DocProblem[] = []
  for (const [file, refs] of parseMap(claudeMd)) {
    const text = files[file]
    if (text === undefined) {
      problems.push({ file: MAP_FILE, line: refs[0]!.line, level: 'error', message: `the map lists sections of ${file}, which was not found` })
      continue
    }
    const headings = headingNumbers(text)
    const numbers = new Set(headings.map((h) => h.number))
    for (const r of refs) {
      if (!numbers.has(r.number)) problems.push({ file: MAP_FILE, line: r.line, level: 'error', message: `the map lists §${r.number} of ${file}, which has no such heading` })
    }
    for (const h of headings) {
      if (h.level > 3 || refs.some((r) => covers(r.number, h.number))) continue
      problems.push({ file, line: h.line, level: 'warning', message: `§${h.number} is not on the document map in ${MAP_FILE} (nor its parent or a child)` })
    }
  }
  return problems
}

// The rows of protocol.md §3's tables, as `METHOD path` (query strings dropped)
export function documentedRoutes(protocol: string): { route: string; line: number }[] {
  const out: { route: string; line: number }[] = []
  const row = new RegExp(`^\\| (${HTTP_METHODS.join('|')}) \\| \`([^\`?]+)`)
  for (const { line, text } of section(protocol, '## 3.')) {
    const m = row.exec(text)
    if (m) out.push({ route: `${m[1]} ${m[2]}`, line })
  }
  return out
}

export function checkRoutes(routes: readonly Route[], protocol: string): DocProblem[] {
  const file = 'docs/protocol.md'
  const actual = new Set(routes.filter((r) => HTTP_METHODS.includes(r.method)).map((r) => `${r.method} ${r.path}`))
  const documented = documentedRoutes(protocol)
  const listed = new Set(documented.map((d) => d.route))
  const problems: DocProblem[] = []
  for (const r of [...actual].sort()) {
    if (!listed.has(r)) problems.push({ file, line: section(protocol, '## 3.')[0]?.line ?? 1, level: 'error', message: `the Hub serves ${r}, which is not in the tables of §3` })
  }
  for (const d of documented) {
    if (!actual.has(d.route)) problems.push({ file, line: d.line, level: 'error', message: `§3 lists ${d.route}, which the Hub does not serve` })
  }
  return problems
}

// The `"kind": "a | b"` list in the JSON example under `### <name>` of protocol.md §2
function documentedKinds(protocol: string, name: string): { kinds: string[]; line: number } | null {
  let inside = false
  for (const { line, text } of section(protocol, '## 2.')) {
    if (text.startsWith('### ')) inside = text.startsWith(`### ${name}`)
    if (!inside) continue
    const m = /^\s*"kind": "([^"]+)"/.exec(text)
    if (m) return { kinds: m[1]!.split('|').map((k) => k.trim()), line }
  }
  return null
}

export function checkKinds(protocol: string, declared: { Event: readonly string[]; Message: readonly string[] } = { Event: EVENT_KINDS, Message: MESSAGE_KINDS }): DocProblem[] {
  const file = 'docs/protocol.md'
  const problems: DocProblem[] = []
  for (const [name, kinds] of Object.entries(declared)) {
    const constant = name === 'Event' ? 'EVENT_KINDS' : 'MESSAGE_KINDS'
    const doc = documentedKinds(protocol, name)
    if (!doc) {
      problems.push({ file, line: 1, level: 'error', message: `§2 has no "kind" list for ${name} to compare with ${constant}` })
      continue
    }
    const missing = kinds.filter((k) => !doc.kinds.includes(k))
    const extra = doc.kinds.filter((k) => !kinds.includes(k))
    if (missing.length || extra.length) {
      const parts = [missing.length ? `missing ${missing.join(', ')}` : '', extra.length ? `not in ${constant}: ${extra.join(', ')}` : ''].filter(Boolean)
      problems.push({ file, line: doc.line, level: 'error', message: `the ${name} kinds differ from ${constant} (${parts.join('; ')})` })
    }
  }
  return problems
}

// design.md §3.12 "How to write §9": a Decision (and a Direction) carries its date
export function checkDecisionDates(design: string): DocProblem[] {
  const problems: DocProblem[] = []
  for (const { line, text } of section(design, '## 9.')) {
    const label = /(?:\*\*|\()(Decision|Direction|Decided)\b/.exec(text)
    if (label && !/\d{4}-\d{2}-\d{2}/.test(text)) {
      problems.push({ file: 'docs/design.md', line, level: 'error', message: `"${label[1]}" in §9 has no date (YYYY-MM-DD) on its line` })
    }
  }
  return problems
}

// All the checks above on the repository at `root`. `routes` are the Hub's (see main.ts)
export function checkRepo(root: string, routes: readonly Route[]): DocProblem[] {
  const read = (p: string): string | undefined => {
    try {
      return readFileSync(join(root, p), 'utf8')
    } catch {
      return undefined
    }
  }
  const claudeMd = read(MAP_FILE) ?? ''
  const files = Object.fromEntries([...parseMap(claudeMd).keys()].map((f) => [f, read(f)]))
  const protocol = read('docs/protocol.md') ?? ''
  return [...checkMap(claudeMd, files), ...checkRoutes(routes, protocol), ...checkKinds(protocol), ...checkDecisionDates(read('docs/design.md') ?? '')]
}
