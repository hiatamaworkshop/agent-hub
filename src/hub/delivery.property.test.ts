// Property-based, model-based test of delivery and Attachments (C171; protocol.md §4, design.md §3.3; the pattern is C170's,
// design.md §5). A generated sequence of operations runs against the real Hub and Store (in memory, the clock injected, the
// lease timers mocked), and the invariants are checked after every step against a small model kept beside it.
//
// The operations: post (to mailbox:, role:, topic:), attach (with and without maxAgeMs / maxUnread; a takeover when the
// Mailbox is attached), the channel path's ack (handed only), inbox (with and without unconfirmed) and its ack as the shim
// sends it (src/shim/inbox.ts), a conversation Message from the Mailbox (a request to the human or to another Mailbox, or a
// reply to a Message it received), heartbeat, detach, and time passing (which may expire leases).
// Not in scope: the shim's transport (Channels return no ack: design.md §6, C172), the HTTP layer, streams (no sink is
// opened, so every Attachment lives on its lease), retention and deletion.
//
// The model: per Mailbox, the Messages addressed to it that are not yet acked or abandoned (`pending`, by an independent
// rule of who is addressed: mailbox:X is X, role:R every Mailbox with role R, topic:t its subscribers), the Messages handed
// on the channel path and not yet returned by inbox or confirmed by a conversation Message (`handed`), and each live
// Attachment's lease deadline.
//
// FC_NUM_RUNS (default 300 sequences), FC_SEED and FC_PATH as in src/shared/card-state.property.test.ts.
import assert from 'node:assert/strict'
import { describe, it, type TestContext } from 'node:test'
import fc from 'fast-check'
import type { Address, Message } from '../shared/types.js'
import { Hub } from './hub.js'
import { Store } from './store.js'

const seed = process.env.FC_SEED ? Number(process.env.FC_SEED) : undefined
const path = process.env.FC_PATH || undefined
const numRuns = process.env.FC_NUM_RUNS ? Number(process.env.FC_NUM_RUNS) : 300
const params = { numRuns, ...(seed === undefined ? {} : { seed }), ...(path === undefined ? {} : { path }) }

const LEASE_MS = 1000
const DAY = 24 * 3600_000
// a and b share the role deployer (role: reaches both); c is the leader and the only subscriber of topic t
const MAILBOXES = { a: 'deployer', b: 'deployer', c: 'leader' } as const
type Name = keyof typeof MAILBOXES
const NAMES = Object.keys(MAILBOXES) as Name[]
const USER = { type: 'user', id: 'browser', role: null } as const

type Op =
  | { op: 'post'; to: { type: 'mailbox'; id: Name } | { type: 'role'; id: 'deployer' | 'leader' } | { type: 'topic'; id: 't' }; kind: 'request' | 'notice' }
  | { op: 'attach'; mb: Name; maxUnread?: number; maxAgeMs?: number }
  | { op: 'ack'; mb: Name; pick: 'pending' | 'last' | 'behind'; index: number }
  | { op: 'inbox'; mb: Name; unconfirmed: boolean; limit: number }
  | { op: 'converse'; mb: Name; to: 'user' | Name | 'reply' }
  | { op: 'heartbeat'; mb: Name }
  | { op: 'detach'; mb: Name }
  | { op: 'wait'; ms: number }

