import assert from 'node:assert/strict'
import { isAbsolute, join } from 'node:path'
import { test } from 'node:test'
import { ROOT } from './env.js'
import { startSummaryLines, usageDocPath } from './summary-lines.js'

const DOC = join(ROOT, 'docs', 'usage.md')

test('summary: the first line points at the item card and the absolute usage.md path (C132)', () => {
  assert.ok(isAbsolute(usageDocPath()), 'the path must open from any started project')
  assert.equal(usageDocPath(), DOC)
  const lines = startSummaryLines(DOC, true)
  assert.equal(lines.length, 1)
  assert.ok(lines[0]!.startsWith('planning session: '))
  assert.ok(lines[0]!.includes('Draft request'))
  assert.ok(lines[0]!.includes(DOC))
  assert.ok(lines[0]!.includes('"Try a round trip between roles"'))
})

test('summary: with no reviewer connected, one more line says the close waits for the user (C132, C133)', () => {
  const lines = startSummaryLines(DOC, false)
  assert.equal(lines.length, 2)
  assert.ok(lines[1]!.startsWith('no reviewer: '))
  assert.ok(lines[1]!.includes('close C<n>'))
  assert.ok(lines[1]!.includes('(C133)'))
})

test('summary: with a reviewer connected, the no-reviewer line is absent', () => {
  const lines = startSummaryLines(DOC, true)
  assert.ok(!lines.some((l) => l.startsWith('no reviewer:')))
})
