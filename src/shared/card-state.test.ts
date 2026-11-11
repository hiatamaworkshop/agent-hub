import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BACKGROUND_MAX_MINUTES, EVENT_LABEL, NONE, STALE_HANDED_HOURS, absentTargets, addTally, eventDetailOf, humanTurnOf,
  outgoingTargets, runningOf, staleEvent, staleHandedHours, stateOf, summaryOf,
} from './card-state.js'
import type { CardContext } from './card-state.js'

// The cases come from the scenes of tools/dev/ui-check.mjs. Each test names the scene (in English) and the card text it
// expects. The derivation takes the clock as `now`, so the time boundaries are passed in directly.
const T0 = Date.parse('2026-11-10T10:00:00.000Z')
const at = (minutes: number) => new Date(T0 + minutes * 60000).toISOString()
const NOW = T0 + 10 * 60000 // ten minutes after T0

// A Mailbox as the Hub describes it. Attached by session s1 at minute -60, unless an attachment is given
function mb(backlog: Record<string, unknown> = {}, attachment: unknown = { id: 'a1', sessionId: 's1', attachedAt: at(-60) }) {
  return {
    name: 'demo.leader',
    attachment,
    backlog: {
      unread: { count: 0, oldestAt: null },
      awaitingReply: { count: 0, oldestAt: null },
      outgoing: { count: 0, oldestAt: null, to: [] },
      lastHanded: null,
      ...backlog,
    },
  }
}

// An Event of this Mailbox, from session s1 unless given
function ev(kind: string, ts: string, extra: Record<string, unknown> = {}) {
  return { id: `e_${kind}_${ts}`, kind, ts, sessionId: 's1', mailbox: 'demo.leader', ...extra }
}

function ctx(over: Partial<CardContext> = {}): CardContext {
  return {
    now: NOW,
    hubStartedAt: null,
    readRetentionHours: null,
    mailboxes: [],
    lastEvent: null,
    lastTurnEnd: null,
    messageOf: () => null,
    ...over,
  }
}

// A request to the person, as the Hub counts it in outgoing.to
const toPerson = { type: 'user', id: 'browser', count: 1, oldestAt: at(0), oldestSeq: 5 }

describe('stateOf: Offline and Idle', () => {
  it('Offline: no session is attached', () => {
    assert.deepEqual(stateOf(mb({}, null), ctx()), { key: 'offline' })
  })

  it('Idle: "both idle" and a turn that ended with nothing pending', () => {
    const end = ev('turn.end', at(0))
    assert.deepEqual(stateOf(mb(), ctx({ lastEvent: end, lastTurnEnd: end })), { key: 'idle', since: at(0) })
  })

  it('Idle with no turn end known: since is null', () => {
    assert.deepEqual(stateOf(mb(), ctx()), { key: 'idle', since: null })
  })

  it('a Hub that sends no backlog gives no state (null)', () => {
    assert.equal(stateOf({ name: 'x', attachment: { id: 'a' }, backlog: { unread: { count: 0 } } }, ctx()), null)
  })
})

