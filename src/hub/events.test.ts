import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import type { HubEvent } from '../shared/types.js'
import { createApp } from './app.js'
import { fromClaudeCodeHook } from './events.js'
import { Hub, type UiEvent } from './hub.js'
import { Store } from './store.js'

const TOKEN = 'test-token-0123456789'
const bearer = { authorization: `Bearer ${TOKEN}` }

// 実機の Stop の入力 (design.md §6.1c) に揃えた最小形
const stop = (session = 's1') => ({ session_id: session, cwd: 'C:\\work\\agent-hub', hook_event_name: 'Stop', last_assistant_message: 'done', stop_hook_active: false })
const ask = (hook: 'PreToolUse' | 'PostToolUse', session = 's1', toolUseId = 'tu1') => ({
  session_id: session,
  cwd: 'C:\\work\\agent-hub',
  hook_event_name: hook,
  tool_name: 'AskUserQuestion',
  tool_use_id: toolUseId,
  tool_input: { questions: [{ question: 'A or B?', header: 'Pick', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false }] },
})
const notif = (type: string, session = 's1') => ({ session_id: session, cwd: 'C:\\work\\agent-hub', hook_event_name: 'Notification', notification_type: type, message: 'Claude needs your permission' })

function clock(start = Date.parse('2026-10-16T12:00:00Z')) {
  let t = start
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) }
}

describe('fromClaudeCodeHook', () => {
  const now = new Date('2026-10-16T12:00:00Z')

  it('Stop → turn.end、AskUserQuestion の前後 → question / question.answered', () => {
    assert.deepEqual(fromClaudeCodeHook(stop(), undefined, now), { event: { source: 'claude-code', sessionId: 's1', cwd: 'C:\\work\\agent-hub', kind: 'turn.end' } })
    const q = fromClaudeCodeHook(ask('PreToolUse'), undefined, now)
    const a = fromClaudeCodeHook(ask('PostToolUse'), undefined, now)
    assert.ok('event' in q && 'event' in a)
    assert.equal(q.event.kind, 'question')
    assert.equal(a.event.kind, 'question.answered')
    // tool_use_id から決まる。kind が違えば別の id
    assert.match(q.event.id!, /^e_[0-9a-f]{32}$/)
    assert.notEqual(q.event.id, a.event.id)
  })

  it('AskUserQuestion 以外のツールと、知らない hook は取り込まない', () => {
    assert.deepEqual(fromClaudeCodeHook({ ...ask('PreToolUse'), tool_name: 'Bash' }, undefined, now), { ignored: 'unsupported_tool' })
    assert.deepEqual(fromClaudeCodeHook({ hook_event_name: 'SessionStart', session_id: 's1' }, undefined, now), { ignored: 'unsupported_hook' })
    assert.deepEqual(fromClaudeCodeHook({ session_id: 's1' }, undefined, now), { ignored: 'no_hook_event_name' })
  })

  it('permission_prompt は permission、ほかの Notification は notification', () => {
    const p = fromClaudeCodeHook(notif('permission_prompt'), undefined, now)
    const n = fromClaudeCodeHook(notif('agent_needs_input'), undefined, now)
    assert.ok('event' in p && 'event' in n)
    assert.equal(p.event.kind, 'permission')
    assert.equal(n.event.kind, 'notification')
    assert.equal(p.event.id, undefined)
  })

  it('回答前の質問の直後の permission_prompt は、質問の表示による重複として捨てる', () => {
    const q: HubEvent = { id: 'e_q', ts: '2026-10-16T11:59:54Z', kind: 'question', source: 'claude-code', sessionId: 's1', payload: {} }
    assert.deepEqual(fromClaudeCodeHook(notif('permission_prompt'), q, now), { ignored: 'question_prompt' })
    // 回答済み、または時間が離れていれば本物の許可待ち
    const answered = { ...q, kind: 'question.answered' as const }
    const old = { ...q, ts: '2026-10-16T11:58:00Z' }
    for (const prev of [answered, old]) {
      const r = fromClaudeCodeHook(notif('permission_prompt'), prev, now)
      assert.ok('event' in r)
      assert.equal(r.event.kind, 'permission')
    }
  })
})

