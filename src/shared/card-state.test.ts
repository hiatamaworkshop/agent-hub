import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BACKGROUND_MAX_MINUTES, EVENT_LABEL, NONE, STALE_HANDED_HOURS, absentTargets, addTally, eventDetailOf, humanTurnOf,
  lastSeenOf, needsOf, outgoingTargets, runningOf, sectionsOf, staleEvent, staleHandedHours, stateOf, summaryOf,
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

// C183: a session that sent no Events, and whose hand-over was answered, is Idle; an open request is still Working? (a guess)
describe('stateOf: a session with no Events (C183)', () => {
  it('Idle, not Working?: a handed Message that is not open, nothing unread and no Events', () => {
    const m = mb({ lastHanded: { ts: at(-1), seq: 7, open: false } })
    assert.deepEqual(stateOf(m, ctx()), { key: 'idle', since: null })
  })

  it('an open request still reads Working? (the guess), as before', () => {
    const m = mb({ lastHanded: { ts: at(-1), seq: 7, open: true } })
    assert.deepEqual(stateOf(m, ctx({ messageOf: () => null })), { key: 'working', since: at(-1), guess: true, detail: '' })
  })

  it('a Mailbox with Events keeps the window rule: a hand-over that is not open still reads Working, and it is not a guess', () => {
    const start = ev('session.start', at(-5))
    const m = mb({ lastHanded: { ts: at(-1), seq: 7, open: false } })
    assert.deepEqual(stateOf(m, ctx({ lastEvent: start })), { key: 'working', since: at(-1), guess: false, detail: '' })
  })

  it('with a turn end from hooks, a hand-over after it is Working, and one before it is Idle, whatever open says', () => {
    const end = ev('turn.end', at(-5))
    assert.equal(stateOf(mb({ lastHanded: { ts: at(-1), seq: 7, open: false } }), ctx({ lastEvent: end, lastTurnEnd: end })).key, 'working')
    assert.equal(stateOf(mb({ lastHanded: { ts: at(-9), seq: 7, open: false } }), ctx({ lastEvent: end, lastTurnEnd: end })).key, 'idle')
  })

  // The Mailbox's newest turn end is from an earlier Attachment (s0, minute -50). A client with no session_id attaches at minute -20
  // (no Events of its own), gets a request at -1 and replies. Its Events are none, so the earlier turn end must not hold it Working
  const oldEnd = ev('turn.end', at(-50), { sessionId: 's0' })
  const hookless = { id: 'a2', attachedAt: at(-20) }

  it('an earlier Attachment\'s turn end does not hold a session with no Events Working: answered, it is Idle', () => {
    const m = mb({ lastHanded: { ts: at(-1), seq: 7, open: false } }, hookless)
    assert.deepEqual(stateOf(m, ctx({ lastEvent: oldEnd, lastTurnEnd: oldEnd })), { key: 'idle', since: at(-50) })
  })

  it('the same Mailbox with the request still open reads Working? (the guess)', () => {
    const m = mb({ lastHanded: { ts: at(-1), seq: 7, open: true } }, hookless)
    assert.deepEqual(stateOf(m, ctx({ lastEvent: oldEnd, lastTurnEnd: oldEnd })), { key: 'working', since: at(-1), guess: true, detail: '' })
  })

  it('an older Hub that omits open: a fresh hand-over with no Events reads Working? (a missing flag is not an answer)', () => {
    const m = mb({ lastHanded: { ts: at(-1), seq: 7 } })
    assert.deepEqual(stateOf(m, ctx()), { key: 'working', since: at(-1), guess: true, detail: '' })
  })
})