describe('stateOf: Needs you', () => {
  it('Needs you (request): leader asked the person through the Hub and ended its turn (C40)', () => {
    const end = ev('turn.end', at(0))
    const m = mb({ outgoing: { count: 1, oldestAt: at(0), to: [toPerson] } })
    assert.deepEqual(stateOf(m, ctx({ lastEvent: end, lastTurnEnd: end })), { key: 'you', since: at(0), detail: 'request' })
  })

  it('Needs you (question): leader asked a question in its terminal', () => {
    const q = ev('question', at(-1))
    assert.deepEqual(stateOf(mb(), ctx({ lastEvent: q })), { key: 'you', since: at(-1), detail: 'question' })
  })

  it('Needs you (permission): deployer asked for permission', () => {
    const p = ev('permission', at(-1))
    assert.deepEqual(stateOf(mb(), ctx({ lastEvent: p })), { key: 'you', since: at(-1), detail: 'permission' })
  })

  it('Needs you clears once the permission is granted: the tool runs, so the hand-over reads as Working', () => {
    const approved = ev('permission.resolved', at(-1))
    const m = mb({ lastHanded: { ts: at(-1.5), seq: 3, open: true } })
    const got = stateOf(m, ctx({ lastEvent: approved, messageOf: () => ({ kind: 'request', from: { id: 'role:leader' }, body: 'GOAL: go on' }) }))
    assert.equal(got?.key, 'working')
  })

  it('Needs you (usage limit, press Enter): the automatic resume does not go on', () => {
    const n = ev('notification', at(-1), { payload: { notification_type: 'quota_auto_resume_stale' } })
    assert.deepEqual(stateOf(mb(), ctx({ lastEvent: n })), { key: 'you', since: at(-1), detail: 'usage limit, press Enter' })
  })

  it('Needs you (usage limit, auto-resume off): the automatic resume is disabled', () => {
    const n = ev('notification', at(-1), { detail: 'quota_auto_resume_disabled' })
    assert.deepEqual(stateOf(mb(), ctx({ lastEvent: n })), { key: 'you', since: at(-1), detail: 'usage limit, auto-resume off' })
  })

  it('Needs you (demo.reviewer not connected): leader waits on a reviewer that is not connected (C49)', () => {
    const m = mb({ outgoing: { count: 1, oldestAt: at(0), to: [{ type: 'role', id: 'reviewer', count: 1, oldestAt: at(0), recipients: ['demo.reviewer'] }] } })
    const mailboxes = [{ name: 'demo.reviewer', attachment: null }]
    assert.deepEqual(stateOf(m, ctx({ mailboxes, lastTurnEnd: ev('turn.end', at(0)) })), { key: 'you', since: at(0), detail: 'demo.reviewer not connected' })
  })

  it('Needs you (auditor not connected) while a test runs in the background: the C109 exception does not apply (C49)', () => {
    const end = ev('turn.end', at(0), { running: { count: 1, description: 'npm test' } })
    const m = mb({ outgoing: { count: 1, oldestAt: at(0), to: [{ type: 'role', id: 'auditor', count: 1, oldestAt: at(0), recipients: ['auditor'] }] }, awaitingReply: { count: 1, oldestAt: at(0) } })
    const mailboxes = [{ name: 'auditor', attachment: null }]
    assert.deepEqual(stateOf(m, ctx({ mailboxes, lastTurnEnd: end, lastEvent: end, now: T0 + 5 * 60000 })), { key: 'you', since: at(0), detail: 'auditor not connected' })
  })

  it('a question of an earlier attachment is not counted: another session attached (C41) → Idle', () => {
    const q = ev('question', at(-120), { sessionId: 's-old' })
    assert.deepEqual(stateOf(mb(), ctx({ lastEvent: q })), { key: 'idle', since: null })
  })

  it('a question after the attach counts even with another session_id (after /clear) → Needs you (question)', () => {
    const q = ev('question', at(-30), { sessionId: 's-lead-3' })
    const m = mb({}, { id: 'a1', sessionId: 's-lead', attachedAt: at(-60) })
    assert.deepEqual(stateOf(m, ctx({ lastEvent: q })), { key: 'you', since: at(-30), detail: 'question' })
  })
})

describe('stateOf: Paused', () => {
  it('Paused (usage limit): the stop is checked before Working, because the hand-over is kept after it', () => {
    const fail = ev('turn.failed', at(-1), { payload: { error: 'rate_limit' } })
    const m = mb({ lastHanded: { ts: at(-0.5), seq: 9, open: true } })
    assert.deepEqual(stateOf(m, ctx({ lastEvent: fail, messageOf: () => null })), { key: 'paused', since: at(-1), detail: 'usage limit' })
  })

  it('Paused is read from the Hub\'s lastEvent.detail when the Event has left the recent window', () => {
    const fail = ev('turn.failed', at(-1), { detail: 'rate_limit' })
    assert.equal(stateOf(mb(), ctx({ lastEvent: fail }))?.key, 'paused')
  })

  it('Working again after the automatic resume fired: Paused clears and the hand-over reads as Working', () => {
    const fired = ev('notification', at(-0.2), { payload: { notification_type: 'quota_auto_resume_fired' } })
    const m = mb({ lastHanded: { ts: at(-0.1), seq: 10, open: true } })
    assert.equal(stateOf(m, ctx({ lastEvent: fired, messageOf: () => null }))?.key, 'working')
  })
})

