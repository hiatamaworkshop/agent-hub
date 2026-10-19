import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import type { Address } from '../shared/types.js'
import { Store, type NewMessage } from './store.js'

const dir = mkdtempSync(join(tmpdir(), 'agent-hub-store-'))
after(() => rmSync(dir, { recursive: true, force: true }))

let n = 0
const tmpFile = () => join(dir, `hub-${++n}.jsonl`)

function msg(to: Address, body = 'b'): NewMessage {
  return { kind: 'request', from: { type: 'user', id: 'browser', role: null }, to, body }
}

describe('Store: 採番', () => {
  it('seq は 1 から単調増加し、id は m_ で始まる', () => {
    const s = new Store()
    const a = s.appendMessage(msg({ type: 'topic', id: 't' }))
    const b = s.appendMessage(msg({ type: 'topic', id: 't' }))
    assert.equal(a.seq, 1)
    assert.equal(b.seq, 2)
    assert.match(a.id, /^m_/)
    assert.equal(s.getMessage(b.id), b)
    assert.deepEqual(s.listMessages(1).map((m) => m.seq), [2])
  })
})

describe('Store: 復元', () => {
  it('再起動後に Mailbox・購読・cursor・メッセージ・seq が戻る', () => {
    const file = tmpFile()
    const s1 = new Store({ file })
    s1.ensureMailbox('rev-a', 'reviewer')
    s1.subscribe('rev-a', 'user.message')
    s1.appendMessage(msg({ type: 'topic', id: 'user.message' }))
    s1.appendMessage(msg({ type: 'mailbox', id: 'rev-a' }))
    s1.advanceCursor('rev-a', 1)
    s1.ensureMailbox('gone')
    s1.deleteMailbox('gone')
    s1.setAttachment('rev-a', 'at_x')
    s1.setProject('rev-a', 'C:\\work\\cairn')

    const s2 = new Store({ file })
    assert.equal(s2.lastSeq, 2)
    const mb = s2.getMailbox('rev-a')
    assert.ok(mb)
    assert.equal(mb.role, 'reviewer')
    assert.deepEqual(mb.subscriptions, ['user.message'])
    assert.equal(mb.cursor, 1)
    assert.equal(mb.project, 'C:\\work\\cairn')
    assert.equal(mb.attachment, null, 'Attachment は永続化しない')
    assert.equal(s2.getMailbox('gone'), undefined)
    assert.deepEqual(s2.unread('rev-a').map((m) => m.seq), [2])
    assert.equal(s2.appendMessage(msg({ type: 'topic', id: 't' })).seq, 3)
  })

  it('途中で切れた最終行は捨て、次の追記を壊さない', () => {
    const file = tmpFile()
    new Store({ file }).appendMessage(msg({ type: 'topic', id: 't' }))
    appendFileSync(file, '{"op":"mess')
    const s2 = new Store({ file })
    assert.equal(s2.lastSeq, 1)
    s2.appendMessage(msg({ type: 'topic', id: 't' }))
    assert.equal(new Store({ file }).lastSeq, 2)
    assert.equal(readFileSync(file, 'utf8').split('\n').filter(Boolean).length, 3)
  })

  it('CRLF の行でも読める', () => {
    const file = tmpFile()
    new Store({ file }).appendMessage(msg({ type: 'topic', id: 't' }))
    const crlf = readFileSync(file, 'utf8').replace(/\n/g, '\r\n')
    const file2 = tmpFile()
    appendFileSync(file2, crlf)
    assert.equal(new Store({ file: file2 }).lastSeq, 1)
  })
})

