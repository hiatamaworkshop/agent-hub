import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { interrupted, onStartSignals, recordOnce, superviseChild, tokenRefusal, watchAttach, withResult } from './agent.js'
import { buildResultRecord, emptyOutcome, type StartOutcome } from './startlog.js'

// C100: a role is `started` only once its attach is seen on the Hub; a start writes exactly one result line on every exit path
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const ref = { role: 'leader', mailbox: 'x.leader' }

test('watchAttach: the attach counts once the Hub shows an id other than the one held before (C100)', async () => {
  const ids = ['old', 'old', 'new']
  let i = 0
  const seen: string[] = []
  const timeouts: string[] = []
  watchAttach({
    attachmentOf: async () => ids[Math.min(i++, ids.length - 1)]!,
    before: 'old',
    timeoutMs: 5000,
    intervalMs: 5,
    onAttached: () => seen.push('attached'),
    onTimeout: () => timeouts.push('timeout'),
  })
  await wait(100)
  assert.deepEqual(seen, ['attached'], 'called once')
  assert.deepEqual(timeouts, [])
})

test('watchAttach: the same id keeps it waiting, and the timeout is called once with onAttached never (C100)', async () => {
  let attached = 0
  let timeouts = 0
  watchAttach({ attachmentOf: async () => 'old', before: 'old', timeoutMs: 40, intervalMs: 5, onAttached: () => attached++, onTimeout: () => timeouts++ })
  await wait(120)
  assert.deepEqual([attached, timeouts], [0, 1])
})

test('watchAttach: stop prevents both callbacks (the role has already ended one way or the other) (C100)', async () => {
  let calls = 0
  const stop = watchAttach({ attachmentOf: async () => 'new', before: 'old', timeoutMs: 40, intervalMs: 5, onAttached: () => calls++, onTimeout: () => (calls += 10) })
  stop()
  await wait(80)
  assert.equal(calls, 0)
})

// The reviewer's case: the Hub could not be read before claude started (before unknown), and another claude already holds the
// Mailbox (A). Its id must not be taken as this start's attach
test('watchAttach: unreadable before and an id already held (A) is the baseline, not an attach (C100)', async () => {
  let attached = 0
  let timeouts = 0
  watchAttach({ attachmentOf: async () => 'A', before: undefined, timeoutMs: 60, intervalMs: 5, onAttached: () => attached++, onTimeout: () => timeouts++ })
  await wait(150)
  assert.deepEqual([attached, timeouts], [0, 1], 'A stays the baseline; without a new id the start is failed at the limit')
})

test('watchAttach: unreadable before, then a different id after the baseline is read, counts as the attach (C100)', async () => {
  const seq: (string | null | undefined)[] = ['A', undefined, 'A', 'B']
  let i = 0
  let attached = 0
  let timeouts = 0
  watchAttach({
    attachmentOf: async () => seq[Math.min(i++, seq.length - 1)],
    before: undefined,
    timeoutMs: 1000,
    intervalMs: 5,
    onAttached: () => attached++,
    onTimeout: () => timeouts++,
  })
  await wait(100)
  assert.deepEqual([attached, timeouts], [1, 0])
})

test('watchAttach: unreadable before, first read null (not attached), then A: A is new (C100)', async () => {
  const seq: (string | null | undefined)[] = [null, 'A']
  let i = 0
  let attached = 0
  watchAttach({ attachmentOf: async () => seq[Math.min(i++, seq.length - 1)], before: undefined, timeoutMs: 1000, intervalMs: 5, onAttached: () => attached++, onTimeout: () => {} })
  await wait(100)
  assert.equal(attached, 1)
})

test('watchAttach: the Hub unreadable throughout times out as failed and never counts as attached (C100)', async () => {
  let attached = 0
  let timeouts = 0
  watchAttach({ attachmentOf: async () => undefined, before: undefined, timeoutMs: 60, intervalMs: 5, onAttached: () => attached++, onTimeout: () => timeouts++ })
  await wait(150)
  assert.deepEqual([attached, timeouts], [0, 1])
})

test('watchAttach: readable before (A), an unreadable read in between, then B: B counts (C100)', async () => {
  const seq: (string | null | undefined)[] = ['A', undefined, 'B']
  let i = 0
  let attached = 0
  watchAttach({ attachmentOf: async () => seq[Math.min(i++, seq.length - 1)], before: 'A', timeoutMs: 1000, intervalMs: 5, onAttached: () => attached++, onTimeout: () => {} })
  await wait(100)
  assert.equal(attached, 1)
})

test('recordOnce: the first outcome is written and a later one is not (an exit after a timeout adds no line) (C100)', () => {
  const written: StartOutcome[] = []
  const record = recordOnce((o) => written.push(o))
  record({ ...emptyOutcome(), failed: [{ ...ref, reason: 'timeout' }] })
  record({ ...emptyOutcome(), started: [ref] })
  assert.equal(written.length, 1)
  assert.deepEqual(written[0]!.failed, [{ ...ref, reason: 'timeout' }])
  assert.deepEqual(written[0]!.started, [])
})

test('withResult: a start that returns without recording still gets one line (C100)', async () => {
  const written: StartOutcome[] = []
  const record = recordOnce((o) => written.push(o))
  assert.equal(await withResult(record, async () => 7), 7)
  assert.equal(written.length, 1)
  assert.equal(written[0]!.aborted, 'the start ended without a result')
})