describe('stateOf: Working', () => {
  it('Working: a request was handed to deployer (unread, Working); the summary is the first line of the request', () => {
    const end = ev('turn.end', at(-5))
    const m = mb({ lastHanded: { ts: at(-1), seq: 7, open: true } })
    const message = { kind: 'request', from: { id: 'role:leader' }, body: '\nGOAL: C150 make the derivation testable\nSCOPE: ...' }
    const got = stateOf(m, ctx({ lastEvent: end, lastTurnEnd: end, messageOf: (seq) => (seq === 7 ? message : null) }))
    assert.deepEqual(got, { key: 'working', since: at(-1), guess: false, detail: 'GOAL: C150 make the derivation testable' })
  })

  it('Working as a guess: the session sent no Events, so its turn end is not known', () => {
    const m = mb({ lastHanded: { ts: at(-1), seq: 7, open: true } })
    assert.deepEqual(stateOf(m, ctx()), { key: 'working', since: at(-1), guess: true, detail: '' })
  })

  it('Working (quiet): unread messages alone are the agent\'s move, shown without the signal', () => {
    const m = mb({ unread: { count: 2, oldestAt: at(-2) } })
    assert.deepEqual(stateOf(m, ctx()), { key: 'working', since: at(-2), quiet: true })
  })

  it('Working in the background: a test was run in the background and the turn ended (C43), not Stopped', () => {
    const end = ev('turn.end', at(0), { running: { count: 1, description: 'npm test' } })
    const m = mb({ awaitingReply: { count: 1, oldestAt: at(-1) } })
    assert.deepEqual(stateOf(m, ctx({ lastTurnEnd: end, lastEvent: end, now: T0 + 5 * 60000 })), {
      key: 'working', since: at(0), until: T0 + BACKGROUND_MAX_MINUTES * 60000, detail: 'background: npm test',
    })
  })

  it('Working in the background, boundary: one millisecond before 60 minutes is still Working', () => {
    const end = ev('turn.end', at(0), { running: { count: 1, description: 'npm test' } })
    const m = mb({ awaitingReply: { count: 1, oldestAt: at(-1) } })
    assert.equal(stateOf(m, ctx({ lastTurnEnd: end, now: T0 + BACKGROUND_MAX_MINUTES * 60000 - 1 }))?.key, 'working')
  })

  it('Stopped after 61 minutes in the background: back to Stopped (C43)', () => {
    const end = ev('turn.end', at(0), { running: { count: 1, description: 'npm test' } })
    const m = mb({ awaitingReply: { count: 1, oldestAt: at(-1) } })
    assert.deepEqual(stateOf(m, ctx({ lastTurnEnd: end, lastEvent: end, now: T0 + 61 * 60000 })), { key: 'stopped', since: at(0), detail: undefined })
  })

  it('Working with two background tasks: the detail counts the others (+1)', () => {
    const end = ev('turn.end', at(0), { running: { count: 2, description: 'npm test' } })
    const m = mb({ awaitingReply: { count: 1, oldestAt: at(-1) } })
    assert.equal(stateOf(m, ctx({ lastTurnEnd: end, now: T0 + 5 * 60000 }))?.detail, 'background: npm test (+1)')
  })
})

