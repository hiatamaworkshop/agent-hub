// Property-based tests of the card state derivation (C170; design.md §3.15 "Card states", §5 for the tool).
// card-state.test.ts checks scenes someone wrote down; these generate Mailboxes and contexts nobody wrote down and check
// rules that hold for every one of them.
//
// What is generated: the shapes the Hub has sent over time, not arbitrary JSON. A Mailbox has no backlog (a Hub before
// 2026-10-19), a backlog without outgoing / lastHanded (before 2026-10-22), or the current one, where each field added later
// may be missing: per-target counts (C40), recipients (C49), running (C43), seqs (C129), open (C142), the Hub's start time.
// Times are drawn from a few hours around one instant, so their order matters and collides; names from a small pool, so
// recipients meet the Mailbox list.
//
// Running and replaying (README / usage.md "Development"): FC_NUM_RUNS sets the number of cases per property (default 1000),
// FC_SEED fixes the seed. A failure prints the seed and the path of the shrunk case; run the same case again with FC_SEED
// and FC_PATH set, running only that test (--test-name-pattern; the path belongs to one property). A failure found here is
// kept as an example in card-state.test.ts once fixed.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fc from 'fast-check'
import { EVENT_KINDS, MESSAGE_KINDS } from './types.js'
import { WAITING, humanTurnOf, staleEvent, stateOf } from './card-state.js'
import type { CardContext } from './card-state.js'

const seed = process.env.FC_SEED ? Number(process.env.FC_SEED) : undefined
const path = process.env.FC_PATH || undefined
const numRuns = process.env.FC_NUM_RUNS ? Number(process.env.FC_NUM_RUNS) : 1000
const params = { numRuns, ...(seed === undefined ? {} : { seed }), ...(path === undefined ? {} : { path }) }

// The keys design.md §3.15 names: Offline, Needs you, Paused, Working, Waiting on others, Stopped, Idle
const KEYS = ['offline', 'you', 'paused', 'working', 'delegated', 'stopped', 'idle']

const T0 = Date.parse('2026-11-10T10:00:00.000Z')
const MIN = 60_000
// A time within ±16 hours of T0, in minutes (so the 12-hour window, the 60-minute background limit and the order all vary)
const minutes = fc.integer({ min: -16 * 60, max: 16 * 60 })
const iso = minutes.map((m) => new Date(T0 + m * MIN).toISOString())
const NAMES = ['demo.leader', 'demo.deployer', 'demo.reviewer', 'auditor']
const SESSIONS = ['s1', 's2', 's3']

// A field that an older Hub did not send: present with the value, or absent
function maybe<T>(key: string, arb: fc.Arbitrary<T>): fc.Arbitrary<Record<string, T>> {
  return fc.option(arb, { nil: undefined }).map((v) => (v === undefined ? {} : { [key]: v }))
}

// Counts lean to 0, so the states that need nothing pending (Idle, Stopped) come up often enough
const count = fc.oneof({ arbitrary: fc.constant(0), weight: 3 }, { arbitrary: fc.integer({ min: 1, max: 3 }), weight: 1 })
const tally = fc.record({ count, oldestAt: fc.option(iso, { nil: null }) })

const target = fc
  .tuple(
    fc.record({ type: fc.constantFrom('user', 'role', 'mailbox', 'topic'), id: fc.constantFrom('browser', 'deployer', 'reviewer', ...NAMES) }),
    maybe('count', fc.integer({ min: 1, max: 3 })),
    maybe('oldestAt', iso),
    maybe('oldestSeq', fc.integer({ min: 1, max: 50 })),
    maybe('recipients', fc.uniqueArray(fc.constantFrom(...NAMES), { maxLength: 3 })),
  )
  .map((parts) => Object.assign({}, ...parts))

const outgoing = fc
  .tuple(count, fc.option(iso, { nil: null }), fc.array(target, { maxLength: 3 }))
  .map(([count, oldestAt, to]) => ({ count, oldestAt, to }))

const lastHanded = fc.option(
  fc.tuple(fc.record({ ts: iso, seq: fc.integer({ min: 1, max: 50 }) }), maybe('open', fc.boolean())).map(([a, b]) => ({ ...a, ...b })),
  { nil: null },
)

const current = fc
  .tuple(fc.record({ unread: tally, awaitingReply: tally, outgoing, lastHanded }), maybe('awaitingSeqs', fc.constant(true)))
  .map(([b, s]) => (s.awaitingSeqs ? { ...b, awaitingReply: { ...b.awaitingReply, seqs: [] } } : b))
// The older shapes are rarer than the current one: most of the rules are about the current one
const backlog = fc.oneof(
  { arbitrary: fc.constant(undefined), weight: 1 }, // a Hub before the backlog
  { arbitrary: fc.record({ unread: tally, awaitingReply: tally }), weight: 1 }, // before outgoing and lastHanded
  { arbitrary: current, weight: 8 },
)

// Not attached (Offline) in about one case in ten: it is decided first, so the other rules need an attached Mailbox
const attachment = fc.option(
  fc.tuple(fc.record({ id: fc.constant('a1') }), maybe('sessionId', fc.constantFrom(...SESSIONS)), maybe('attachedAt', iso)).map((p) => Object.assign({}, ...p)),
  { nil: null, freq: 10 },
)

const mailbox = fc.record({ name: fc.constant('demo.leader'), attachment, backlog }).map((m) => (m.backlog === undefined ? { name: m.name, attachment: m.attachment } : m))

