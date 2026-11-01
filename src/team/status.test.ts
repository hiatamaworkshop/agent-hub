import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inProject, mailboxLine, readStatus, statusCommand, type StatusMailbox, type StatusMessage } from './status.js'
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

// A fake Hub: /mailboxes and /messages, with the token checked
function fakeHub(opts: { token?: string; mailboxes?: StatusMailbox[]; messages?: StatusMessage[] } = {}): typeof fetch {
  const token = opts.token ?? 'tok'
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization
    if (auth !== `Bearer ${token}`) return new Response('{}', { status: 401 })
    if (url.pathname === '/mailboxes') return Response.json({ mailboxes: opts.mailboxes ?? mailboxes })
    if (url.pathname === '/messages') {
      const after = Number(url.searchParams.get('after') ?? '0')
      return Response.json({ messages: (opts.messages ?? messages).filter((m) => m.seq > after), lastSeq: 6 })
    }
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