describe('stateOf: Stopped and Waiting on others', () => {
  it('Stopped, no reply: the turn ended with a request unanswered', () => {
    const end = ev('turn.end', at(0))
    const m = mb({ lastHanded: { ts: at(-1), seq: 7, open: false }, awaitingReply: { count: 1, oldestAt: at(-1) } })
    assert.deepEqual(stateOf(m, ctx({ lastTurnEnd: end, lastEvent: end })), { key: 'stopped', since: at(0), detail: undefined })
  })

  it('Stopped (auditor not connected): a request unanswered and the auditor not connected (C109)', () => {
    const end = ev('turn.end', at(0))
    const m = mb({ outgoing: { count: 1, oldestAt: at(0), to: [{ type: 'role', id: 'auditor', count: 1, oldestAt: at(0), recipients: ['auditor'] }] }, awaitingReply: { count: 1, oldestAt: at(-1) } })
    const mailboxes = [{ name: 'auditor', attachment: null }]
    assert.deepEqual(stateOf(m, ctx({ mailboxes, lastTurnEnd: end, lastEvent: end })), { key: 'stopped', since: at(0), detail: 'auditor not connected' })
  })

  it('Waiting on others (deployer): leader handed to deployer and ended its turn', () => {
    const end = ev('turn.end', at(0))
    const m = mb({ lastHanded: { ts: at(-1), seq: 7, open: true }, outgoing: { count: 1, oldestAt: at(0), to: [{ type: 'role', id: 'deployer', count: 1, oldestAt: at(0), recipients: ['demo.deployer'] }] } })
    const mailboxes = [{ name: 'demo.deployer', attachment: { id: 'd' } }]
    assert.deepEqual(stateOf(m, ctx({ mailboxes, lastTurnEnd: end, lastEvent: end })), { key: 'delegated', since: at(0), detail: 'deployer' })
  })

  it('Waiting on others (reviewer) once the reviewer is connected: "reviewer attached"', () => {
    const end = ev('turn.end', at(0))
    const m = mb({ outgoing: { count: 1, oldestAt: at(0), to: [{ type: 'role', id: 'reviewer', count: 1, oldestAt: at(0), recipients: ['demo.reviewer'] }] } })
    const mailboxes = [{ name: 'demo.reviewer', attachment: { id: 'r' } }]
    assert.equal(stateOf(m, ctx({ mailboxes, lastTurnEnd: end }))?.key, 'delegated')
  })

  it('a hand-over from before this Hub started, with no reply and no turn end since: Stopped (C142)', () => {
    const m = mb({ lastHanded: { ts: at(-1), seq: 7, open: true } })
    assert.deepEqual(stateOf(m, ctx({ hubStartedAt: T0, messageOf: () => null })), { key: 'stopped', since: at(-1), detail: 'Hub restarted after the hand-over' })
  })
})

describe('staleHandedHours and the time window of a hand-over', () => {
  it('the window is 12 hours, or the read retention when that is shorter', () => {
    assert.equal(STALE_HANDED_HOURS, 12)
    assert.equal(staleHandedHours(null), 12)
    assert.equal(staleHandedHours(0), 12, '0 means kept')
    assert.equal(staleHandedHours(24), 12)
    assert.equal(staleHandedHours(6), 6)
    assert.equal(staleHandedHours(-1), 12)
  })

  it('a hand-over 8 hours old with no turn end (the ui-check stale fixture): Working with a 24-hour retention, Idle with 6', () => {
    const m = mb({ lastHanded: { ts: new Date(NOW - 8 * 3600000).toISOString(), seq: 1, open: true } })
    assert.equal(stateOf(m, ctx({ readRetentionHours: 24, messageOf: () => null }))?.key, 'working')
    assert.equal(stateOf(m, ctx({ readRetentionHours: 6, messageOf: () => null }))?.key, 'idle')
  })

  it('boundary: 11 hours 59 minutes is still Working, 12 hours is not', () => {
    const handedAt = (hours: number) => mb({ lastHanded: { ts: new Date(NOW - hours * 3600000).toISOString(), seq: 1, open: true } })
    assert.equal(stateOf(handedAt(12 - 1 / 60), ctx({ messageOf: () => null }))?.key, 'working')
    assert.equal(stateOf(handedAt(12), ctx({ messageOf: () => null }))?.key, 'idle')
  })
})

