import assert from 'node:assert/strict'
import { test } from 'node:test'
import { docsIndexCommand, inProject, itemsInFlightLines, itemThreadLines, ledgerIndexLines, mailboxLine, readItemThread, readStatus, statusCommand, type StatusIndex, type StatusMailbox, type StatusMessage } from './status.js'
import { parse } from './options.js'

const CAIRN = 'C:\\work\\cairn'
const mailboxes: StatusMailbox[] = [
  {
    name: 'cairn.leader', role: 'leader', project: CAIRN, attachment: { attachmentId: 'a1' }, unread: 1,
    backlog: {
      awaitingReply: { count: 1, oldestSeq: 4 },
      outgoing: { count: 1, to: [{ type: 'role', id: 'deployer', count: 1 }] },
      unconfirmed: { count: 0 },
      lastEvent: { kind: 'turn.end', ts: '2026-11-01T10:00:00.000Z' },
    },
  },
  {
    name: 'cairn.deployer', role: 'deployer', project: 'c:/work/cairn/', attachment: null, unread: 0,
    backlog: { awaitingReply: { count: 0, oldestSeq: null }, outgoing: { count: 0, to: [] }, unconfirmed: { count: 2 }, lastEvent: null },
  },
  {
    name: 'other.leader', role: 'leader', project: 'C:\\work\\other', attachment: { attachmentId: 'a2' }, unread: 0,
    backlog: { awaitingReply: { count: 0, oldestSeq: null }, outgoing: { count: 0, to: [] }, unconfirmed: { count: 0 }, lastEvent: null },
  },
]
const msg = (seq: number, from: StatusMessage['from'], to: StatusMessage['to'], body: string): StatusMessage =>
  ({ id: `m${seq}`, seq, ts: `2026-11-01T10:0${seq}:00.000Z`, kind: 'reply', from, to, body })
const messages: StatusMessage[] = [
  msg(1, { type: 'user', id: 'browser' }, { type: 'mailbox', id: 'cairn.leader' }, 'an old request'),
  msg(2, { type: 'mailbox', id: 'cairn.leader' }, { type: 'user', id: 'browser' }, 'RESULT: an older report'),
  msg(3, { type: 'mailbox', id: 'cairn.deployer' }, { type: 'mailbox', id: 'cairn.leader' }, 'CHANGED: a message to the leader, not the human'),
  msg(4, { type: 'user', id: 'browser' }, { type: 'mailbox', id: 'cairn.leader' }, 'GOAL: C108'),
  msg(5, { type: 'mailbox', id: 'cairn.leader' }, { type: 'user', id: 'browser' }, 'RESULT: C108 read this'),
  msg(6, { type: 'mailbox', id: 'other.leader' }, { type: 'user', id: 'browser' }, 'OTHER PROJECT, NEWER'),
]

// A fake Hub: /mailboxes, /messages and /indexes, with the token checked. Every call is recorded in `calls` (C139: read-only)
function fakeHub(opts: { token?: string; mailboxes?: StatusMailbox[]; messages?: StatusMessage[]; indexes?: StatusIndex[]; calls?: string[] } = {}): typeof fetch {
  const token = opts.token ?? 'tok'
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    opts.calls?.push(`${init?.method ?? 'GET'} ${url.pathname}`)
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization
    if (auth !== `Bearer ${token}`) return new Response('{}', { status: 401 })
    if (url.pathname === '/mailboxes') return Response.json({ mailboxes: opts.mailboxes ?? mailboxes })
    if (url.pathname === '/messages') {
      const after = Number(url.searchParams.get('after') ?? '0')
      return Response.json({ messages: (opts.messages ?? messages).filter((m) => m.seq > after), lastSeq: 6 })
    }
    if (url.pathname === '/indexes') return Response.json({ indexes: opts.indexes ?? [] })
    return new Response('{}', { status: 404 })
  }) as typeof fetch
}
const conn = { hubUrl: 'http://127.0.0.1:7777', token: 'tok' }

test('status: a project is the Mailboxes whose last attach came from that folder, whatever the separators and case (C108)', () => {
  assert.equal(inProject(mailboxes[0]!, 'c:/work/cairn'), true)
  assert.equal(inProject(mailboxes[1]!, 'C:\\work\\cairn\\'), true)
  assert.equal(inProject(mailboxes[2]!, CAIRN), false)
  assert.equal(inProject({ name: 'x', role: null, project: null }, CAIRN), false)
})

