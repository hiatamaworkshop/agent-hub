import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BODY_PREFIX, followReports, isReportCandidate, missingReason, reportBySeq, reportHeader, reportLines, type ReportsOptions } from './reports.js'
import { parse } from './options.js'
import { refusedTokenMessage } from '../shared/env-override.js'
import type { StatusMailbox, StatusMessage } from './status.js'

const PROJ = 'C:\\work\\proj'
const conn = { hubUrl: 'http://127.0.0.1:7777', token: 'tok' }
const mailboxes: StatusMailbox[] = [
  { name: 'proj.leader', role: 'leader', project: PROJ, attachment: { attachmentId: 'a1' } },
  // the same folder with other separators and case: still the project (C108)
  { name: 'proj.deployer', role: 'deployer', project: 'c:/work/proj/', attachment: null },
  { name: 'other.leader', role: 'leader', project: 'C:\\work\\other', attachment: { attachmentId: 'a2' } },
]

const mk = (seq: number, from: StatusMessage['from'], to: StatusMessage['to'], body: string, kind = 'reply', meta?: Record<string, unknown>): StatusMessage =>
  ({ id: `m_${seq}`, seq, ts: `2026-11-12T10:00:${String(seq).padStart(2, '0')}.000Z`, kind, from, to, body, meta: meta ?? null })
const leader = { type: 'mailbox', id: 'proj.leader' }
const deployer = { type: 'mailbox', id: 'proj.deployer' }
const other = { type: 'mailbox', id: 'other.leader' }
const human = { type: 'user', id: 'browser' }
const itemMeta = { item: { id: 'C135', project: PROJ, source: null, promise: null } }

// Messages 1-8 are history; 9 comes live in the tests that use the stream
function history(): StatusMessage[] {
  return [
    mk(1, leader, human, 'RESULT one', 'reply', itemMeta),
    mk(2, other, human, 'OTHER PROJECT'),
    mk(3, deployer, leader, 'to the leader, not the human'),
    mk(4, human, leader, 'a request from the human', 'request'),
    mk(5, leader, { type: 'role', id: 'reviewer' }, 'to a role', 'request'),
    mk(6, deployer, human, 'multi\nline body', 'request', { item: { id: 'c1', project: PROJ } }),
    mk(7, leader, { type: 'user', id: 'cli' }, 'to the cli, not the browser'),
    mk(8, { type: 'mailbox', id: 'ghost' }, human, 'a Mailbox that is not on the Hub'),
  ]
}
const live9 = mk(9, leader, human, 'LIVE')

interface Conn { chunks: string[]; close?: boolean }
const sse = (m: StatusMessage): string => `event: message\ndata: ${JSON.stringify(m)}\n\n`

