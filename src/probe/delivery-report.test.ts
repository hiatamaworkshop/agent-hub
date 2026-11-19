// tools/probe/delivery-report.mjs (C177): run as a script with `--log <file>` on small probe logs.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const SCRIPT = fileURLToPath(new URL('../../tools/probe/delivery-report.mjs', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'agent-hub-delivery-report-'))

// One probe line per event, in the shape tools/probe/probe.mjs writes
const ev = (ts: string, kind: string, data: unknown) => ({ ts: `2026-11-17T${ts}Z`, kind, data })
const startup = ev('10:00:00.000', 'startup', { env: {} })
const prompt = (ts: string) => ev(ts, 'hook', { headers: {}, payload: { hook_event_name: 'Notification', notification_type: 'permission_prompt' } })
const next = (ts: string) => ev(ts, 'hook', { headers: {}, payload: { hook_event_name: 'PostToolUse', session_id: 's1', cwd: '/x' } })
const ask = (ts: string) => ev(ts, 'hook', { headers: {}, payload: { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', session_id: 's1', cwd: '/x' } })
const hello = (ts: string) => ev(ts, 'pushed', { content: 'hello', meta: { case: 'hello' } })

function report(name: string, lines: unknown[]) {
  const file = join(dir, `${name}.jsonl`)
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return spawnSync(process.execPath, [SCRIPT, '--log', file], { encoding: 'utf8' })
}
const b7 = (out: string) => out.split('\n').find((l) => l.startsWith('B7')) ?? ''

test('B7: a notification pushed inside a permission wait counts', () => {
  const r = report('inside', [
    startup,
    prompt('10:00:00.000'),
    hello('10:00:10.000'),
    next('10:00:30.000'),
  ])
  assert.equal(r.status, 0, r.stderr)
  assert.match(b7(r.stdout), /permission: a notification was pushed during a permission wait/)
})

test('B7: a notification pushed after the wait ended does not count', () => {
  const r = report('after', [
    startup,
    prompt('10:00:00.000'),
    next('10:00:05.000'),
    hello('10:01:00.000'),
  ])
  assert.equal(r.status, 0, r.stderr)
  assert.match(b7(r.stdout), /permission: not in the log/)
})

test('B7: a permission prompt before the question is considered', () => {
  const r = report('before-question', [
    startup,
    prompt('10:00:00.000'),
    hello('10:00:10.000'),
    ask('10:03:00.000'),
  ])
  assert.equal(r.status, 0, r.stderr)
  assert.match(b7(r.stdout), /permission: a notification was pushed during a permission wait/)
})

test('B7: a permission prompt within 60 s after the question is left out', () => {
  const r = report('raised-by-question', [
    startup,
    ask('10:03:00.000'),
    prompt('10:03:05.000'),
    hello('10:03:10.000'),
    next('10:03:40.000'),
  ])
  assert.equal(r.status, 0, r.stderr)
  assert.match(b7(r.stdout), /permission: not in the log/)
})

test('missing log: one line naming the file and README step 1, exit 1, no stack', () => {
  const missing = join(dir, 'does-not-exist.jsonl')
  const r = spawnSync(process.execPath, [SCRIPT, '--log', missing], { encoding: 'utf8' })
  assert.equal(r.status, 1)
  assert.equal(r.stderr, '')
  const lines = r.stdout.trim().split('\n')
  assert.equal(lines.length, 1)
  assert.ok(lines[0].includes(missing))
  assert.ok(lines[0].includes('tools/probe/README.md step 1'))
  assert.ok(!/ENOENT|\n\s+at /.test(r.stdout))
})