// C183: a report to the person that asks for a decision or an action is Needs you, until the person writes to the Mailbox or the Mailbox
// sends a report without such a section. Its body is read by the page (messageOf); a body the page does not hold counts for nothing
describe('stateOf: Needs you from a report (C183)', () => {
  const report = (body: string) => ({ kind: 'reply', from: { type: 'mailbox', id: 'demo.leader' }, body })
  const withReport = (seq = 9, ts = at(-2)) => mb({ lastToUser: { seq, ts } })

  it('Needs you (decision): the report has a NEEDS DECISION section with content', () => {
    const got = stateOf(withReport(), ctx({ messageOf: () => report('RESULT: done\nNEEDS DECISION: pick A or B\nNOTES: -') }))
    assert.deepEqual(got, { key: 'you', since: at(-2), detail: 'decision' })
  })

  it('Needs you (action): NEEDS ACTION, and the Japanese heading 要操作 counts the same', () => {
    assert.deepEqual(stateOf(withReport(), ctx({ messageOf: () => report('NEEDS ACTION: run the migration') })), { key: 'you', since: at(-2), detail: 'action' })
    assert.deepEqual(stateOf(withReport(), ctx({ messageOf: () => report('要操作: 移行を流す') })), { key: 'you', since: at(-2), detail: 'action' })
    assert.deepEqual(stateOf(withReport(), ctx({ messageOf: () => report('要判断: A か B か') })), { key: 'you', since: at(-2), detail: 'decision' })
  })

  it('both sections with content give both details', () => {
    const got = stateOf(withReport(), ctx({ messageOf: () => report('NEEDS DECISION: A\nNEEDS ACTION: run it') }))
    assert.deepEqual(got, { key: 'you', since: at(-2), detail: 'decision, action' })
  })

  it('an empty mark does not count: NEEDS DECISION: -, none, なし, and a heading with no content', () => {
    for (const body of ['NEEDS DECISION: -', 'NEEDS DECISION: none', 'NEEDS DECISION: なし', 'NEEDS ACTION:', 'NEEDS DECISION: -\nNEEDS ACTION: none']) {
      assert.notEqual(stateOf(withReport(), ctx({ messageOf: () => report(body) })).key, 'you', body)
    }
  })

  it('a body without such a section is not Needs you, and nor is a section that is not a decision or an action', () => {
    assert.notEqual(stateOf(withReport(), ctx({ messageOf: () => report('just a status line') })).key, 'you')
    assert.notEqual(stateOf(withReport(), ctx({ messageOf: () => report('NOT VERIFIED: the browser check') })).key, 'you')
  })

  it('ends when the person writes to the Mailbox after the report', () => {
    const c = ctx({ messageOf: () => report('NEEDS DECISION: A'), personWroteAfter: (name, seq) => name === 'demo.leader' && seq === 9 })
    assert.notEqual(stateOf(withReport(), c).key, 'you')
  })

  it('a report that is not held yet counts for nothing; the page fetches it', () => {
    assert.notEqual(stateOf(withReport(), ctx({ messageOf: () => null })).key, 'you')
  })

  it('a Mailbox with no report to the person is unchanged', () => {
    assert.equal(stateOf(mb({}), ctx({ messageOf: () => report('NEEDS DECISION: A') })).key, 'idle')
  })

  // On a reload the page holds the report but not the person's later Messages until the history is read: nothing counts before that
  it('before the history is read (historyReady false) a report is not counted; once it is read it is', () => {
    const c = ctx({ messageOf: () => report('NEEDS DECISION: A') })
    assert.equal(stateOf(withReport(), { ...c, historyReady: false }).key, 'idle')
    assert.equal(stateOf(withReport(), { ...c, historyReady: true }).key, 'you')
    assert.equal(stateOf(withReport(), c).key, 'you') // absent means ready (the command's context)
  })
})