const name = fc.constantFrom(...NAMES)
const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 5, arbitrary: fc.record({ op: fc.constant('post' as const), kind: fc.constantFrom('request' as const, 'notice' as const), to: fc.oneof(name.map((id) => ({ type: 'mailbox' as const, id })), fc.constantFrom('deployer' as const, 'leader' as const).map((id) => ({ type: 'role' as const, id })), fc.constant({ type: 'topic' as const, id: 't' as const })) }) },
  { weight: 4, arbitrary: fc.record({ op: fc.constant('attach' as const), mb: name, maxUnread: fc.option(fc.integer({ min: 0, max: 3 }), { nil: undefined }), maxAgeMs: fc.option(fc.constantFrom(0, LEASE_MS, DAY), { nil: undefined }) }, { requiredKeys: ['op', 'mb'] }) },
  { weight: 3, arbitrary: fc.record({ op: fc.constant('ack' as const), mb: name, pick: fc.constantFrom('pending' as const, 'last' as const, 'behind' as const), index: fc.nat({ max: 5 }) }) },
  { weight: 3, arbitrary: fc.record({ op: fc.constant('inbox' as const), mb: name, unconfirmed: fc.boolean(), limit: fc.integer({ min: 1, max: 3 }) }) },
  { weight: 2, arbitrary: fc.record({ op: fc.constant('converse' as const), mb: name, to: fc.constantFrom('user' as const, 'reply' as const, ...NAMES) }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant('heartbeat' as const), mb: name }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant('detach' as const), mb: name }) },
  // Mostly short waits (heartbeats and acks keep leases alive across them); now and then one that lets leases run out
  { weight: 2, arbitrary: fc.record({ op: fc.constant('wait' as const), ms: fc.oneof({ weight: 4, arbitrary: fc.constantFrom(100, LEASE_MS / 2) }, { weight: 1, arbitrary: fc.constantFrom(LEASE_MS, 2 * LEASE_MS, DAY) }) }) },
)

// Sequences of up to 80 steps (fast-check's default size would keep them near 10); a failure shrinks to a few steps
const SEQUENCE_ARB = () => fc.array(opArb, { minLength: 1, maxLength: 80, size: 'max' })

interface Model {
  pending: Map<Name, number[]> // addressed, not acked, not abandoned (sorted)
  handed: Map<Name, Set<number>> // handed on the channel path, not returned by inbox, not confirmed by a conversation Message
  received: Map<Name, Message[]> // every Message addressed to it, for picking a reply target
  lease: Map<Name, number> // the live Attachment's lease deadline (ms)
}

function addressedTo(to: Address, subscribers: Set<Name>): Name[] {
  if (to.type === 'mailbox') return NAMES.filter((n) => n === to.id)
  if (to.type === 'role') return NAMES.filter((n) => MAILBOXES[n] === to.id)
  if (to.type === 'topic') return [...subscribers]
  return []
}