describe('Hub.addEvent: 記録と Mailbox の解決', () => {
  function setup() {
    const c = clock()
    const hub = new Hub(new Store({ now: c.now }), { now: c.now })
    const ui: UiEvent[] = []
    hub.onUi((e) => ui.push(e))
    return { hub, ui, clock: c }
  }

  it('記録して UI に流し、payload は入力のまま残す', () => {
    const { hub, ui } = setup()
    const r = hub.addEvent(stop())
    assert.ok('id' in r)
    assert.equal(r.kind, 'turn.end')
    const [e] = hub.store.listEvents()
    assert.deepEqual(e!.payload, stop())
    assert.equal(e!.source, 'claude-code')
    assert.deepEqual(ui.filter((x) => x.event === 'event').map((x) => (x.data as HubEvent).id), [r.id])
  })

  it('同じ tool_use_id の hook が重ねて届いても 1 件', () => {
    const { hub, ui } = setup()
    const first = hub.addEvent(ask('PreToolUse'))
    const again = hub.addEvent(ask('PreToolUse'))
    assert.ok('id' in first && 'id' in again)
    assert.equal(again.id, first.id)
    assert.equal(again.duplicate, true)
    assert.equal(hub.store.listEvents().length, 1)
    assert.equal(ui.filter((x) => x.event === 'event').length, 1)
  })

  it('質問の表示による permission_prompt は記録しない', () => {
    const { hub, clock } = setup()
    hub.addEvent(ask('PreToolUse'))
    clock.advance(6000)
    assert.deepEqual(hub.addEvent(notif('permission_prompt')), { ignored: 'question_prompt' })
    hub.addEvent(ask('PostToolUse'))
    const r = hub.addEvent(notif('permission_prompt'))
    assert.ok('kind' in r)
    assert.equal(r.kind, 'permission')
  })

  it('sessionId は shim の attach の申告から解決し、Mailbox を切り替えたら追従する', () => {
    const { hub } = setup()
    hub.attach('leader', { client: 'claude-code', sessionId: 's1' })
    const r1 = hub.addEvent(stop())
    assert.ok('mailbox' in r1)
    assert.equal(r1.mailbox, 'leader')
    hub.attach('rev-a', { client: 'claude-code', sessionId: 's1' })
    const r2 = hub.addEvent(stop())
    assert.ok('mailbox' in r2)
    assert.equal(r2.mailbox, 'rev-a')
  })

  it('sessionId で引けなければ X-Hub-Mailbox、それもなければ既存の Mailbox に一致する cwd のフォルダ名', () => {
    const { hub } = setup()
    const viaHeader = hub.addEvent(stop('s2'), 'deployer')
    assert.ok('mailbox' in viaHeader)
    assert.equal(viaHeader.mailbox, 'deployer')
    // cwd のフォルダ名 (agent-hub) の Mailbox がなければ空のまま
    const none = hub.addEvent(stop('s3'))
    assert.ok('mailbox' in none)
    assert.equal(none.mailbox, null)
    hub.attach('agent-hub', { client: 'claude-code' })
    const viaCwd = hub.addEvent(stop('s4'))
    assert.ok('mailbox' in viaCwd)
    assert.equal(viaCwd.mailbox, 'agent-hub')
    // 不正なヘッダーは使わない
    const bad = hub.addEvent(stop('s5'), 'Bad Name')
    assert.ok('mailbox' in bad)
    assert.equal(bad.mailbox, 'agent-hub')
  })

  it('ヘッダーや cwd で解決した session は覚え、sessionId のない Attachment に記録する', () => {
    const { hub } = setup()
    const { attachmentId } = hub.attach('deployer', { client: 'claude-code' })
    hub.addEvent(stop('s6'), 'deployer')
    assert.equal(hub.attachments.get(attachmentId)!.sessionId, 's6')
    // ヘッダーがなくても、以後は sessionId で引ける
    const r = hub.addEvent(stop('s6'))
    assert.ok('mailbox' in r)
    assert.equal(r.mailbox, 'deployer')
  })

  it('takeover で切り離されたセッションの Event に superseded を付ける。同じセッションの attach し直しは付けない', () => {
    const { hub } = setup()
    hub.attach('reviewer', { client: 'claude-code', sessionId: 'sA' })
    hub.attach('reviewer', { client: 'claude-code', sessionId: 'sA' })
    hub.addEvent(stop('sA'))
    hub.attach('reviewer', { client: 'claude-code', sessionId: 'sB' })
    hub.addEvent(stop('sA'), 'reviewer')
    hub.addEvent(stop('sB'))
    const evs = hub.store.listEvents()
    assert.deepEqual(evs.map((e) => [e.sessionId, e.mailbox, e.superseded ?? false]), [
      ['sA', 'reviewer', false],
      ['sA', 'reviewer', true],
      ['sB', 'reviewer', false],
    ])
    // 切り離されたセッションが attach し直したら外す (今度は sB が切り離される)
    hub.attach('reviewer', { client: 'claude-code', sessionId: 'sA' })
    hub.addEvent(stop('sA'))
    assert.equal(hub.store.listEvents().at(-1)!.superseded, undefined)
    hub.addEvent(stop('sB'))
    assert.equal(hub.store.listEvents().at(-1)!.superseded, true)
  })

  it('Event は Mailbox の未読にならない (UI に出すだけ)', () => {
    const { hub } = setup()
    hub.attach('leader', { client: 'claude-code', sessionId: 's1' })
    hub.addEvent(stop())
    assert.equal(hub.store.unread('leader').length, 0)
  })

  it('ログから復元すると、直前の Event と id の重複除去も戻る', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-hub-events-'))
    try {
      const file = join(dir, 'hub.jsonl')
      const c = clock()
      new Hub(new Store({ file, now: c.now }), { now: c.now }).addEvent(ask('PreToolUse'))
      c.advance(6000)
      const restarted = new Hub(new Store({ file, now: c.now }), { now: c.now })
      const again = restarted.addEvent(ask('PreToolUse'))
      assert.ok('duplicate' in again)
      assert.equal(again.duplicate, true)
      assert.deepEqual(restarted.addEvent(notif('permission_prompt')), { ignored: 'question_prompt' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('HTTP /events', () => {
  function setup() {
    const hub = new Hub(new Store())
    const app = createApp({ hub, token: TOKEN, uiHtml: async () => null })
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      app.request('/events', { method: 'POST', headers: { 'content-type': 'application/json', ...bearer, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
    return { hub, app, post }
  }

  it('トークンなしは 401', async () => {
    const { app } = setup()
    assert.equal((await app.request('/events', { method: 'POST', body: '{}' })).status, 401)
    assert.equal((await app.request('/events')).status, 401)
  })

  it('hook の入力を受けて記録し、X-Hub-Mailbox で Mailbox を付ける', async () => {
    const { post, app } = setup()
    const res = await post(stop(), { 'x-hub-mailbox': 'leader' })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { kind: string; mailbox: string }
    assert.equal(body.kind, 'turn.end')
    assert.equal(body.mailbox, 'leader')
    const list = (await (await app.request('/events', { headers: bearer })).json()) as { events: HubEvent[] }
    assert.equal(list.events.length, 1)
    assert.equal(list.events[0]!.mailbox, 'leader')
  })

  it('取り込まない hook も 200 で理由を返す。オブジェクトでない本文は 400', async () => {
    const { post } = setup()
    const res = await post({ hook_event_name: 'SessionStart', session_id: 's1' })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ignored: 'unsupported_hook' })
    assert.equal((await post('[1]')).status, 400)
    assert.equal((await post('not json')).status, 400)
  })

  it('1 MB を超える本文は 413', async () => {
    const { post } = setup()
    const res = await post({ ...stop(), last_assistant_message: 'x'.repeat(1024 * 1024) })
    assert.equal(res.status, 413)
    assert.equal(((await res.json()) as { error: string }).error, 'payload_too_large')
  })

  it('/events/:source は source の変換で取り込み、変換のない source は 404', async () => {
    const { app } = setup()
    const postTo = (path: string, body: unknown) =>
      app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...bearer }, body: JSON.stringify(body) })
    const res = await postTo('/events/claude-code', stop())
    assert.equal(res.status, 200)
    assert.equal(((await res.json()) as { kind: string }).kind, 'turn.end')
    const list = (await (await app.request('/events', { headers: bearer })).json()) as { events: HubEvent[] }
    assert.equal(list.events[0]!.source, 'claude-code')
    for (const path of ['/events/codex', '/events/constructor']) {
      const bad = await postTo(path, stop())
      assert.equal(bad.status, 404)
      assert.equal(((await bad.json()) as { error: string }).error, 'unknown_source')
    }
  })

  it('limit の範囲外は 400', async () => {
    const { app } = setup()
    assert.equal((await app.request('/events?limit=0', { headers: bearer })).status, 400)
    assert.equal((await app.request('/events?limit=1001', { headers: bearer })).status, 400)
  })
})
