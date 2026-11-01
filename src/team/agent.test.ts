import assert from 'node:assert/strict'
import { test } from 'node:test'
import { recordOnce, watchAttach, withResult } from './agent.js'
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