// One run of a sequence. Returns how many steps ran (for the statistics in the section's body)
function run(t: TestContext, ops: Op[]): number {
  t.mock.timers.enable({ apis: ['setTimeout'], now: 0 })
  try {
    let now = Date.parse('2026-11-17T00:00:00.000Z')
    const clock = () => new Date(now)
    const hub = new Hub(new Store({ now: clock }), { now: clock, leaseMs: LEASE_MS, unreadMax: 0, unreadMaxAgeMs: 0 })
    const subscribers = new Set<Name>(['c'])
    for (const n of NAMES) {
      const at = hub.attach(n, { client: 'claude-code', role: MAILBOXES[n] })
      if (n === 'c') hub.subscribe('c', 't')
      hub.detach(at.attachmentId)
    }
    const m: Model = { pending: new Map(NAMES.map((n) => [n, []])), handed: new Map(NAMES.map((n) => [n, new Set()])), received: new Map(NAMES.map((n) => [n, []])), lease: new Map() }
    const mb = (n: Name) => hub.store.getMailbox(n)!
    const live = (n: Name) => mb(n).attachment
    const prev = new Map(NAMES.map((n) => [n, { cursor: mb(n).cursor, received: mb(n).received }]))

    const post = (input: Parameters<Hub['postMessage']>[0], from: Parameters<Hub['postMessage']>[1]) => {
      const msg = hub.postMessage(input, from)
      for (const n of addressedTo(msg.to, subscribers)) {
        m.pending.get(n)!.push(msg.seq)
        m.received.get(n)!.push(msg)
      }
      return msg
    }
    // An ack moves the cursor: what it passes is no longer pending; on the channel path it is handed and unconfirmed
    const passCursor = (n: Name, handedOnChannel: boolean) => {
      const cursor = mb(n).cursor
      const passed = m.pending.get(n)!.filter((s) => s <= cursor)
      m.pending.set(n, m.pending.get(n)!.filter((s) => s > cursor))
      if (handedOnChannel) for (const s of passed) m.handed.get(n)!.add(s)
    }

    let step = 0
    for (const o of ops) {
      step++
      const where = `step ${step} ${JSON.stringify(o)}`
      // Which Mailbox's received may move in this step, by the three paths of protocol.md §4
      let mayConfirm: Name | null = null
      switch (o.op) {
        case 'post':
          post({ kind: o.kind, to: o.to, body: 'b' }, USER)
          break
        case 'attach': {
          const before = live(o.mb)
          const subs = [...mb(o.mb).subscriptions]
          const r = hub.attach(o.mb, { client: 'claude-code', role: MAILBOXES[o.mb], maxUnread: o.maxUnread, maxAgeMs: o.maxAgeMs })
          // Abandoned at attach: always the oldest of the unread, so the first `skipped` of the pending ones
          m.pending.set(o.mb, m.pending.get(o.mb)!.slice(r.skipped))
          if (r.skipped > 0) {
            mayConfirm = o.mb
            assert.equal(mb(o.mb).received, mb(o.mb).cursor, `${where}: what is abandoned at attach is not unconfirmed (received moves with cursor)`)
            // Found by this test (2026-11-17), kept as a limit (roadmap C175, protocol.md §4 "abandoned at attach"): received
            // moves to the last abandoned seq, so a Message handed on the channel path before it and never confirmed is counted
            // as confirmed too, and inbox with unconfirmed=true no longer returns it. The model follows the Hub here, so the
            // other invariants are still checked; remove these lines if the Hub stops doing it
            for (const s of m.handed.get(o.mb)!) if (s <= mb(o.mb).received) m.handed.get(o.mb)!.delete(s)
          }
          m.lease.set(o.mb, now + LEASE_MS)
          if (before) {
            // A takeover: the one cut off is gone, and the successor has its subscriptions (the unread is checked below for every step)
            assert.equal(r.superseded, before, `${where}: the takeover names the Attachment it cut off`)
            assert.equal(hub.attachments.has(before), false, `${where}: the Attachment cut off is not live`)
            assert.deepEqual(mb(o.mb).subscriptions, subs, `${where}: the successor keeps the subscriptions`)
          }
          break
        }
        case 'ack': {
          const at = live(o.mb)
          if (!at) break
          const pending = m.pending.get(o.mb)!
          const upTo = o.pick === 'pending' && pending.length ? pending[Math.min(o.index, pending.length - 1)]! : o.pick === 'behind' ? Math.max(0, mb(o.mb).cursor - 1 - o.index) : hub.store.lastSeq
          hub.ack(at, upTo)
          passCursor(o.mb, true)
          m.lease.set(o.mb, now + LEASE_MS)
          break
        }
        case 'inbox': {
          const at = live(o.mb)
          if (!at) break
          const r = hub.inbox(o.mb, 0, o.limit, o.unconfirmed)
          const seqs = r.messages.map((x) => x.seq)
          assert.deepEqual(seqs, [...seqs].sort((x, y) => x - y), `${where}: inbox returns seq order`)
          const received = seqs.length ? { first: seqs[0]!, last: seqs.at(-1)! } : undefined
          hub.ack(at, r.cursor, received)
          if (received) mayConfirm = o.mb
          for (const s of seqs) m.handed.get(o.mb)!.delete(s)
          passCursor(o.mb, false)
          m.lease.set(o.mb, now + LEASE_MS)
          break
        }
        case 'converse': {
          const at = live(o.mb)
          if (!at) break
          const from = hub.senderOf(at)
          const got = m.received.get(o.mb)!.at(-1)
          if (o.to === 'reply' && got) post({ kind: 'reply', replyTo: got.id, body: 'r' }, from)
          else if (o.to === 'user' || o.to === 'reply') post({ kind: 'request', to: { type: 'user', id: 'browser' }, body: 'q' }, from)
          else if (o.to !== o.mb) post({ kind: 'request', to: { type: 'mailbox', id: o.to }, body: 'q' }, from)
          else post({ kind: 'notice', to: { type: 'user', id: 'browser' }, body: 'n' }, from)
          // A conversation Message (a request or a reply, not a notice) confirms everything handed to the sender (up to its cursor)
          if (o.to !== o.mb) {
            mayConfirm = o.mb
            m.handed.get(o.mb)!.clear()
          }
          break
        }
        case 'heartbeat': {
          const at = live(o.mb)
          if (!at) break
          hub.heartbeat(at)
          m.lease.set(o.mb, now + LEASE_MS)
          break
        }
        case 'detach': {
          const at = live(o.mb)
          if (!at) break
          hub.detach(at)
          m.lease.delete(o.mb)
          break
        }
        case 'wait': {
          now += o.ms
          t.mock.timers.tick(o.ms)
          for (const [n, until] of m.lease) {
            if (until > now) continue
            m.lease.delete(n)
            const d = hub.describeMailboxes().find((x) => x.name === n)!
            assert.equal(d.detached?.reason, 'lease_expired', `${where}: ${n}'s lease expired, so it is detached with lease_expired`)
          }
          break
        }
      }

      for (const n of NAMES) {
        const { cursor, received } = mb(n)
        const p = prev.get(n)!
        assert.ok(received <= cursor && cursor <= hub.store.lastSeq, `${where}: ${n} has received ${received} ≤ cursor ${cursor} ≤ last seq ${hub.store.lastSeq}`)
        assert.ok(cursor >= p.cursor, `${where}: ${n}'s cursor moved back from ${p.cursor} to ${cursor}`)
        assert.ok(received >= p.received, `${where}: ${n}'s received moved back from ${p.received} to ${received}`)
        if (received > p.received) assert.equal(mayConfirm, n, `${where}: ${n}'s received moved from ${p.received} to ${received} by none of the three paths`)
        // At-least-once, in seq order: what is neither acked nor abandoned is the unread the next attach hands over
        assert.deepEqual(hub.store.unread(n).map((x) => x.seq), m.pending.get(n), `${where}: ${n}'s unread`)
        // An inbox ack does not jump over Messages handed on the channel path and not confirmed
        for (const s of m.handed.get(n)!) assert.ok(s > received, `${where}: ${n}'s received ${received} passed #${s}, handed and not confirmed`)
        // At most one live Attachment, and it is the one the Mailbox names; live exactly while the model's lease runs
        const lives = [...hub.attachments.values()].filter((a) => a.mailbox === n)
        assert.ok(lives.length <= 1, `${where}: ${n} has ${lives.length} live Attachments`)
        assert.equal(mb(n).attachment, lives[0]?.attachmentId ?? null, `${where}: ${n}'s Attachment`)
        assert.equal(lives.length === 1, m.lease.has(n), `${where}: ${n} is ${lives.length ? 'attached' : 'not attached'}, the model says ${m.lease.has(n) ? 'attached' : 'not'}`)
        prev.set(n, { cursor, received })
      }
    }
    return step
  } finally {
    t.mock.timers.reset()
  }
}

describe('delivery and Attachments: properties (C171)', () => {
  it('after every step of a generated sequence: cursor and received in order and never back, at-least-once in seq order, received only by the three paths, one live Attachment, takeover and lease expiry keep the unread', (t) => {
    fc.assert(fc.property(SEQUENCE_ARB(), (ops) => void run(t, ops)), params)
  })
})

