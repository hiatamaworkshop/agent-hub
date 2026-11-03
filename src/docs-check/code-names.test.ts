import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { scanEmitters } from './code-names.js'

describe('scanEmitters (C124 review)', () => {
  it('reads the literal name of each emitUi call, and skips the method declaration', () => {
    const text = [
      '  emitUi(event: UiEventName, data: unknown): void {',
      '    for (const fn of this.uiListeners) fn({ event, data })',
      '  }',
      "  this.emitUi('message', m)",
      '    if (x) this.emitUi("event.deleted", { ids })',
      '    this.emitUi(kind, data)',
    ].join('\n')
    assert.deepEqual(scanEmitters('src/hub/hub.ts', text), [
      { name: 'message', file: 'src/hub/hub.ts', line: 4 },
      { name: 'event.deleted', file: 'src/hub/hub.ts', line: 5 },
      { name: null, file: 'src/hub/hub.ts', line: 6 },
    ])
  })

  it('reports a call with no name on its line as not a literal', () => {
    assert.deepEqual(scanEmitters('src/hub/app.ts', "hub.emitUi(\n  'index.updated', x)"), [{ name: null, file: 'src/hub/app.ts', line: 1 }])
  })
})