// An Event as the page holds it (from SSE: payload) or as the Hub sends it in the backlog (detail)
const payload = fc.oneof(
  fc.constant(undefined),
  fc.record({ error: fc.constantFrom('rate_limit', 'other') }),
  fc.record({ notification_type: fc.constantFrom('quota_auto_resume_stale', 'quota_auto_resume_disabled', 'quota_auto_resume_fired', 'idle_prompt') }),
  fc.record({ tool_name: fc.constantFrom('Bash', 'Edit') }),
)
const event = fc
  .tuple(
    fc.record({ id: fc.constant('e1'), kind: fc.constantFrom(...EVENT_KINDS), ts: iso }),
    maybe('sessionId', fc.constantFrom(...SESSIONS)),
    maybe('detail', fc.constantFrom('rate_limit', 'quota_auto_resume_stale', 'quota_auto_resume_disabled', 'Bash', '')),
    maybe('payload', payload),
  )
  .map((p) => Object.assign({}, ...p))

// A turn end: the Hub's running, or the payload's background_tasks (with entries of any shape a hook might send)
const task = fc.oneof(
  fc.record({ status: fc.constantFrom('running', 'done'), description: fc.option(fc.constantFrom('npm test', ''), { nil: undefined }) }),
  fc.constant(null),
  fc.constant('x'),
)
const turnEnd = fc
  .tuple(
    fc.record({ id: fc.constant('t1'), kind: fc.constant('turn.end'), ts: iso }),
    maybe('sessionId', fc.constantFrom(...SESSIONS)),
    maybe('running', fc.record({ count: fc.integer({ min: 1, max: 3 }), description: fc.constantFrom('npm test', '') })),
    maybe('payload', fc.record({ background_tasks: fc.oneof(fc.array(task, { maxLength: 3 }), fc.constant('not a list')) })),
  )
  .map((p) => Object.assign({}, ...p))

const message = fc.option(
  fc.tuple(fc.record({ kind: fc.constantFrom(...MESSAGE_KINDS), from: fc.record({ id: fc.constantFrom('role:leader', 'user:browser') }) }), maybe('body', fc.constantFrom('', '\n  \nGOAL: x', 'line'))).map(
    (p) => Object.assign({}, ...p),
  ),
  { nil: null },
)

const others = fc.array(
  fc.record({ name: fc.constantFrom(...NAMES), attachment: fc.option(fc.record({ id: fc.constant('b') }), { nil: null }) }),
  { maxLength: 4 },
)

const context = fc
  .record({
    now: minutes.map((m) => T0 + m * MIN),
    hubStartedAt: fc.option(minutes.map((m) => T0 + m * MIN), { nil: null }),
    readRetentionHours: fc.option(fc.constantFrom(0, 6, 24, -1), { nil: null }),
    mailboxes: others,
    lastEvent: fc.option(event, { nil: null }),
    lastTurnEnd: fc.option(turnEnd, { nil: null }),
    message,
  })
  .map(({ message: m, ...rest }): CardContext => ({ ...rest, messageOf: () => m }))

describe('card state derivation: properties (C170)', () => {
  it('stateOf and humanTurnOf never throw, and stateOf gives null or a key of design.md §3.15', () => {
    fc.assert(
      fc.property(mailbox, context, (mb, ctx) => {
        const s = stateOf(mb, ctx)
        assert.ok(s === null || KEYS.includes(s.key), `unknown key ${JSON.stringify(s)}`)
        const h = humanTurnOf(mb, ctx)
        assert.ok(Number.isInteger(h.count) && h.count >= 0, `count ${h.count}`)
      }),
      params,
    )
  })

  it('an unanswered question or permission of the current Attachment is always Needs you, whatever else the Mailbox holds', () => {
    // The Event is the newest one (so not answered) and belongs to the current Attachment: same session, or after the attach
    const current = fc
      .tuple(mailbox, context, fc.constantFrom(...WAITING), fc.boolean())
      .filter(([mb]) => mb.attachment !== null)
      .map(([mb, ctx, kind, sameSession]) => {
        const at = mb.attachment as { sessionId?: string; attachedAt?: string }
        const ts = at.attachedAt ? new Date(Date.parse(at.attachedAt) + MIN).toISOString() : new Date(T0).toISOString()
        const ev = { id: 'q', kind, ts, ...(sameSession && at.sessionId ? { sessionId: at.sessionId } : { sessionId: 'other' }) }
        return [mb, { ...ctx, lastEvent: ev }] as const
      })
    fc.assert(
      fc.property(current, ([mb, ctx]) => {
        assert.equal(staleEvent(mb, ctx.lastEvent), false)
        assert.equal(stateOf(mb, ctx)?.key, 'you')
        assert.ok(humanTurnOf(mb, ctx).count >= 1)
      }),
      params,
    )
  })

  it('an Event of an earlier Attachment (staleEvent) is never counted as waiting', () => {
    fc.assert(
      fc.property(mailbox, context, (mb, ctx) => {
        fc.pre(ctx.lastEvent !== null && staleEvent(mb, ctx.lastEvent))
        const without = { ...ctx, lastEvent: null }
        assert.deepEqual(humanTurnOf(mb, ctx), humanTurnOf(mb, without))
        assert.equal(stateOf(mb, ctx)?.key, stateOf(mb, without)?.key)
      }),
      params,
    )
  })
})