test('status: one line per Mailbox with the connection, unread, awaiting reply, outgoing targets, unconfirmed and the last Event (C108)', () => {
  const leader = mailboxLine(mailboxes[0]!)
  assert.equal(leader, 'cairn.leader · leader · connected · unread 1 · awaiting reply 1 (oldest #4) · outgoing 1 → role:deployer (1) · handed unconfirmed 0 · last event turn.end at 2026-11-01T10:00:00.000Z')
  const dep = mailboxLine(mailboxes[1]!)
  assert.match(dep, /^cairn\.deployer · deployer · not connected · unread 0 · awaiting reply 0 · outgoing 0 · handed unconfirmed 2 · last event none$/)
})

test('status: prints only this project, then the newest report to the human from one of its Mailboxes in full (C108)', async () => {
  const r = await readStatus(CAIRN, conn, fakeHub())
  assert.equal(r.code, 0)
  assert.equal(r.lines[0], `Project ${CAIRN}: 2 Mailboxes on the Hub`)
  assert.equal(r.lines.filter((l) => l.includes('other.leader')).length, 0, 'another project is not shown')
  assert.equal(r.lines.filter((l) => l.includes(' · ')).length, 2)
  const tail = r.lines.slice(3)
  assert.equal(tail[0], 'Latest report to the human: #5 from mailbox:cairn.leader at 2026-11-01T10:05:00.000Z')
  assert.equal(tail[1], 'RESULT: C108 read this')
  assert.ok(!r.lines.join('\n').includes('OTHER PROJECT'), 'the other project\'s newer report is not shown')
  assert.ok(!r.lines.join('\n').includes('CHANGED: a message to the leader'), 'a message to a Mailbox is not a report to the human')
})

test('status: no report yet is said in one line; a project with no Mailbox says so (C108)', async () => {
  const noReport = await readStatus(CAIRN, conn, fakeHub({ messages: messages.filter((m) => m.seq !== 2 && m.seq !== 5) }))
  assert.equal(noReport.code, 0)
  assert.ok(noReport.lines.includes('No report to the human from a Mailbox of this project yet.'))
  const none = await readStatus('C:\\work\\empty', conn, fakeHub())
  assert.equal(none.code, 0)
  assert.equal(none.lines[1], 'No Mailbox of this project is on the Hub.')
})

test('status: a missing token, a refused token and an unreachable Hub each say so in one line and exit non-zero (C108)', async () => {
  const noToken = await readStatus(CAIRN, { hubUrl: conn.hubUrl, token: '' }, fakeHub())
  assert.equal(noToken.code, 1)
  assert.equal(noToken.lines.length, 1)
  assert.match(noToken.lines[0]!, /HUB_TOKEN is not set/)

  const refused = await readStatus(CAIRN, { hubUrl: conn.hubUrl, token: 'wrong' }, fakeHub())
  assert.equal(refused.code, 1)
  assert.equal(refused.lines.length, 1)
  assert.match(refused.lines[0]!, /the Hub refused the token/)

  const down = await readStatus(CAIRN, { hubUrl: 'http://127.0.0.1:1', token: 'tok' })
  assert.equal(down.code, 1)
  assert.equal(down.lines.length, 1)
  assert.match(down.lines[0]!, /^Hub not reachable \(http:\/\/127\.0\.0\.1:1\)/)
})

test('status: the team start names the command, quoted for the platform, and the subcommand is parsed (C108)', () => {
  assert.match(statusCommand(CAIRN), /^npm run team -- status --project /)
  assert.equal(parse(['status', '--project', CAIRN]).command, 'status')
  assert.equal(parse(['status']).command, 'status')
})