describe('needsOf and sectionsOf: the one heading rule (C183)', () => {
  it('needsOf lists the decision and action sections with content, in that order', () => {
    assert.deepEqual(needsOf('NEEDS ACTION: x\nNEEDS DECISION: y'), ['decide', 'op'])
    assert.deepEqual(needsOf('NEEDS DECISION: -\nNEEDS ACTION: none'), [])
    assert.deepEqual(needsOf('RESULT: ok'), [])
  })

  it('sectionsOf splits at the headings: kind, heading, empty, and the lines; a body without headings is one section', () => {
    const [head, decide, notes] = sectionsOf('intro\nNEEDS DECISION: A\nmore\nNOTES: -')
    assert.deepEqual([head!.kind, head!.heading, head!.empty], ['', false, false])
    assert.deepEqual([decide!.kind, decide!.heading, decide!.empty], ['decide', true, false])
    assert.deepEqual(decide!.lines[0], { pre: '', hd: 'NEEDS DECISION:', rest: ' A' })
    assert.equal(notes!.empty, true)
    const plain = sectionsOf('just text')
    assert.equal(plain.length, 1)
    assert.equal(plain[0]!.heading, false)
  })
})

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

  it('staleEvent: an Attachment with no session_id (C183) treats an older session\'s Event as an earlier Attachment\'s; an Event with no session_id is not', () => {
    const attachment = { attachedAt: at(-60) }
    assert.equal(staleEvent({ attachment }, ev('turn.end', at(-120), { sessionId: 's0' })), true)
    assert.equal(staleEvent({ attachment }, ev('turn.end', at(-30), { sessionId: 's0' })), false)
    assert.equal(staleEvent({ attachment }, { id: 'x', kind: 'turn.end', ts: at(-120) }), false)
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

// C182: Antigravity's Events (source antigravity, sessionId = its conversation). Its Stop is the turn end, so Working ends there
const agEvent = (kind: string, ts: string, extra: Record<string, unknown> = {}) => ({
  id: `ag_${kind}_${ts}`,
  kind,
  ts,
  source: 'antigravity',
  sessionId: 'conv-1',
  mailbox: 'demo.leader',
  ...extra,
})

describe('lastSeenOf: the model and effort on the card (C61, C182)', () => {
  it('Antigravity: modelName from session.start and turn.end, the newer one wins', () => {
    const events = [
      agEvent('session.start', at(-30), { payload: { modelName: 'gemini-a' } }),
      agEvent('turn.end', at(-5), { payload: { modelName: 'gemini-b', error: '' } }),
    ]
    assert.deepEqual(lastSeenOf(events, 'demo.leader'), { model: 'gemini-b', effort: null })
  })

  it('a turn end of Claude Code is not a model; the Claude session start keeps its model field; effort is read when valid', () => {
    const events = [
      ev('turn.end', at(-9), { payload: { modelName: 'not-for-claude' } }),
      ev('session.start', at(-8), { payload: { model: 'claude-opus-5', effort: { level: 'high' } } }),
      ev('model.switch', at(-7), { payload: { to_model: 'claude-sonnet-5-5', effort: { level: 'turbo' } } }),
    ]
    assert.deepEqual(lastSeenOf(events, 'demo.leader'), { model: 'claude-sonnet-5-5', effort: 'high' })
  })

  it('other Mailboxes and superseded Events do not count', () => {
    const events = [
      agEvent('turn.end', at(-1), { mailbox: 'other.deployer', payload: { modelName: 'gemini-x' } }),
      agEvent('turn.end', at(-2), { superseded: true, payload: { modelName: 'gemini-y' } }),
      agEvent('turn.end', at(-3), { payload: { modelName: 'gemini-z' } }),
    ]
    assert.deepEqual(lastSeenOf(events, 'demo.leader'), { model: 'gemini-z', effort: null })
    assert.deepEqual(lastSeenOf([], 'demo.leader'), { model: null, effort: null })
  })
})

describe('stateOf: an Antigravity session with Events ends Working at its turn end (C182)', () => {
  // attached as conversation conv-1 at minute -60; its Events carry the same session, so they are not stale
  const agMb = (backlog: Record<string, unknown>) => mb(backlog, { id: 'a3', sessionId: 'conv-1', attachedAt: at(-60) })
  const turnEnd = agEvent('turn.end', at(-5), { payload: { modelName: 'gemini-3.8-flash-low', error: '' } })

  it('a request answered before the turn end is Idle once the turn ends, not Working? (the turn end wins)', () => {
    const m = agMb({ lastHanded: { ts: at(-9), seq: 7, open: false } })
    assert.deepEqual(stateOf(m, ctx({ lastEvent: turnEnd, lastTurnEnd: turnEnd })), { key: 'idle', since: at(-5) })
  })

  it('a request handed after the turn end is Working, not a guess, because the session has Events', () => {
    const m = agMb({ lastHanded: { ts: at(-1), seq: 8, open: true } })
    assert.deepEqual(stateOf(m, ctx({ lastEvent: turnEnd, lastTurnEnd: turnEnd })), { key: 'working', since: at(-1), guess: false, detail: '' })
  })

  it('a reply sent during the turn (after the last turn end) reads Working until the turn\'s Stop arrives', () => {
    const m = agMb({ lastHanded: { ts: at(-1), seq: 8, open: false } })
    assert.deepEqual(stateOf(m, ctx({ lastEvent: turnEnd, lastTurnEnd: turnEnd })), { key: 'working', since: at(-1), guess: false, detail: '' })
  })
})
