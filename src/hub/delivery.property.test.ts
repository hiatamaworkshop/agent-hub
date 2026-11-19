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
// The model computes the Mailbox's cursor and received by itself (C178), from what it recorded: the seqs it posted and when,
// the options of each attach, and the rules protocol.md §3-§4 state (the rules as src/hub/store.ts and src/hub/hub.ts apply
// them). It reads neither from the Hub; after every step the test asserts that the Hub's cursor, received and last seq equal
// the model's. The model's pending (addressed, neither acked nor abandoned) is the addressed Messages above the cursor, and
// the Messages handed on the channel path and not yet returned by inbox or confirmed by a conversation Message (`handed`).
// The one value still read from the Hub: at an attach that abandons, the C175 limit (below) follows the Hub's `received`.
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
// The Hub's defaults in this test (the Hub is built with them below); an attach without maxUnread / maxAgeMs gets these
const UNREAD_MAX = 0
const UNREAD_MAX_AGE_MS = 0
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
  lastSeq: number // the last seq assigned, as the model saw its own posts
  posted: Map<number, number> // seq -> the model's clock when it posted it (ms)
  addressed: Map<Name, Message[]> // every Message addressed to it, in seq order
  cursor: Map<Name, number>
  received: Map<Name, number>
  handed: Map<Name, Set<number>> // handed on the channel path, not returned by inbox, not confirmed by a conversation Message
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
    const hub = new Hub(new Store({ now: clock }), { now: clock, leaseMs: LEASE_MS, unreadMax: UNREAD_MAX, unreadMaxAgeMs: UNREAD_MAX_AGE_MS })
    const subscribers = new Set<Name>(['c'])
    for (const n of NAMES) {
      const at = hub.attach(n, { client: 'claude-code', role: MAILBOXES[n] })
      if (n === 'c') hub.subscribe('c', 't')
      hub.detach(at.attachmentId)
    }
    const m: Model = {
      lastSeq: 0,
      posted: new Map(),
      addressed: new Map(NAMES.map((n) => [n, []])),
      cursor: new Map(NAMES.map((n) => [n, 0])),
      received: new Map(NAMES.map((n) => [n, 0])),
      handed: new Map(NAMES.map((n) => [n, new Set()])),
      lease: new Map(),
    }
    const mb = (n: Name) => hub.store.getMailbox(n)!
    const live = (n: Name) => mb(n).attachment
    const prev = new Map(NAMES.map((n) => [n, { cursor: mb(n).cursor, received: mb(n).received }]))

    // The model's pending: addressed, neither acked nor abandoned (the cursor passes what is acked or abandoned)
    const pendingOf = (n: Name): number[] => m.addressed.get(n)!.map((x) => x.seq).filter((s) => s > m.cursor.get(n)!)
    const clampSeq = (upTo: number) => Math.min(Math.floor(upTo), m.lastSeq)

    const post = (input: Parameters<Hub['postMessage']>[0], from: Parameters<Hub['postMessage']>[1]) => {
      const msg = hub.postMessage(input, from)
      assert.equal(msg.seq, m.lastSeq + 1, `a post takes the seq after the last one`)
      m.lastSeq = msg.seq
      m.posted.set(msg.seq, now)
      for (const n of addressedTo(msg.to, subscribers)) m.addressed.get(n)!.push(msg)
      return msg
    }

    // The Hub's ack (src/hub/hub.ts ack, protocol.md §3-§4): the received range first, when it continues directly from received
    // (store.ts apply moves cursor with received), then the cursor up to upTo. Neither moves back or passes the last seq assigned.
    // Returns the seqs that the cursor passed (those handed on the channel path become handed)
    const modelAck = (n: Name, upTo: number, range?: { first: number; last: number }): number[] => {
      const before = pendingOf(n)
      let received = m.received.get(n)!
      if (range) {
        const next = m.addressed.get(n)!.find((x) => x.seq > received)
        if (!next || next.seq >= range.first) received = Math.max(received, clampSeq(range.last))
      }
      m.received.set(n, received)
      m.cursor.set(n, Math.max(m.cursor.get(n)!, received, clampSeq(upTo)))
      return before.filter((s) => s <= m.cursor.get(n)!)
    }

    // The Hub's trimUnread (src/hub/hub.ts), from the model's record: the oldest unread beyond maxUnread, then the ones
    // posted before the maxAgeMs cutoff. Returns how many are abandoned at this attach
    const abandonedAt = (n: Name, maxUnread: number, maxAgeMs: number): number => {
      const unread = pendingOf(n)
      let drop = maxUnread > 0 ? Math.max(0, unread.length - maxUnread) : 0
      if (maxAgeMs > 0) {
        const cutoff = now - maxAgeMs
        while (drop < unread.length && m.posted.get(unread[drop]!)! < cutoff) drop++
      }
      return drop
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
          const abandoned = abandonedAt(o.mb, o.maxUnread ?? UNREAD_MAX, o.maxAgeMs ?? UNREAD_MAX_AGE_MS)
          const unread = pendingOf(o.mb)
          const r = hub.attach(o.mb, { client: 'claude-code', role: MAILBOXES[o.mb], maxUnread: o.maxUnread, maxAgeMs: o.maxAgeMs })
          assert.equal(r.skipped, abandoned, `${where}: the Hub abandons ${r.skipped} unread at attach; the model counts ${abandoned} from maxUnread, maxAgeMs and the post times`)
          if (abandoned > 0) {
            // Abandoning moves received to the last abandoned seq, and the cursor with it (src/hub/hub.ts trimUnread)
            const last = unread[abandoned - 1]!
            m.received.set(o.mb, Math.max(m.received.get(o.mb)!, last))
            m.cursor.set(o.mb, Math.max(m.cursor.get(o.mb)!, m.received.get(o.mb)!))
            mayConfirm = o.mb
            assert.equal(mb(o.mb).received, mb(o.mb).cursor, `${where}: what is abandoned at attach is not unconfirmed (received moves with cursor)`)
            // Found by this test (2026-11-17), kept as a limit (roadmap C175, protocol.md §4 "abandoned at attach"): received
            // moves to the last abandoned seq, so a Message handed on the channel path before it and never confirmed is counted
            // as confirmed too, and inbox with unconfirmed=true no longer returns it. The model follows the Hub's received here,
            // so the other invariants are still checked; remove these lines if the Hub stops doing it
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
          const pending = pendingOf(o.mb)
          const cursor = m.cursor.get(o.mb)!
          const upTo = o.pick === 'pending' && pending.length ? pending[Math.min(o.index, pending.length - 1)]! : o.pick === 'behind' ? Math.max(0, cursor - 1 - o.index) : m.lastSeq
          hub.ack(at, upTo)
          for (const s of modelAck(o.mb, upTo)) m.handed.get(o.mb)!.add(s)
          m.lease.set(o.mb, now + LEASE_MS)
          break
        }
        case 'inbox': {
          const at = live(o.mb)
          if (!at) break
          // What inbox returns, and its cursor (src/hub/hub.ts inbox): unread after the cursor (after received with unconfirmed), in seq order
          const start = Math.max(0, o.unconfirmed ? m.received.get(o.mb)! : m.cursor.get(o.mb)!)
          const found = m.addressed.get(o.mb)!.filter((x) => x.seq > start).slice(0, o.limit + 1)
          const hasMore = found.length > o.limit
          const expected = found.slice(0, o.limit).map((x) => x.seq)
          const upTo = hasMore ? expected.at(-1)! : Math.max(start, m.lastSeq)
          const r = hub.inbox(o.mb, 0, o.limit, o.unconfirmed)
          assert.deepEqual(r.messages.map((x) => x.seq), expected, `${where}: inbox returns the model's unread, in seq order`)
          assert.equal(r.cursor, upTo, `${where}: inbox's cursor is the model's`)
          const received = expected.length ? { first: expected[0]!, last: expected.at(-1)! } : undefined
          hub.ack(at, upTo, received)
          modelAck(o.mb, upTo, received)
          if (received) mayConfirm = o.mb
          for (const s of expected) m.handed.get(o.mb)!.delete(s)
          m.lease.set(o.mb, now + LEASE_MS)
          break
        }
        case 'converse': {
          const at = live(o.mb)
          if (!at) break
          const from = hub.senderOf(at)
          const got = m.addressed.get(o.mb)!.at(-1)
          if (o.to === 'reply' && got) post({ kind: 'reply', replyTo: got.id, body: 'r' }, from)
          else if (o.to === 'user' || o.to === 'reply') post({ kind: 'request', to: { type: 'user', id: 'browser' }, body: 'q' }, from)
          else if (o.to !== o.mb) post({ kind: 'request', to: { type: 'mailbox', id: o.to }, body: 'q' }, from)
          else post({ kind: 'notice', to: { type: 'user', id: 'browser' }, body: 'n' }, from)
          // A conversation Message (a request or a reply, not a notice) confirms everything handed to the sender (up to its cursor):
          // store.ts appendMessage advances the sender's received to its cursor
          if (o.to !== o.mb) {
            mayConfirm = o.mb
            m.received.set(o.mb, m.cursor.get(o.mb)!)
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

      assert.equal(hub.store.lastSeq, m.lastSeq, `${where}: the last seq assigned is the model's`)
      for (const n of NAMES) {
        const { cursor, received } = mb(n)
        const p = prev.get(n)!
        assert.ok(received <= cursor && cursor <= hub.store.lastSeq, `${where}: ${n} has received ${received} ≤ cursor ${cursor} ≤ last seq ${hub.store.lastSeq}`)
        // The model computes the cursor and received from its acks, received ranges, abandons and conversation Messages (C178)
        assert.equal(cursor, m.cursor.get(n), `${where}: ${n}'s cursor is ${cursor}, the model computes ${m.cursor.get(n)}`)
        assert.equal(received, m.received.get(n), `${where}: ${n}'s received is ${received}, the model computes ${m.received.get(n)}`)
        assert.ok(cursor >= p.cursor, `${where}: ${n}'s cursor moved back from ${p.cursor} to ${cursor}`)
        assert.ok(received >= p.received, `${where}: ${n}'s received moved back from ${p.received} to ${received}`)
        if (received > p.received) assert.equal(mayConfirm, n, `${where}: ${n}'s received moved from ${p.received} to ${received} by none of the three paths`)
        // At-least-once, in seq order: what is neither acked nor abandoned is the unread the next attach hands over
        assert.deepEqual(hub.store.unread(n).map((x) => x.seq), pendingOf(n), `${where}: ${n}'s unread`)
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

describe('delivery and Attachments: properties (C171, C178)', () => {
  it('after every step of a generated sequence: cursor and received in order and never back, computed by the model from its own record (C178), at-least-once in seq order, received only by the three paths, one live Attachment, takeover and lease expiry keep the unread', (t) => {
    fc.assert(fc.property(SEQUENCE_ARB(), (ops) => void run(t, ops)), params)
  })
})