// A fake Hub: /mailboxes, /messages (after, limit) and /stream (one scripted connection per call; a connection left open ends
// when the request is aborted). Every call is recorded in `calls` so that reads can be told from posts
function fakeHub(o: { store: StatusMessage[]; token?: string; streams?: Conn[]; calls?: string[]; onStream?: (n: number) => void; noLastSeq?: boolean }): typeof fetch {
  const token = o.token ?? 'tok'
  const streams = [...(o.streams ?? [])]
  let n = 0
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    o.calls?.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`)
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization
    if (auth !== `Bearer ${token}`) return new Response('{}', { status: 401 })
    if (url.pathname === '/mailboxes') return Response.json({ mailboxes })
    if (url.pathname === '/messages') {
      const after = Number(url.searchParams.get('after') ?? '0')
      const limit = Number(url.searchParams.get('limit') ?? '100')
      // lastSeq is the Hub's latest seq (it does not roll back on deletion; the fake takes the newest seq in the store)
      const lastSeq = o.noLastSeq ? undefined : Math.max(0, ...o.store.map((m) => m.seq))
      return Response.json({ messages: o.store.filter((m) => m.seq > after).slice(0, limit), lastSeq })
    }
    if (url.pathname === '/stream') {
      o.onStream?.(n++)
      const s = streams.shift() ?? { chunks: [], close: false }
      const enc = new TextEncoder()
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          for (const ch of s.chunks) c.enqueue(enc.encode(ch))
          if (s.close) c.close()
          else init?.signal?.addEventListener('abort', () => { try { c.error(new Error('aborted')) } catch { /* already closed */ } })
        },
      })
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch
}

// Starts the command with its output collected. `done` resolves with its exit code; `stop` ends it
function start(opts: Partial<ReportsOptions> & { fetchFn: typeof fetch }) {
  const lines: string[] = []
  const errs: string[] = []
  const ac = new AbortController()
  const done = followReports({ projectDir: PROJ, conn, json: false, out: (l) => lines.push(l), err: (l) => errs.push(l), signal: ac.signal, retryMs: 0, ...opts })
  return { lines, errs, done, stop: () => ac.abort() }
}

async function until(cond: () => boolean, what: string, ms = 3000): Promise<void> {
  const t = Date.now()
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

test('reports: the header at column 0 and every body line marked; the item shows only when its id has the shape C<n> (C135, C165)', () => {
  const m = mk(7, leader, human, 'a\n  body: as is', 'reply', itemMeta)
  assert.deepEqual(reportLines(m, false), ['#7 mailbox:proj.leader reply item C135 2026-11-12T10:00:07.000Z', '  | a', '  |   body: as is'])
  assert.equal(reportHeader(mk(6, deployer, human, 'x', 'request', { item: { id: 'c1' } })), '#6 mailbox:proj.deployer request 2026-11-12T10:00:06.000Z')
  assert.equal(reportHeader(mk(6, deployer, human, 'x', 'request', { item: 'C12' })), '#6 mailbox:proj.deployer request 2026-11-12T10:00:06.000Z')
})

test('reports: only a Message from a Mailbox to user:browser is a candidate (C135)', () => {
  assert.equal(isReportCandidate(mk(1, leader, human, 'x')), true)
  assert.equal(isReportCandidate(mk(1, leader, { type: 'user', id: 'cli' }, 'x')), false)
  assert.equal(isReportCandidate(mk(1, leader, { type: 'mailbox', id: 'proj.deployer' }, 'x')), false)
  assert.equal(isReportCandidate(mk(1, human, leader, 'x')), false)
})

test('reports: prints the project\'s reports in arrival order, then the live ones; other projects, Mailboxes, roles and the cli are not printed (C135, C165)', async () => {
  const calls: string[] = []
  const store = history()
  const r = start({ fetchFn: fakeHub({ store, calls, streams: [{ chunks: [sse(live9).slice(0, 20), sse(live9).slice(20)] }] }) })
  await until(() => r.lines.some((l) => l === '  | LIVE'), 'the live report')
  r.stop()
  assert.equal(await r.done, 0)
  assert.deepEqual(r.lines, [
    '#1 mailbox:proj.leader reply item C135 2026-11-12T10:00:01.000Z', '  | RESULT one',
    '#6 mailbox:proj.deployer request 2026-11-12T10:00:06.000Z', '  | multi', '  | line body',
    '#9 mailbox:proj.leader reply 2026-11-12T10:00:09.000Z', '  | LIVE',
  ])
  // Read-only: no post, nothing but GET (C135)
  assert.equal(calls.every((c) => c.startsWith('GET ')), true, calls.join('\n'))
  assert.ok(calls.includes('GET /stream'))
})

test('reports --json: each report is one line of the Message as GET /messages returns it (C135)', async () => {
  const store = history()
  const r = start({ json: true, fetchFn: fakeHub({ store, streams: [{ chunks: [sse(live9)] }] }) })
  await until(() => r.lines.length === 3, 'three reports as JSON')
  r.stop()
  await r.done
  const parsed = r.lines.map((l) => JSON.parse(l) as StatusMessage)
  assert.deepEqual(parsed, [store[0], store[5], live9])
})

test('reports --since: first prints the reports after that seq, then follows (C135)', async () => {
  const r = start({ since: 3, fetchFn: fakeHub({ store: history(), streams: [{ chunks: [sse(live9)] }] }) })
  await until(() => r.lines.some((l) => l === '  | LIVE'), 'the live report')
  r.stop()
  await r.done
  assert.deepEqual(r.lines, [
    '#6 mailbox:proj.deployer request 2026-11-12T10:00:06.000Z', '  | multi', '  | line body',
    '#9 mailbox:proj.leader reply 2026-11-12T10:00:09.000Z', '  | LIVE',
  ])
})

test('reports: when the stream drops it reconnects, catches up from the last seq printed, and prints no duplicates (C135, C165)', async () => {
  const store: StatusMessage[] = [mk(1, leader, human, 'first'), mk(2, leader, human, 'second')]
  const calls: string[] = []
  const r = start({
    fetchFn: fakeHub({
      store,
      calls,
      streams: [
        // connection 1: the Hub repeats seq 2 live, then the stream ends
        { chunks: [sse(store[1]!)], close: true },
        // connection 2: a duplicate of seq 3, then the sentinel
        { chunks: [sse(mk(3, leader, human, 'third')), sse(mk(5, leader, human, 'SENTINEL'))] },
      ],
      // Between the two connections the Hub gets seq 3 (a report), seq 4 (another project) and seq 5
      onStream: (n) => {
        if (n === 1) {
          store.push(mk(3, leader, human, 'third'), mk(4, other, human, 'OTHER'), mk(5, leader, human, 'SENTINEL'))
        }
      },
    }),
  })
  await until(() => r.lines.includes('  | SENTINEL'), 'the sentinel after the reconnect')
  r.stop()
  assert.equal(await r.done, 0)
  assert.deepEqual(r.lines, [
    '#1 mailbox:proj.leader reply 2026-11-12T10:00:01.000Z', '  | first',
    '#2 mailbox:proj.leader reply 2026-11-12T10:00:02.000Z', '  | second',
    '#3 mailbox:proj.leader reply 2026-11-12T10:00:03.000Z', '  | third',
    '#5 mailbox:proj.leader reply 2026-11-12T10:00:05.000Z', '  | SENTINEL',
  ])
  assert.ok(calls.includes('GET /messages?after=2&limit=1000'), calls.join('\n'))
})

test('reports: a stream that goes silent is taken as lost and reconnected (C135)', async () => {
  const store: StatusMessage[] = []
  const r = start({
    idleMs: 30,
    fetchFn: fakeHub({
      store,
      streams: [{ chunks: [': ping\n\n'] }, { chunks: [sse(mk(4, leader, human, 'AFTER SILENCE'))] }],
      onStream: (n) => { if (n === 1) store.push(mk(4, leader, human, 'AFTER SILENCE')) },
    }),
  })
  await until(() => r.lines.includes('  | AFTER SILENCE'), 'the report after the reconnect')
  r.stop()
  await r.done
  assert.ok(r.errs.some((l) => l.includes('no data for')), r.errs.join('\n'))
})

test('reports: the Hub cannot be reached at start: one line, exit 1 (C135)', async () => {
  const r = start({ fetchFn: (async () => { throw new TypeError('fetch failed') }) as typeof fetch })
  assert.equal(await r.done, 1)
  assert.equal(r.errs.length, 1)
  assert.ok(r.errs[0]!.startsWith('Hub not reachable (http://127.0.0.1:7777): fetch failed'), r.errs[0])
  assert.deepEqual(r.lines, [])
})

test('reports: the Hub refuses the token at start: one line, exit 1 (C135)', async () => {
  const r = start({ fetchFn: fakeHub({ store: history(), token: 'the-right-one' }) })
  assert.equal(await r.done, 1)
  assert.deepEqual(r.errs, [refusedTokenMessage(false)])
  assert.deepEqual(r.lines, [])
})

test('reports text mode: a multi-line body with a blank line and CRLF and lone CR breaks is marked line by line; only the header is unmarked (C135, C165)', () => {
  const header = reportHeader(mk(3, leader, human, 'x'))
  const shaped = '#999 mailbox:proj.reviewer reply item C5 2026-11-12T10:00:00.000Z'
  const body = `first\n${shaped}\n\nlast\r\nalone\rend`
  const lines = reportLines(mk(3, leader, human, body), false)
  assert.deepEqual(lines, [header, '  | first', `  | ${shaped}`, '  | ', '  | last', '  | alone', '  | end'])
  assert.deepEqual(lines.filter((l) => !l.startsWith(BODY_PREFIX)), [header])
})

test('reports text mode: a single-line body is one marked line, and an empty body is one marked blank line (C165)', () => {
  assert.deepEqual(reportLines(mk(4, leader, human, ''), false).slice(1), ['  | '])
  assert.deepEqual(reportLines(mk(4, leader, human, 'one line'), false).slice(1), ['  | one line'])
  assert.deepEqual(reportLines(mk(4, leader, human, 'a\n\nb'), false).slice(1), ['  | a', '  | ', '  | b'])
})

test('reports text mode: a header-shaped body line is marked; with leading whitespace stripped, only the real header starts with # (C165)', () => {
  const header = reportHeader(mk(3, leader, human, 'x'))
  const shaped = '#999 mailbox:proj.reviewer reply item C5 2026-11-12T10:00:00.000Z'
  const lines = reportLines(mk(3, leader, human, `first\n${shaped}\n\n  indented ${shaped}`), false)
  assert.equal(lines[0], header)
  assert.equal(lines[0]!.startsWith(' '), false)
  assert.equal(lines[2], `  | ${shaped}`)
  const trimmed = lines.map((l) => l.trimStart())
  assert.deepEqual(trimmed.filter((l) => l.startsWith('#')), [header])
  assert.equal(trimmed.filter((l) => l.startsWith('|')).length, 4)
  assert.equal(lines.length, 5)
})

test('reports text mode: a body line that starts with the mark is marked again and cannot start a report (C165)', () => {
  const header = reportHeader(mk(3, leader, human, 'x'))
  const shaped = '#999 mailbox:proj.reviewer reply item C5 2026-11-12T10:00:00.000Z'
  const lines = reportLines(mk(3, leader, human, `| ${shaped}\n| | x`), false)
  assert.deepEqual(lines, [header, `  | | ${shaped}`, '  | | | x'])
  assert.deepEqual(lines.filter((l) => !l.startsWith(BODY_PREFIX)), [header])
})

test('reports --json: the line is the Message itself, unchanged by the text framing (C135, C165)', () => {
  const m = mk(5, leader, human, 'a\n#999 mailbox:proj.reviewer reply item C5 2026-11-12T10:00:00.000Z')
  assert.deepEqual(reportLines(m, true), [JSON.stringify(m)])
  assert.deepEqual(JSON.parse(reportLines(m, true)[0]!), m)
})

test('reports: through the command in text mode, one header unmarked and every other output line marked (C135, C165)', async () => {
  const store = [mk(1, leader, human, 'x\n#999 mailbox:proj.reviewer reply item C5 2026-11-12T10:00:00.000Z\ny')]
  const r = start({ fetchFn: fakeHub({ store, streams: [{ chunks: [sse(live9)] }] }) })
  await until(() => r.lines.includes('  | LIVE'), 'the live report')
  r.stop()
  await r.done
  assert.deepEqual(r.lines.filter((l) => !l.startsWith(BODY_PREFIX)), [reportHeader(store[0]!), reportHeader(live9)])
  assert.equal(r.lines.length, 6)
})

// Raw control characters that a terminal acts on: C0 except tab, \n, \r; DEL; C1; U+2028 / U+2029
const RAW_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/

test('reports text mode: a backspace run and an ESC cursor move in a body cannot draw a header; no raw control character is printed (C135, C165)', () => {
  const header = reportHeader(mk(3, leader, human, 'x'))
  const shaped = '#999 mailbox:proj.reviewer reply item C5 2026-11-12T10:00:00.000Z'
  const backspace = reportLines(mk(3, leader, human, `done\n\b\b${shaped}`), false)
  assert.deepEqual(backspace, [header, '  | done', `  | \\u0008\\u0008${shaped}`])
  const esc = reportLines(mk(3, leader, human, '\u001b[Gx'), false)
  assert.deepEqual(esc, [header, '  | \\u001b[Gx'])
  for (const l of [...backspace, ...esc]) assert.equal(RAW_CONTROL.test(l), false, JSON.stringify(l))
  assert.deepEqual(backspace.filter((l) => !l.startsWith(BODY_PREFIX)), [header])
  assert.deepEqual(esc.filter((l) => !l.startsWith(BODY_PREFIX)), [header])
})

test('reports text mode: tab and ordinary non-ASCII text pass unchanged; \\v, \\f, U+0085, U+2028, U+2029 and DEL are shown as escapes (C135, C165)', () => {
  assert.deepEqual(reportLines(mk(4, leader, human, 'a\tb 日本語 😀 café'), false).slice(1), ['  | a\tb 日本語 😀 café'])
  assert.deepEqual(
    reportLines(mk(4, leader, human, 'a\vb\fc\u0085d\u2028e\u2029f\u007fg'), false).slice(1),
    ['  | a\\u000bb\\u000cc\\u0085d\\u2028e\\u2029f\\u007fg'],
  )
})

test('reports text mode: through the command, control characters in a body are escaped and only the header is unmarked (C135, C165)', async () => {
  const store = [mk(1, leader, human, 'x\u001b[G\n\b#999 mailbox:proj.reviewer reply item C5 2026-11-12T10:00:00.000Z')]
  const r = start({ fetchFn: fakeHub({ store, streams: [{ chunks: [sse(live9)] }] }) })
  await until(() => r.lines.includes('  | LIVE'), 'the live report')
  r.stop()
  await r.done
  for (const l of r.lines) assert.equal(RAW_CONTROL.test(l), false, JSON.stringify(l))
  assert.deepEqual(r.lines.filter((l) => !l.startsWith(BODY_PREFIX)), [reportHeader(store[0]!), reportHeader(live9)])
  assert.equal(r.lines.length, 5)
})

test('reports --json: control characters stay in the JSON line, which JSON.stringify escapes itself (C135)', () => {
  const m = mk(5, leader, human, 'a\u001b[G\b\u0085b')
  assert.deepEqual(reportLines(m, true), [JSON.stringify(m)])
  assert.equal((JSON.parse(reportLines(m, true)[0]!) as StatusMessage).body, m.body)
})

// `reports --seq <n>` (C166): one report by its seq, read once with GET only
async function seqRun(store: StatusMessage[], seq: number, o: { json?: boolean; fetchFn?: typeof fetch; calls?: string[] } = {}) {
  const lines: string[] = []
  const errs: string[] = []
  const code = await reportBySeq({
    projectDir: PROJ, conn, json: o.json ?? false, seq,
    fetchFn: o.fetchFn ?? fakeHub({ store, calls: o.calls }),
    out: (l) => lines.push(l), err: (l) => errs.push(l),
  })
  return { code, lines, errs }
}

test('reports --seq: a report of the project is printed in full, as --follow prints it, and exits 0; GET only (C166)', async () => {
  const calls: string[] = []
  const r = await seqRun(history(), 6, { calls })
  assert.equal(r.code, 0)
  assert.deepEqual(r.lines, reportLines(history()[5]!, false))
  assert.deepEqual(r.lines, ['#6 mailbox:proj.deployer request 2026-11-12T10:00:06.000Z', '  | multi', '  | line body'])
  assert.deepEqual(r.errs, [])
  assert.deepEqual(calls, ['GET /messages?after=5&limit=1', 'GET /mailboxes'])
})

test('reports --seq: a long body is printed in full, every line marked, the last one included (C166)', async () => {
  const body = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n')
  const store = [mk(1, leader, human, body)]
  const r = await seqRun(store, 1)
  assert.equal(r.code, 0)
  assert.equal(r.lines.length, 51)
  assert.equal(r.lines[50], '  | line 50')
})

test('reports --seq: a seq below the Hub\'s latest seq that is absent was deleted; one line, exit 1 (C166)', async () => {
  // seq 6 deleted: the Hub's latest seq is still 8, so 6 is at or below it; GET /messages?after=5 gives seq 7
  const deleted = await seqRun(history().filter((m) => m.seq !== 6), 6)
  assert.equal(deleted.code, 1)
  assert.deepEqual(deleted.errs, ['#6 is not a report: that Message was deleted (retention or manual deletion)'])
  assert.deepEqual(deleted.lines, [])
})

test('reports --seq: a seq above the Hub\'s latest seq was not sent yet; one line, exit 1 (C166)', async () => {
  const none = await seqRun(history(), 99)
  assert.equal(none.code, 1)
  assert.deepEqual(none.errs, ['#99 is not a report: no such Message on this Hub (the latest seq is 8)'])
  assert.deepEqual(none.lines, [])
})

test('reports --seq: without a numeric lastSeq the combined wording is printed (C166)', async () => {
  const absent = await seqRun(history().filter((m) => m.seq !== 6), 6, { fetchFn: fakeHub({ store: history().filter((m) => m.seq !== 6), noLastSeq: true }) })
  assert.equal(absent.code, 1)
  assert.deepEqual(absent.errs, ['#6 is not a report: no such Message (it was never sent, or it was deleted)'])
  const above = await seqRun(history(), 99, { fetchFn: fakeHub({ store: history(), noLastSeq: true }) })
  assert.deepEqual(above.errs, ['#99 is not a report: no such Message (it was never sent, or it was deleted)'])
})

test('reports --seq: missingReason splits at the latest seq; a seq equal to it was deleted (C166)', () => {
  assert.equal(missingReason(8, 8), '#8 is not a report: that Message was deleted (retention or manual deletion)')
  assert.equal(missingReason(9, 8), '#9 is not a report: no such Message on this Hub (the latest seq is 8)')
  assert.equal(missingReason(9, '8'), '#9 is not a report: no such Message (it was never sent, or it was deleted)')
  assert.equal(missingReason(9, undefined), '#9 is not a report: no such Message (it was never sent, or it was deleted)')
})

test('reports --seq: another project\'s Mailbox, or a Mailbox not on the Hub, is one line and exit 1 (C166)', async () => {
  const other_ = await seqRun(history(), 2)
  assert.equal(other_.code, 1)
  assert.ok(other_.errs[0]!.startsWith('#2 is not a report of this project: it is from other.leader'), other_.errs[0])
  const ghost = await seqRun(history(), 8)
  assert.equal(ghost.code, 1)
  assert.ok(ghost.errs[0]!.startsWith('#8 is not a report of this project: it is from ghost'), ghost.errs[0])
})

test('reports --seq: a Message not to the human, or not from a Mailbox, is one line and exit 1 (C166)', async () => {
  const toMailbox = await seqRun(history(), 3)
  assert.equal(toMailbox.code, 1)
  assert.equal(toMailbox.errs[0], '#3 is not a report: it is addressed to mailbox:proj.leader, not to the human (user:browser)')
  const fromHuman = await seqRun(history(), 4)
  assert.equal(fromHuman.code, 1)
  assert.equal(fromHuman.errs[0], '#4 is not a report: it is from user:browser, not from a Mailbox')
  const toCli = await seqRun(history(), 7)
  assert.equal(toCli.code, 1)
  assert.equal(toCli.errs[0], '#7 is not a report: it is addressed to user:cli, not to the human (user:browser)')
})

test('reports --seq --json: the one line is the Message as GET /messages returns it (C166)', async () => {
  const store = history()
  const r = await seqRun(store, 6, { json: true })
  assert.equal(r.code, 0)
  assert.deepEqual(r.lines, [JSON.stringify(store[5])])
  assert.deepEqual(JSON.parse(r.lines[0]!), store[5])
})

test('reports --seq: the Hub unreachable, or the token refused, is one line and exit 1 (C166)', async () => {
  const unreachable = await seqRun(history(), 6, { fetchFn: (async () => { throw new TypeError('fetch failed') }) as typeof fetch })
  assert.equal(unreachable.code, 1)
  assert.equal(unreachable.errs.length, 1)
  assert.ok(unreachable.errs[0]!.startsWith('Hub not reachable (http://127.0.0.1:7777): fetch failed'), unreachable.errs[0])
  const refused = await seqRun(history(), 6, { fetchFn: fakeHub({ store: history(), token: 'the-right-one' }) })
  assert.equal(refused.code, 1)
  assert.deepEqual(refused.errs, [refusedTokenMessage(false)])
})

test('reports --seq: the usage errors are one line each (C166)', () => {
  assert.equal(parse(['reports', '--seq', '6', '--project', 'x']).seq, 6)
  assert.equal(parse(['reports', '--seq', '6', '--json']).json, true)
  assert.throws(() => parse(['reports', '--seq', '6', '--follow']), /--seq reads one report and --follow keeps reading/)
  assert.throws(() => parse(['reports', '--seq', '6', '--since', '3']), /--seq and --since cannot be used together/)
  assert.throws(() => parse(['reports', '--seq', '0']), /--seq must be a positive whole number/)
  assert.throws(() => parse(['reports', '--seq', 'x']), /--seq must be a positive whole number/)
  assert.throws(() => parse(['reports', '--seq', '1.5']), /--seq must be a positive whole number/)
  assert.throws(() => parse(['reports', '--seq=-1']), /--seq must be a positive whole number/)
  assert.throws(() => parse(['status', '--seq', '6']), /only for reports/)
  assert.throws(() => parse(['reports']), /--seq <n>/)
})

test('reports: the option is parsed; --follow is required; --json and --since are only for reports; --since is a seq of 0 or more (C135)', () => {
  const p = parse(['reports', '--follow', '--json', '--since', '5'])
  assert.equal(p.command, 'reports')
  assert.equal(p.follow, true)
  assert.equal(p.json, true)
  assert.equal(p.since, 5)
  assert.equal(parse(['reports', '--follow', '--since=0']).since, 0)
  assert.throws(() => parse(['reports']), /needs --follow/)
  assert.throws(() => parse(['reports', '--follow', '--since=-1']), /--since must be a seq/)
  assert.throws(() => parse(['reports', '--follow', '--since', 'x']), /--since must be a seq/)
  assert.throws(() => parse(['status', '--json']), /only for reports/)
  assert.throws(() => parse(['team', '--follow']), /only for reports/)
  assert.equal(parse(['status']).follow, false)
})
