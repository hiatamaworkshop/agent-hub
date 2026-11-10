import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { formatLogLines, HubLogFile, maskSecrets, needsRotation, resolveHubLogFile } from './log.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'agent-hub-hublog-'))
const SECRET = 'a'.repeat(16) + '.b*c-d'
const NOW = new Date('2026-11-09T10:13:02.345Z')

test('maskSecrets: the token in the UI line is masked, the rest of the line is kept', () => {
  const line = `[hub] UI: http://127.0.0.1:7777/?token=${SECRET}`
  assert.equal(maskSecrets(line, [SECRET]), '[hub] UI: http://127.0.0.1:7777/?token=***')
})

test('maskSecrets: every occurrence of the token is masked, not only the UI line', () => {
  const text = `bad token ${SECRET} from ${SECRET}\nat ${SECRET}.x`
  assert.equal(maskSecrets(text, [SECRET]), 'bad token *** from ***\nat ***.x')
})

test('maskSecrets: a secret is matched as plain text, not as a pattern', () => {
  assert.equal(maskSecrets('x a.b*c-d y axbbc', ['a.b*c']), 'x ***-d y axbbc')
})

test('maskSecrets: an empty secret masks nothing, and a token= in a URL or HUB_TOKEN= is masked even when the value is not known', () => {
  assert.equal(maskSecrets('plain text', ['']), 'plain text')
  assert.equal(maskSecrets('GET /x?token=abc123&after=4', []), 'GET /x?token=***&after=4')
  assert.equal(maskSecrets('HUB_TOKEN=zzz9 and HUB_TOKEN: qqq', []), 'HUB_TOKEN=*** and HUB_TOKEN: ***')
})

test('formatLogLines: one ISO-timestamped line for a line printed', () => {
  assert.equal(formatLogLines(NOW, '[hub] listening on 127.0.0.1:7777'), '2026-11-09T10:13:02.345Z [hub] listening on 127.0.0.1:7777\n')
})

test('formatLogLines: each line of a multi-line text gets the time, a trailing newline adds no empty line, CR is dropped', () => {
  assert.equal(
    formatLogLines(NOW, 'Error: boom\r\n    at f (x.ts:1)\n'),
    '2026-11-09T10:13:02.345Z Error: boom\n2026-11-09T10:13:02.345Z     at f (x.ts:1)\n',
  )
  assert.equal(formatLogLines(NOW, ''), '2026-11-09T10:13:02.345Z \n')
})

test('needsRotation: rotates only when there is something and the write would pass the cap', () => {
  assert.equal(needsRotation(0, 500, 100), false)
  assert.equal(needsRotation(60, 40, 100), false)
  assert.equal(needsRotation(60, 41, 100), true)
})

test('HubLogFile: writes masked, timestamped lines to the file and creates its folder', () => {
  const file = join(tmp(), 'logs', 'hub.log')
  const log = new HubLogFile(file, [SECRET])
  log.write(`[hub] UI: http://127.0.0.1:7777/?token=${SECRET}`, NOW)
  log.write('[hub] expired files removed: 2', NOW)
  assert.equal(
    readFileSync(file, 'utf8'),
    '2026-11-09T10:13:02.345Z [hub] UI: http://127.0.0.1:7777/?token=***\n2026-11-09T10:13:02.345Z [hub] expired files removed: 2\n',
  )
  assert.equal(readFileSync(file, 'utf8').includes(SECRET), false)
})

test('HubLogFile: past the cap, the file moves to .1, and a second rotation replaces .1', () => {
  // With a cap of 200 bytes: a 177-byte line, then a 28-byte line (205 > 200, so rotate), then a 177-byte line (rotate again)
  const dir = tmp()
  const file = join(dir, 'hub.log')
  const log = new HubLogFile(file, [], 200)
  const a = formatLogLines(NOW, 'a'.repeat(150))
  const b = formatLogLines(NOW, 'b')
  const c = formatLogLines(NOW, 'c'.repeat(150))
  log.write('a'.repeat(150), NOW)
  assert.equal(readFileSync(file, 'utf8'), a)
  log.write('b', NOW)
  assert.equal(readFileSync(`${file}.1`, 'utf8'), a)
  assert.equal(readFileSync(file, 'utf8'), b)
  log.write('c'.repeat(150), NOW)
  assert.equal(readFileSync(`${file}.1`, 'utf8'), b)
  assert.equal(readFileSync(file, 'utf8'), c)
})