// --- C139: per item ---
const at = (seq: number): string => `2026-11-12T10:00:${String(seq).padStart(2, '0')}.000Z`
const ref = (id: string, project: string | null = CAIRN) => ({ item: { id, project, source: 'docs/roadmap.md', promise: null } })
// A Message carrying meta.item (a request) or replying to one (replyTo)
const im = (seq: number, from: StatusMessage['from'], to: StatusMessage['to'], body: string, opts: { kind?: string; item?: ReturnType<typeof ref>; replyTo?: string } = {}): StatusMessage => ({
  id: `m${seq}`, seq, ts: at(seq), kind: opts.kind ?? 'request', from, to, body,
  ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
  ...(opts.item ? { meta: opts.item } : {}),
})
const browser = { type: 'user', id: 'browser' }
const leaderBox = { type: 'mailbox', id: 'cairn.leader' }
const deployerBox = { type: 'mailbox', id: 'cairn.deployer' }
const itemMessages: StatusMessage[] = [
  im(10, browser, leaderBox, 'GOAL: C139 line one\nsecond line', { item: ref('C139') }),
  im(11, leaderBox, { type: 'role', id: 'deployer' }, 'DONE WHEN: x', { item: ref('C139') }),
  im(12, deployerBox, leaderBox, 'RESULT: done\nmore', { kind: 'reply', replyTo: 'm11' }),
  im(13, browser, leaderBox, 'other item', { item: ref('C140') }),
  im(14, browser, leaderBox, 'C139 in another project', { item: ref('C139', 'C:\\work\\other') }),
  im(15, leaderBox, browser, 'ack', { kind: 'reply', replyTo: 'm10' }),
]
const itemMailboxes: StatusMailbox[] = [
  { name: 'cairn.leader', role: 'leader', project: CAIRN, backlog: { awaitingReply: { count: 1, oldestSeq: 10, seqs: [10, 14] }, outgoing: { count: 1, to: [{ type: 'role', id: 'deployer', count: 1, seqs: [11] }] } } },
  { name: 'cairn.deployer', role: 'deployer', project: CAIRN, backlog: { awaitingReply: { count: 1, oldestSeq: 11, seqs: [11] }, outgoing: { count: 0, to: [] } } },
]

test('status --item: the item\'s requests and the replies under them, in seq order, each with seq, sender, addressee and the first line (C139)', () => {
  assert.deepEqual(itemThreadLines(itemMessages, 'C139', CAIRN), [
    'C139 in C:\\work\\cairn: 2 requests, 2 replies',
    '#10 request user:browser → mailbox:cairn.leader: GOAL: C139 line one',
    '#11 request mailbox:cairn.leader → role:deployer: DONE WHEN: x',
    '  #12 reply mailbox:cairn.deployer → mailbox:cairn.leader: RESULT: done',
    '  #15 reply mailbox:cairn.leader → user:browser: ack',
  ])
  assert.deepEqual(itemThreadLines(itemMessages, 'C999', CAIRN), ['No message carries meta.item C999 for this project (C:\\work\\cairn).'])
})

test('status --item: read from GET /messages through the Hub, with the token; another project\'s item is not shown (C139)', async () => {
  const r = await readItemThread(CAIRN, 'C139', conn, fakeHub({ messages: itemMessages }))
  assert.equal(r.code, 0)
  assert.equal(r.lines.length, 5)
  assert.ok(!r.lines.join('\n').includes('C139 in another project'), 'the other project\'s item is not shown')
  const none = await readItemThread(CAIRN, 'C999', conn, fakeHub({ messages: itemMessages }))
  assert.match(none.lines[0]!, /^No message carries meta\.item C999/)
  const bad = await readItemThread(CAIRN, 'C139', { hubUrl: conn.hubUrl, token: 'wrong' }, fakeHub({ messages: itemMessages }))
  assert.equal(bad.code, 1)
})

test('status: plain status adds one line per item with a request in flight: every holder of its in-flight requests, and the oldest waiting since (C139)', () => {
  const requests = itemMessages.filter((m) => m.kind === 'request')
  // The leader holds #10 and the deployer holds #11 (the human's request stays with the leader while the deployer works): both are named
  assert.deepEqual(itemsInFlightLines(requests, itemMailboxes, CAIRN), [
    `C139 · held by mailbox:cairn.leader (#10), mailbox:cairn.deployer (#11) · waiting since ${at(10)} (#10) · 2 requests in flight`,
  ], 'C140 (not owed, not sent) and C139 of another project are not listed')
})

test('status: one Mailbox holding two requests of an item is named once, with both seqs (C139)', () => {
  const second = im(16, browser, leaderBox, 'second request for C139', { item: ref('C139') })
  const requests = [itemMessages[1]!, second]
  const oneHolder: StatusMailbox[] = [
    { name: 'cairn.leader', role: 'leader', project: CAIRN, backlog: { awaitingReply: { count: 0, oldestSeq: null, seqs: [] }, outgoing: { count: 0, to: [] } } },
    { name: 'cairn.deployer', role: 'deployer', project: CAIRN, backlog: { awaitingReply: { count: 2, oldestSeq: 11, seqs: [11, 16] }, outgoing: { count: 0, to: [] } } },
  ]
  assert.deepEqual(itemsInFlightLines(requests, oneHolder, CAIRN), [
    `C139 · held by mailbox:cairn.deployer (#11, #16) · waiting since ${at(11)} (#11) · 2 requests in flight`,
  ])
})