describe('Store: 未読', () => {
  it('直接宛て・role 宛て・購読トピック宛てだけが未読になる', () => {
    const s = new Store()
    s.ensureMailbox('rev-a', 'reviewer')
    s.ensureMailbox('other')
    s.subscribe('rev-a', 'user.message')
    s.appendMessage(msg({ type: 'mailbox', id: 'rev-a' })) // 1
    s.appendMessage(msg({ type: 'mailbox', id: 'other' })) // 2
    s.appendMessage(msg({ type: 'role', id: 'reviewer' })) // 3
    s.appendMessage(msg({ type: 'role', id: 'deployer' })) // 4
    s.appendMessage(msg({ type: 'topic', id: 'user.message' })) // 5
    s.appendMessage(msg({ type: 'topic', id: 'other.topic' })) // 6
    assert.deepEqual(s.unread('rev-a').map((m) => m.seq), [1, 3, 5])
    assert.deepEqual(s.unread('other').map((m) => m.seq), [2])
  })

  it('作成前の直接宛て・role 宛ては未読になるが、購読前のトピック宛てはならない', () => {
    const s = new Store()
    s.appendMessage(msg({ type: 'mailbox', id: 'late' })) // 1
    s.appendMessage(msg({ type: 'role', id: 'reviewer' })) // 2
    s.appendMessage(msg({ type: 'topic', id: 'user.message' })) // 3
    s.ensureMailbox('late', 'reviewer')
    s.subscribe('late', 'user.message')
    s.appendMessage(msg({ type: 'topic', id: 'user.message' })) // 4
    assert.deepEqual(s.unread('late').map((m) => m.seq), [1, 2, 4])
  })

  it('削除して作り直した Mailbox には削除前の直接宛てを再送しない', () => {
    const s = new Store()
    s.ensureMailbox('x')
    s.appendMessage(msg({ type: 'mailbox', id: 'x' })) // 1
    s.deleteMailbox('x')
    s.appendMessage(msg({ type: 'mailbox', id: 'x' })) // 2
    s.ensureMailbox('x')
    assert.deepEqual(s.unread('x').map((m) => m.seq), [2])
  })

  it('role の既定購読は role を持った時点以降のトピック宛てを含む', () => {
    const s = new Store({ roleSubscriptions: (r) => (r === 'reviewer' ? ['review.request'] : []) })
    s.appendMessage(msg({ type: 'topic', id: 'review.request' })) // 1
    s.ensureMailbox('rev-a', 'reviewer')
    s.appendMessage(msg({ type: 'topic', id: 'review.request' })) // 2
    assert.deepEqual(s.effectiveSubscriptions('rev-a'), ['review.request'])
    assert.deepEqual(s.unread('rev-a').map((m) => m.seq), [2])
  })

  it('ack で cursor が進み、後退や採番済みを超える値は無視する', () => {
    const s = new Store()
    s.ensureMailbox('a')
    s.appendMessage(msg({ type: 'mailbox', id: 'a' })) // 1
    s.appendMessage(msg({ type: 'mailbox', id: 'a' })) // 2
    assert.equal(s.advanceCursor('a', 1), 1)
    assert.equal(s.advanceCursor('a', 0), 1)
    assert.equal(s.advanceCursor('a', 99), 2)
    assert.deepEqual(s.unread('a'), [])
  })

  it('attach し直しても role は指定時だけ変わる', () => {
    const s = new Store()
    assert.equal(s.ensureMailbox('a', 'reviewer').created, true)
    assert.equal(s.ensureMailbox('a').mailbox.role, 'reviewer')
    assert.equal(s.ensureMailbox('a', null).mailbox.role, null)
    assert.equal(s.ensureMailbox('a').created, false)
  })
})