test('HubLogFile: a rotation whose rename fails keeps every line, and rotates again once the rename can work', () => {
  // A directory at <file>.1 makes the rename fail on every OS (a file cannot replace a directory), as a locked file does on Windows
  const dir = tmp()
  const file = join(dir, 'hub.log')
  mkdirSync(`${file}.1`)
  const reports: string[] = []
  const log = new HubLogFile(file, [], 200, (m) => reports.push(m))
  const a = formatLogLines(NOW, 'a'.repeat(150))
  const b = formatLogLines(NOW, 'b')
  const c = formatLogLines(NOW, 'c'.repeat(150))
  const d = formatLogLines(NOW, 'd')
  log.write('a'.repeat(150), NOW)
  log.write('b', NOW) // over the cap: the rename fails, and the line is still appended
  log.write('c'.repeat(150), NOW)
  log.write('d', NOW)
  assert.equal(readFileSync(file, 'utf8'), a + b + c + d)
  assert.equal(reports.length, 1, 'reported once')
  assert.match(reports[0]!, /cannot move the log/)
  // the blocker is removed: the next write moves the file and starts a new one
  rmSync(`${file}.1`, { recursive: true })
  log.write('e', NOW)
  assert.equal(readFileSync(`${file}.1`, 'utf8'), a + b + c + d)
  assert.equal(readFileSync(file, 'utf8'), formatLogLines(NOW, 'e'))
  assert.equal(reports.length, 1)
})

test('HubLogFile: a file that already has content counts its size, so the first write can rotate it', () => {
  const dir = tmp()
  const file = join(dir, 'hub.log')
  writeFileSync(file, 'x'.repeat(190))
  const log = new HubLogFile(file, [], 200)
  log.write('next line that does not fit', NOW)
  assert.equal(readFileSync(`${file}.1`, 'utf8'), 'x'.repeat(190))
  assert.equal(existsSync(file), true)
})

test('resolveHubLogFile: unset or blank is logs/hub.log under the agent-hub folder; HUB_LOG_FILE names the file, a relative one from that folder', () => {
  const root = tmp()
  assert.equal(resolveHubLogFile(root, undefined), join(root, 'logs', 'hub.log'))
  assert.equal(resolveHubLogFile(root, '   '), join(root, 'logs', 'hub.log'))
  assert.equal(resolveHubLogFile(root, 'custom/a.log'), join(root, 'custom', 'a.log'))
  const abs = join(tmp(), 'check.log')
  assert.equal(resolveHubLogFile(root, abs), abs)
})

test('HubLogFile: the log goes to HUB_LOG_FILE when it is set, and to logs/hub.log under the folder when it is not', () => {
  const root = tmp()
  const custom = join(tmp(), 'work', 'hub.log')
  new HubLogFile(resolveHubLogFile(root, custom), []).write('to the custom file', NOW)
  assert.equal(readFileSync(custom, 'utf8'), formatLogLines(NOW, 'to the custom file'))
  assert.equal(existsSync(join(root, 'logs', 'hub.log')), false, 'the default is not written when HUB_LOG_FILE is set')
  new HubLogFile(resolveHubLogFile(root, undefined), []).write('to the default file', NOW)
  assert.equal(readFileSync(join(root, 'logs', 'hub.log'), 'utf8'), formatLogLines(NOW, 'to the default file'))
  assert.equal(readFileSync(custom, 'utf8'), formatLogLines(NOW, 'to the custom file'), 'the custom file is not touched by the default')
})

test('HubLogFile: the rotation goes to <HUB_LOG_FILE>.1 and not to the default path', () => {
  const root = tmp()
  const custom = join(tmp(), 'work', 'hub.log')
  const log = new HubLogFile(resolveHubLogFile(root, custom), [], 200)
  log.write('a'.repeat(150), NOW)
  log.write('b', NOW)
  assert.equal(readFileSync(`${custom}.1`, 'utf8'), formatLogLines(NOW, 'a'.repeat(150)))
  assert.equal(readFileSync(custom, 'utf8'), formatLogLines(NOW, 'b'))
  assert.equal(existsSync(join(root, 'logs', 'hub.log.1')), false)
})

test('HubLogFile: a failed write is reported once and does not throw', () => {
  const dir = tmp()
  const blocker = join(dir, 'blocker')
  writeFileSync(blocker, 'not a folder')
  const reports: string[] = []
  const log = new HubLogFile(join(blocker, 'hub.log'), [], 200, (m) => reports.push(m))
  log.write('one', NOW)
  log.write('two', NOW)
  assert.equal(reports.length, 1)
  assert.match(reports[0]!, /cannot write the log/)
})
