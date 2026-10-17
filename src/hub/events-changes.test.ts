import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CHANGES_MAX_ITEMS, fromClaudeCodeHook } from './events.js'
import { Hub } from './hub.js'
import { Store } from './store.js'

// Stop の入力 (design.md §6.1b) に hook が足す欄を載せる
const stop = (extra: Record<string, unknown> = {}) => ({
  session_id: 's1',
  cwd: 'C:\\work\\agent-hub',
  hook_event_name: 'Stop',
  last_assistant_message: 'done',
  stop_hook_active: false,
  ...extra,
})
const good = { head: '0123456789abcdef0123456789abcdef01234567', changed: ['src/a.ts'], untracked: ['docs/new.md'] }

const now = new Date('2026-10-17T12:00:00Z')

describe('fromClaudeCodeHook: agent_hub_git (git の事実)', () => {
  it('形が合う事実は Event の changes に残る', () => {
    const r = fromClaudeCodeHook(stop({ agent_hub_git: good }), undefined, now)
    assert.ok('event' in r)
    assert.equal(r.event.kind, 'turn.end')
    assert.deepEqual(r.event.changes, good)
  })

  it('形が合わない事実は捨てるが、イベントは取り込む', () => {
    const bad: unknown[] = [
      'not an object',
      [good],
      { ...good, head: '' },
      { ...good, head: 'x'.repeat(65) },
      { ...good, changed: 'src/a.ts' },
      { ...good, untracked: [1] },
      { ...good, changed: [''] },
      { ...good, changed: ['x'.repeat(1001)] },
      { ...good, changed: Array.from({ length: CHANGES_MAX_ITEMS + 1 }, (_, i) => `f${i}`) },
      { changed: [], untracked: [] },
    ]
    for (const v of bad) {
      const r = fromClaudeCodeHook(stop({ agent_hub_git: v }), undefined, now)
      assert.ok('event' in r, `event should still be recorded for ${JSON.stringify(v)?.slice(0, 60)}`)
      assert.equal(r.event.kind, 'turn.end')
      assert.equal('changes' in r.event, false)
    }
  })

  it('欄がなければ従来どおり (changes を付けない)', () => {
    const r = fromClaudeCodeHook(stop(), undefined, now)
    assert.ok('event' in r)
    assert.equal('changes' in r.event, false)
  })

  it('上限ちょうどの件数は通す', () => {
    const edge = { ...good, changed: Array.from({ length: CHANGES_MAX_ITEMS }, (_, i) => `f${i}`) }
    const r = fromClaudeCodeHook(stop({ agent_hub_git: edge }), undefined, now)
    assert.ok('event' in r)
    assert.equal(r.event.changes?.changed.length, CHANGES_MAX_ITEMS)
  })
})

describe('Hub.addEvent: changes の保存', () => {
  function setup() {
    let t = Date.parse('2026-10-17T12:00:00Z')
    const now = () => new Date(t)
    return new Hub(new Store({ now }), { now })
  }

  it('有効な事実は Event の changes に載り、payload は入力のまま残る', () => {
    const hub = setup()
    const input = stop({ agent_hub_git: good })
    const r = hub.addEvent(input)
    assert.ok('id' in r)
    const [e] = hub.store.listEvents()
    assert.deepEqual(e!.changes, good)
    assert.deepEqual(e!.payload, input)
  })

  it('形が不正でもイベントは記録し、changes だけ落とす (payload は入力のまま)', () => {
    const hub = setup()
    const input = stop({ agent_hub_git: { head: 'abc', changed: 'oops', untracked: [] } })
    const r = hub.addEvent(input)
    assert.ok('id' in r)
    assert.equal(r.kind, 'turn.end')
    const [e] = hub.store.listEvents()
    assert.equal(e!.kind, 'turn.end')
    assert.equal('changes' in e!, false)
    assert.deepEqual(e!.payload, input)
  })

  it('欄のない古い hook の Event は changes を持たない', () => {
    const hub = setup()
    hub.addEvent(stop())
    const [e] = hub.store.listEvents()
    assert.equal('changes' in e!, false)
  })
})