test('withResult: a throw is written as aborted with its message, and is rethrown (C100)', async () => {
  const written: StartOutcome[] = []
  const record = recordOnce((o) => written.push(o))
  await assert.rejects(
    withResult(record, async () => {
      throw new Error('boom')
    }),
    /boom/,
  )
  assert.equal(written.length, 1)
  assert.equal(written[0]!.aborted, 'boom')
})

test('withResult: a result written before a throw is the only line (C100)', async () => {
  const written: StartOutcome[] = []
  const record = recordOnce((o) => written.push(o))
  await assert.rejects(
    withResult(record, async () => {
      record({ ...emptyOutcome(), failed: [{ ...ref, reason: 'claude ended before attaching' }] })
      throw new Error('later')
    }),
    /later/,
  )
  assert.equal(written.length, 1)
  assert.equal(written[0]!.aborted, null)
  assert.equal(written[0]!.failed.length, 1)
})

test('result record: printed roles are carried into the line (C100)', () => {
  const outcome = { ...emptyOutcome(), printed: [ref] }
  const line = buildResultRecord('2026-11-01T00:00:00.000Z', 'C:\\work\\x', outcome, '2026-11-01T00:00:01.000Z')
  assert.deepEqual(line.printed, [ref])
  assert.deepEqual(emptyOutcome().printed, [])
})

// C115: runAgent's child wiring, run with a fake child and an injected attachment read
function fakeChild() { return new EventEmitter() as EventEmitter & { emit(e: string, ...a: unknown[]): boolean } }
function supervise(child: EventEmitter, opts: { watch?: boolean; fromTeam?: boolean; ids?: (string | null)[]; attachSec?: number }) {
  const lines: StartOutcome[] = []
  const ids = opts.ids ?? [null]
  let i = 0
  const done = superviseChild(child as never, {
    ref, fromTeam: opts.fromTeam, watch: opts.watch ?? true, before: null, attachSec: opts.attachSec ?? 5, intervalMs: 5,
    attachmentOf: async () => ids[Math.min(i++, ids.length - 1)]!,
    record: recordOnce((o) => lines.push(o)),
  })
  return { lines, done }
}

test('superviseChild: claude that exits before attaching is failed, not started (C115)', async () => {
  const child = fakeChild()
  const s = supervise(child, {})
  child.emit('spawn')
  await wait(20)
  child.emit('exit', 3, null)
  assert.equal(await s.done, 3)
  assert.equal(s.lines.length, 1)
  assert.deepEqual(s.lines[0]!.started, [])
  assert.match(s.lines[0]!.failed[0]!.reason, /ended before attaching \(exit code 3\)/)
})

test('superviseChild: an attach seen on the Hub is started, and the later exit adds nothing (C115)', async () => {
  const child = fakeChild()
  const s = supervise(child, { ids: [null, 'new'] })
  child.emit('spawn')
  await wait(60)
  child.emit('exit', 0, null)
  assert.equal(await s.done, 0)
  assert.equal(s.lines.length, 1)
  assert.deepEqual(s.lines[0]!.started, [ref])
  assert.deepEqual(s.lines[0]!.failed, [])
})

test('superviseChild: a spawn error is failed with the reason and resolves 1 (C115)', async () => {
  const child = fakeChild()
  const s = supervise(child, {})
  child.emit('error', new Error('ENOENT'))
  assert.equal(await s.done, 1)
  assert.match(s.lines[0]!.failed[0]!.reason, /cannot start claude: ENOENT/)
})

test('superviseChild: no attach within the limit is failed once (C115)', async () => {
  const child = fakeChild()
  const s = supervise(child, { attachSec: 0.05 })
  child.emit('spawn')
  await wait(120)
  child.emit('exit', 0, null)
  await s.done
  assert.equal(s.lines.length, 1)
  assert.match(s.lines[0]!.failed[0]!.reason, /did not attach within/)
})

test('superviseChild: started by team, nothing is recorded here (C115)', async () => {
  const child = fakeChild()
  const s = supervise(child, { fromTeam: true })
  child.emit('spawn')
  child.emit('exit', 0, null)
  await s.done
  // recordOnce lets the exit line through only if nothing came before; team's own record is a no-op in runAgent
  assert.ok(s.lines.every((l) => l.started.length === 0))
})

// C116: agent on its own without a token is refused; signals leave a line
test('tokenRefusal: agent on its own without a token is refused; with a token or from team it is not (C116)', () => {
  assert.match(tokenRefusal('', false)!, /cannot attach without it/)
  assert.match(tokenRefusal('', undefined)!, /No HUB_TOKEN/)
  assert.equal(tokenRefusal('x'.repeat(16), false), null)
  assert.equal(tokenRefusal('', true), null)
})

test('interrupted: names the signal and keeps the roles recorded so far (C116)', () => {
  const o = interrupted({ ...emptyOutcome(), started: [ref] }, 'SIGINT')
  assert.equal(o.aborted, 'interrupted by SIGINT')
  assert.deepEqual(o.started, [ref])
})

test('onStartSignals: SIGINT and SIGHUP call the handler and exit; after off, neither does (C116)', () => {
  const proc = new EventEmitter()
  const seen: string[] = []
  const codes: number[] = []
  const off = onStartSignals((s) => seen.push(s), proc, (c) => codes.push(c))
  proc.emit('SIGINT')
  proc.emit('SIGHUP')
  assert.deepEqual(seen, ['SIGINT', 'SIGHUP'])
  assert.deepEqual(codes, [130, 129])
  off()
  proc.emit('SIGINT')
  assert.equal(seen.length, 2)
  assert.equal(proc.listenerCount('SIGINT'), 0)
})