test('status: an item request nobody owes is not in flight; a Hub without awaitingReply.seqs is said so, not shown as none (C139)', () => {
  const requests = itemMessages.filter((m) => m.kind === 'request')
  const idle = itemMailboxes.map((m) => ({ ...m, backlog: { ...m.backlog, awaitingReply: { count: 0, oldestSeq: null, seqs: [] }, outgoing: { count: 0, to: [] } } }))
  assert.deepEqual(itemsInFlightLines(requests, idle, CAIRN), ['No item has a request in flight.'])
  const old = itemMailboxes.map((m) => ({ ...m, backlog: { awaitingReply: { count: 1, oldestSeq: 10 } } }))
  assert.deepEqual(itemsInFlightLines(requests, old, CAIRN), ['The items with a request in flight cannot be read: this Hub does not return awaitingReply.seqs (C129).'])
})

test('status: the ledger index says when the file changed after the index was sent, and names the command that sends it again (C139)', () => {
  const idx: StatusIndex = { project: CAIRN, source: 'docs/roadmap.md', updatedAt: '2026-11-12T01:00:00.000Z' }
  const changed = ledgerIndexLines([idx], CAIRN, () => new Date('2026-11-12T02:00:00.000Z'))
  assert.equal(changed.length, 1)
  assert.match(changed[0]!, /^docs\/roadmap\.md changed at 2026-11-12T02:00:00\.000Z, after the index the Hub holds was sent at 2026-11-12T01:00:00\.000Z\. Send it again: npm --prefix /)
  // The quoting depends on the platform (CI runs on Linux too), so only the parts that do not depend on it are checked
  assert.match(changed[0]!, /run docs:index -- --project .*--file docs\/roadmap\.md$/)
  const same = ledgerIndexLines([idx], CAIRN, () => new Date('2026-11-12T00:30:00.000Z'))
  assert.equal(same[0], 'docs/roadmap.md: not changed since the index was sent at 2026-11-12T01:00:00.000Z')
  const missing = ledgerIndexLines([idx], CAIRN, () => null)
  assert.match(missing[0]!, /^docs\/roadmap\.md: not in C:\\work\\cairn, so it is not compared/)
  const none = ledgerIndexLines([{ ...idx, project: 'C:\\work\\other' }], CAIRN, () => null)
  assert.match(none[0]!, /^No ledger index of this project is on the Hub\. Send it with: npm --prefix /)
  assert.equal(docsIndexCommand(CAIRN, 'docs/roadmap.md').endsWith('--file docs/roadmap.md'), true)
})

test('status: the whole plain status reads the Hub with GET only, and adds the item and ledger lines after the report (C139)', async () => {
  const calls: string[] = []
  const idx: StatusIndex = { project: CAIRN, source: 'docs/roadmap.md', updatedAt: '2026-11-12T01:00:00.000Z' }
  const r = await readStatus(CAIRN, conn, fakeHub({ messages: [...messages, ...itemMessages], mailboxes: itemMailboxes, indexes: [idx], calls }), () => new Date('2026-11-12T02:00:00.000Z'))
  assert.equal(r.code, 0)
  assert.ok(r.lines.some((l) => l.startsWith('C139 · held by mailbox:cairn.leader')))
  assert.ok(r.lines.some((l) => l.startsWith('docs/roadmap.md changed at')))
  assert.ok(r.lines.findIndex((l) => l.startsWith('Latest report')) < r.lines.findIndex((l) => l.startsWith('C139 ·')), 'items come after the report')
  assert.ok(calls.length > 0 && calls.every((c) => c.startsWith('GET ')), `only GET: ${calls.join(', ')}`)
  assert.deepEqual(calls.map((c) => c.split(' ')[1]!.split('?')[0]), ['/mailboxes', '/messages', '/indexes'])
})

test('status --item: the item reading posts nothing and moves no cursor (C139)', async () => {
  const calls: string[] = []
  await readItemThread(CAIRN, 'C139', conn, fakeHub({ messages: itemMessages, calls }))
  assert.ok(calls.length > 0 && calls.every((c) => c.startsWith('GET /messages')), calls.join(', '))
})

test('status --item: the option is parsed; it needs a roadmap item ID and only the status command takes it (C139)', () => {
  assert.equal(parse(['status', '--item', 'C139', '--project', CAIRN]).item, 'C139')
  assert.equal(parse(['status']).item, undefined)
  assert.throws(() => parse(['status', '--item', '139']), /roadmap item ID such as C139/)
  assert.throws(() => parse(['team', '--item', 'C139']), /only for status/)
})
