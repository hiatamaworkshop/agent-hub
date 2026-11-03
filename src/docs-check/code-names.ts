// The names the docs check compares with protocol.md, read from the constants the runtime uses (C124).
// Nothing here is typed in by hand: the shim's tool list, the UI stream's names (UI_EVENT_NAMES, which Hub.emitUi takes) and the shim stream's names (app.ts)
// The one place names are read from source text: the literal first argument of each `emitUi(` call in src/hub (scanEmitters), since
// UI_EVENT_NAMES alone cannot show that a listed name still has an emitter (C124 review). A call with a non-literal name is reported, not guessed.
import { readdirSync, readFileSync } from 'node:fs'
import { SHIM_TOOLS } from '../shim/tools.js'
import { SHIM_STREAM_EVENTS, UI_EVENT_NAMES } from '../shared/types.js'
import type { CodeNames, UiEmitter } from './repo.js'

// The `emitUi(` calls in one file's text. The method's own declaration (`emitUi(event: UiEventName, ...)`) is not a call
export function scanEmitters(file: string, text: string): UiEmitter[] {
  const out: UiEmitter[] = []
  text.split(/\r?\n/).forEach((l, i) => {
    for (const m of l.matchAll(/\bemitUi\(\s*([^,)]*)/g)) {
      const arg = m[1]!.trim()
      if (/^\w+\s*:/.test(arg)) continue
      const lit = /^'([^']*)'$|^"([^"]*)"$/.exec(arg)
      out.push({ name: lit ? (lit[1] ?? lit[2])! : null, file, line: i + 1 })
    }
  })
  return out
}

// Every non-test source in src/hub (the Hub is the only sender of the UI stream)
function hubEmitters(): UiEmitter[] {
  const dir = new URL('../hub/', import.meta.url)
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort()
    .flatMap((f) => scanEmitters(`src/hub/${f}`, readFileSync(new URL(f, dir), 'utf8')))
}

export function codeNames(): CodeNames {
  return {
    mcpTools: SHIM_TOOLS.map((t) => t.name),
    uiEvents: UI_EVENT_NAMES,
    uiEmitters: hubEmitters(),
    shimEvents: Object.values(SHIM_STREAM_EVENTS),
  }
}
