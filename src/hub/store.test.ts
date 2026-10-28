import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import type { Address, HubEvent } from '../shared/types.js'
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

  it('作成前の直接宛て・project つきの role 宛ては未読になるが、project のない role 宛てと購読前のトピック宛てはならない', () => {
    const s = new Store()
    s.appendMessage(msg({ type: 'mailbox', id: 'late' })) // 1
    s.appendMessage(msg({ type: 'role', id: 'reviewer' })) // 2
    s.appendMessage(msg({ type: 'topic', id: 'user.message' })) // 3
    s.appendMessage(msg({ type: 'role', id: 'reviewer', project: 'C:\\work\\late' })) // 4
    s.ensureMailbox('late', 'reviewer')
    s.setProject('late', 'C:\\work\\late')
    s.subscribe('late', 'user.message')
    s.appendMessage(msg({ type: 'topic', id: 'user.message' })) // 5
    s.appendMessage(msg({ type: 'role', id: 'reviewer' })) // 6
    assert.deepEqual(s.unread('late').map((m) => m.seq), [1, 4, 5, 6])
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
    const tally = () => ({ count: 0, oldestAt: null as string | null, oldestSeq: null as number | null })
    const outgoing = { ...tally(), to: [] as Array<{ type: Address['type']; id: string } & ReturnType<typeof tally>> }
    const backlog = {
      unread: tally(),
      awaitingReply: tally(),
      unconfirmed: tally(),
      outgoing,
      lastHanded: null as { seq: number; ts: string } | null,
      lastEvent: null as { id: string; kind: string; ts: string; sessionId?: string; detail?: string } | null,
      lastTurnEnd: null as { id: string; ts: string; running?: { count: number; description: string } } | null,
    }
    for (const e of s.listEvents(Infinity)) {
      if (e.mailbox !== name || e.superseded) continue
      const p = e.payload as Record<string, unknown>
      const d = e.kind === 'turn.failed' ? p.error : e.kind === 'notification' ? p.notification_type : e.kind === 'permission.resolved' ? p.tool_name : undefined
      backlog.lastEvent = { id: e.id, kind: e.kind, ts: e.ts, ...(e.sessionId ? { sessionId: e.sessionId } : {}), ...(typeof d === 'string' && d ? { detail: d } : {}) }
      if (e.kind === 'turn.end') {
        const tasks = Array.isArray(p.background_tasks) ? (p.background_tasks as Array<{ status?: unknown; description?: unknown }>) : []
        const running = tasks.filter((t) => t && t.status === 'running')
        const d = running[0]?.description
        backlog.lastTurnEnd = { id: e.id, ts: e.ts, ...(running.length ? { running: { count: running.length, description: typeof d === 'string' ? d : '' } } : {}) }
      }
    }
    for (const m of s.listMessages(0, Infinity)) {
      if (s.isAwaitingReply(m) && m.from.type === 'mailbox' && m.from.id === name) {
        outgoing.count++
        outgoing.oldestAt ??= m.ts
        outgoing.oldestSeq ??= m.seq
        let to = outgoing.to.find((a) => a.type === m.to.type && a.id === m.to.id)
        if (!to) outgoing.to.push((to = { type: m.to.type, id: m.to.id, count: 0, oldestAt: null, oldestSeq: null }))
        to.count++
        to.oldestAt ??= m.ts
        to.oldestSeq ??= m.seq
      }
      if (m.seq <= mb.cursor && s.isRecipient(name, m)) backlog.lastHanded = { seq: m.seq, ts: m.ts }
      const t = m.seq > mb.cursor ? backlog.unread : s.isAwaitingReply(m) ? backlog.awaitingReply : m.seq > mb.received ? backlog.unconfirmed : null
      if (!t || !s.isRecipient(name, m)) continue
      t.count++
      t.oldestAt ??= m.ts
      t.oldestSeq ??= m.seq
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

  it('oldestSeq は溜まりの最も古い Message の seq で、消した後は次に古いもの', () => {
    const s = new Store()
    s.ensureMailbox('x')
    const toX = { type: 'mailbox', id: 'x' } as const
    const a = s.appendMessage(msg(toX))
    const b = s.appendMessage(msg(toX))
    s.advanceCursor('x', b.seq)
    assert.equal(s.summary('x').backlog.awaitingReply.oldestSeq, a.seq)
    s.deleteMessages([a.id])
    assert.equal(s.summary('x').backlog.awaitingReply.oldestSeq, b.seq, '消した後は次に古いもの')
    s.deleteMessages([b.id])
    assert.equal(s.summary('x').backlog.awaitingReply.oldestSeq, null, '溜まりがなければ null')
    const c = s.appendMessage(msg(toX))
    assert.equal(s.summary('x').backlog.unread.oldestSeq, c.seq, '未読も seq を返す')
  })

  it('最後に渡した Message は、cursor が進んだ分だけ見直しても全件の走査と同じ (削除・role・購読の変化をまたぐ)', () => {
    const s = new Store()
    s.ensureMailbox('x', 'reviewer')
    const toX = { type: 'mailbox', id: 'x' } as const
    const check = (label: string) => assert.deepEqual(s.summary('x'), naive(s, 'x'), label)
    check('何も渡していない')
    const a = s.appendMessage(msg(toX))
    s.appendMessage(msg({ type: 'mailbox', id: 'y' }))
    const b = s.appendMessage(msg({ type: 'role', id: 'reviewer' }))
    s.advanceCursor('x', a.seq)
    check('1 件目まで')
    s.advanceCursor('x', b.seq)
    check('宛先でない Message をまたいで 3 件目まで')
    s.deleteMessages([b.id])
    check('覚えていた Message を消した')
    s.ensureMailbox('x', 'writer')
    check('role が変わった (role 宛ては数えない)')
    const t = s.appendMessage(msg({ type: 'topic', id: 't' }))
    s.subscribe('x', 't')
    s.advanceCursor('x', t.seq)
    check('購読より前のトピック宛ては数えない')
    const later = s.appendMessage(msg({ type: 'topic', id: 't' }))
    s.advanceCursor('x', later.seq)
    check('購読した後のトピック宛て')
    assert.equal(s.summary('x').backlog.lastHanded?.seq, later.seq)
  })

  it('Mailbox ごとの最新の Event とターン終了を返し、切り離されたセッションの分と消した分を除く', () => {
    const s = new Store()
    s.ensureMailbox('x')
    let n = 0
    const ev = (kind: HubEvent['kind'], extra: Partial<HubEvent> = {}): HubEvent => {
      const e: HubEvent = { id: `e_${++n}`, ts: `2026-10-23T00:00:${String(n).padStart(2, '0')}.000Z`, kind, source: 'claude-code', mailbox: 'x', payload: {}, ...extra }
      s.addEvent(e)
      return e
    }
    const check = (label: string) => assert.deepEqual(s.summary('x'), naive(s, 'x'), label)
    check('Event がない')
    const end = ev('turn.end')
    const q = ev('question', { sessionId: 's1' })
    ev('turn.end', { superseded: true })
    ev('turn.end', { mailbox: 'y' })
    check('質問が最新、ターン終了は前のもの')
    assert.deepEqual(s.summary('x').backlog.lastEvent, { id: q.id, kind: 'question', ts: q.ts, sessionId: 's1' })
    assert.deepEqual(s.summary('x').backlog.lastTurnEnd, { id: end.id, ts: end.ts })
    // 止まった理由と通知の種類は detail に載る (payload を持たない UI が Paused を導く材料。C38)
    const failed = ev('turn.failed', { payload: { error: 'rate_limit' } })
    check('turn.failed が最新')
    assert.equal(s.summary('x').backlog.lastEvent?.detail, 'rate_limit')
    const resumed = ev('notification', { payload: { notification_type: 'quota_auto_resume_fired' } })
    check('通知が最新')
    assert.equal(s.summary('x').backlog.lastEvent?.detail, 'quota_auto_resume_fired')
    const approved = ev('permission.resolved', { payload: { tool_name: 'Bash' } })
    check('許可の解除が最新')
    assert.equal(s.summary('x').backlog.lastEvent?.detail, 'Bash')
    const later = ev('turn.end', { payload: { error: 'x' } })
    assert.equal(s.summary('x').backlog.lastEvent?.detail, undefined, 'turn.end には detail を付けない')
    // ターンを終えた時点で走っていたバックグラウンドの処理は lastTurnEnd.running に載る (C43)。終わった処理は数えない
    const bg = ev('turn.end', {
      payload: {
        background_tasks: [
          { id: 'b1', type: 'shell', status: 'completed', description: 'build' },
          { id: 'b2', type: 'shell', status: 'running', description: 'npm test' },
          { id: 'b3', type: 'shell', status: 'running' },
        ],
      },
    })
    check('走っている処理のあるターン終了')
    assert.deepEqual(s.summary('x').backlog.lastTurnEnd, { id: bg.id, ts: bg.ts, running: { count: 2, description: 'npm test' } })
    const done = ev('turn.end', { payload: { background_tasks: [] } })
    check('処理が終わった後のターン終了')
    assert.deepEqual(s.summary('x').backlog.lastTurnEnd, { id: done.id, ts: done.ts })
    s.deleteEvents([q.id, end.id, failed.id, resumed.id, approved.id, later.id, bg.id, done.id])
    check('消した後は残っている中の最新')
    assert.equal(s.summary('x').backlog.lastEvent, null)
  })

  it('詰め直したファイルでは閉じた request を導き直さず、動いていたときの結果を保つ (C28)', () => {
    const file = tmpFile()
    const s = new Store({ file })
    s.ensureMailbox('lead', 'leader')
    // project のある role 宛て。lead に project がまだないので、lead の Message はこれを閉じない
    const r = s.appendMessage(msg({ type: 'role', id: 'leader', project: 'C:\\work\\demo' }))
    s.appendMessage({ kind: 'request', from: { type: 'mailbox', id: 'lead', role: 'leader' }, to: { type: 'user', id: 'browser' }, body: 'q' })
    s.setProject('lead', 'C:\\work\\demo')
    const isOpen = (st: Store) => st.isAwaitingReply(st.getMessage(r.id)!)
    assert.equal(isOpen(s), true)
    assert.equal(isOpen(new Store({ file })), true, '再起動しても同じ (前にある行が同じ)')
    const noise = s.appendMessage(msg({ type: 'topic', id: 'none' }))
    s.deleteMessages([noise.id])
    assert.ok(s.compact())
    assert.equal(isOpen(new Store({ file })), true, '詰め直しの後も、今の project で導き直さない')
  })

  it('相手からの後の Message で閉じた request は、再起動と詰め直しの後も閉じたまま (C28)', () => {
    const file = tmpFile()
    const s = new Store({ file })
    s.ensureMailbox('lead', 'leader')
    s.ensureMailbox('dep', 'deployer')
    const asLead = { type: 'mailbox', id: 'lead', role: 'leader' } as const
    const first = s.appendMessage({ kind: 'request', from: asLead, to: { type: 'role', id: 'deployer' }, body: 'C4' })
    const fix = s.appendMessage({ kind: 'request', from: asLead, to: { type: 'mailbox', id: 'dep' }, body: 'fix' })
    s.advanceCursor('dep', fix.seq)
    const done = s.appendMessage({ kind: 'reply', from: { type: 'mailbox', id: 'dep', role: 'deployer' }, to: { type: 'mailbox', id: 'lead' }, body: 'r', replyTo: first.id })
    const open = (st: Store) => st.listMessages(0, Infinity).filter((m) => st.isAwaitingReply(m))
    assert.deepEqual(open(s), [])
    assert.equal(s.getMailbox('dep')!.received, fix.seq, '渡してあった依頼の seq まで確認になる')

    const again = new Store({ file })
    assert.deepEqual(open(again), [], '再起動後')
    for (const name of ['lead', 'dep']) assert.deepEqual(again.summary(name), naive(again, name))
    // 閉じた Message が消えても、詰め直しの replied の行で閉じたまま残る
    again.deleteMessages([done.id])
    assert.ok(again.compact())
    const compacted = new Store({ file })
    assert.deepEqual(open(compacted).map((m) => m.id), [])
    assert.equal(compacted.getMailbox('dep')!.received, fix.seq)
  })
})