describe('humanTurnOf, tallies and helpers', () => {
  it('humanTurnOf counts the question and the request to the person, with the reasons', () => {
    const q = ev('question', at(-1))
    const m = mb({ outgoing: { count: 1, oldestAt: at(-2), to: [{ type: 'user', id: 'browser', count: 1, oldestAt: at(-2), oldestSeq: 4 }] } })
    const got = humanTurnOf(m, ctx({ lastEvent: q }))
    assert.equal(got.count, 2)
    assert.equal(got.oldestAt, at(-2), 'the oldest of the two is kept')
    assert.equal(got.oldestSeq, 4)
    assert.equal(got.detail, `${EVENT_LABEL.question}, request`)
  })

  it('addTally keeps the oldest place to jump to, and NONE is the identity', () => {
    const a = { count: 1, oldestAt: at(-5), oldestSeq: 2, eventId: 'x' }
    const b = { count: 2, oldestAt: at(-9), oldestSeq: 3, eventId: 'y' }
    assert.deepEqual(addTally(a, b), { count: 3, oldestAt: at(-9), oldestSeq: 3, eventId: 'y' })
    assert.deepEqual(addTally(a, NONE), { count: 1, oldestAt: at(-5), oldestSeq: 2, eventId: 'x' })
  })

  it('staleEvent: the same session is never stale; another session is stale only before the attach', () => {
    const attachment = { sessionId: 's1', attachedAt: at(-60) }
    assert.equal(staleEvent({ attachment }, ev('question', at(-120), { sessionId: 's1' })), false)
    assert.equal(staleEvent({ attachment }, ev('question', at(-120), { sessionId: 's0' })), true)
    assert.equal(staleEvent({ attachment }, ev('question', at(-30), { sessionId: 's0' })), false)
    assert.equal(staleEvent({ attachment: null }, ev('question', at(-120), { sessionId: 's0' })), false)
  })

  it('eventDetailOf reads the Hub\'s detail first, then the payload field of the kind', () => {
    assert.equal(eventDetailOf({ kind: 'turn.failed', detail: 'from-hub', payload: { error: 'x' } }), 'from-hub')
    assert.equal(eventDetailOf({ kind: 'turn.failed', payload: { error: 'rate_limit' } }), 'rate_limit')
    assert.equal(eventDetailOf({ kind: 'permission.resolved', payload: { tool_name: 'Bash' } }), 'Bash')
    assert.equal(eventDetailOf({ kind: 'question', payload: { error: 'not read for a question' } }), '')
  })

  it('runningOf takes the running background tasks from the payload when the Hub gives no running count', () => {
    const end = { payload: { background_tasks: [{ status: 'running', description: 'npm test' }, { status: 'done', description: 'lint' }] } }
    assert.deepEqual(runningOf(end), { count: 1, description: 'npm test' })
    assert.equal(runningOf({ payload: {} }), null)
    assert.equal(runningOf(null), null)
  })

  it('summaryOf: the first non-empty line of a request, or the kind and sender of another Message', () => {
    assert.equal(summaryOf({ kind: 'request', from: { id: 'x' }, body: '\n  \nGOAL: first\nlater' }), 'GOAL: first')
    assert.equal(summaryOf({ kind: 'notice', from: { id: 'hub' }, body: 'x' }), 'notice from hub')
    assert.equal(summaryOf(null), '')
  })

  it('absentTargets: the names of unconnected recipients, or null when one is connected, unknown, or not told', () => {
    const outgoing = { to: [{ type: 'role', id: 'reviewer', recipients: ['demo.reviewer'] }] }
    assert.equal(absentTargets(outgoing, [{ name: 'demo.reviewer', attachment: null }]), 'demo.reviewer')
    assert.equal(absentTargets(outgoing, [{ name: 'demo.reviewer', attachment: { id: 'r' } }]), null)
    assert.equal(absentTargets(outgoing, []), null, 'a recipient not in the list is not known to be absent')
    assert.equal(absentTargets({ to: [{ type: 'role', id: 'old' }] }, []), null, 'a Hub without recipients')
  })

  it('outgoingTargets: the distinct targets, without the person', () => {
    const outgoing = { to: [{ type: 'role', id: 'deployer' }, { type: 'user', id: 'browser' }, { type: 'role', id: 'deployer' }] }
    assert.equal(outgoingTargets(outgoing), 'deployer')
  })
})