describe('Store: 受領の確認 (received)', () => {
  it('received は cursor も進め、再起動後に戻る。cursor だけ進んだ分は unconfirmed', () => {
    const file = tmpFile()
    const s1 = new Store({ file })
    s1.ensureMailbox('x')
    for (let i = 0; i < 3; i++) s1.appendMessage(msg({ type: 'mailbox', id: 'x' }))
    s1.advanceReceived('x', 1)
    s1.advanceCursor('x', 3)
    assert.deepEqual(s1.unconfirmed('x').map((m) => m.seq), [2, 3])

    const s2 = new Store({ file })
    const mb = s2.getMailbox('x')!
    assert.equal(mb.received, 1)
    assert.equal(mb.cursor, 3)
    assert.deepEqual(s2.unconfirmed('x').map((m) => m.seq), [2, 3])
    assert.equal(s2.advanceReceived('x', 99), 3, '採番済みの seq を超えない')
    assert.equal(s2.advanceReceived('x', 0), 3, '後退しない')
  })

  it('received を持たない前の形式の記録は、received を cursor に追従させる (過去の分を確認待ちに数えない)', () => {
    const file = tmpFile()
    const lines = [
      { op: 'mailbox.create', name: 'x', role: null, createdAt: '2026-10-16T00:00:00.000Z', cursor: 0, seq: 0 },
      { op: 'message', message: { id: 'm_1', seq: 1, ts: '2026-10-16T00:00:01.000Z', ...msg({ type: 'mailbox', id: 'x' }) } },
      { op: 'cursor', name: 'x', cursor: 1 },
    ]
    appendFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
    const s = new Store({ file })
    assert.equal(s.getMailbox('x')!.received, 1)
    assert.deepEqual(s.unconfirmed('x'), [])
    // 復元の後に記録した cursor には追従しない
    s.appendMessage(msg({ type: 'mailbox', id: 'x' }))
    s.advanceCursor('x', 2)
    assert.deepEqual(new Store({ file }).unconfirmed('x').map((m) => m.seq), [2])
  })
})

describe('Store: 溜まりの材料 (summary)', () => {
  // 全件を走査する素朴な数え方。summary は走査を絞っても同じ値を返す
  function naive(s: Store, name: string) {
    const mb = s.getMailbox(name)!
    const tally = () => ({ count: 0, oldestAt: null as string | null })
    const backlog = { unread: tally(), awaitingReply: tally(), unconfirmed: tally() }
    for (const m of s.listMessages(0, Infinity)) {
      const t = m.seq > mb.cursor ? backlog.unread : s.isAwaitingReply(m) ? backlog.awaitingReply : m.seq > mb.received ? backlog.unconfirmed : null
      if (!t || !s.isRecipient(name, m)) continue
      t.count++
      t.oldestAt ??= m.ts
    }
    return { unread: s.unread(name).length, unconfirmed: s.unconfirmed(name).length, backlog }
  }
  const reply = (to: Address, replyTo: string): NewMessage => ({ kind: 'reply', from: { type: 'mailbox', id: 'y', role: null }, to, body: 'r', replyTo })

  it('返信・受領・ack・削除・再起動をまたいでも、全件を走査した値と一致する', () => {
    const file = tmpFile()
    const s = new Store({ file })
    s.ensureMailbox('x', 'reviewer')
    s.ensureMailbox('y')
    s.subscribe('x', 't')
    const toX = { type: 'mailbox', id: 'x' } as const
    const sent = [
      s.appendMessage(msg(toX)),
      s.appendMessage({ ...msg({ type: 'topic', id: 't' }), kind: 'notice' }),
      s.appendMessage(msg({ type: 'role', id: 'reviewer' })),
      s.appendMessage(msg({ type: 'mailbox', id: 'y' })),
      s.appendMessage(msg(toX)),
      s.appendMessage({ ...msg(toX), kind: 'notice' }),
    ]
    const check = (st: Store, label: string) => {
      assert.deepEqual(st.summary('x'), naive(st, 'x'), label)
      assert.deepEqual(st.summary('y'), naive(st, 'y'), label)
    }
    check(s, '全部未読')
    s.advanceReceived('x', 1)
    s.advanceCursor('x', 5)
    check(s, '渡しただけの分がある')
    s.appendMessage(reply(toX, sent[2]!.id))
    check(s, '返信で返信待ちから外れる')
    s.deleteMessages([sent[4]!.id])
    check(s, '消した request は数えない')
    assert.equal(s.summary('x').backlog.awaitingReply.count, 1, '返信のない最初の request だけが残る')
    check(new Store({ file }), '再起動後')
  })
})
