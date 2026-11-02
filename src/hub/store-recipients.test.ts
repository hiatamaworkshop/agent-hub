import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import type { Message } from '../shared/types.js'
import { Store, type NewMessage } from './store.js'

// C99: Message は送った時点の受け手を記録する。記録は再起動と詰め直しの後も残り、前の形式の行は今の状態で判定する
const dir = mkdtempSync(join(tmpdir(), 'agent-hub-recipients-'))
after(() => rmSync(dir, { recursive: true, force: true }))

let n = 0
const tmpFile = () => join(dir, `hub-${++n}.jsonl`)

const user = { type: 'user', id: 'browser', role: null } as const

describe('Store: 送った時点の受け手 (C99)', () => {
  it('送った時点の受け手を記録し、後で購読や role が変わっても判定は変わらない', () => {
    const s = new Store()
    s.ensureMailbox('x', 'reviewer')
    s.subscribe('x', 't')
    const m: NewMessage = { kind: 'request', from: user, to: { type: 'topic', id: 't' }, body: 'b' }
    const sent = s.appendMessage(m)
    s.unsubscribe('x', 't')
    s.ensureMailbox('x', 'deployer')
    assert.equal(s.isRecipient('x', sent), false, '今の状態では受け手でない')
    assert.equal(s.hasReceived('x', sent), true, '送った時点の受け手')
    assert.equal(s.oldestOpenRequestTo('x')?.id, sent.id)
  })

  it('送る時点で受け手でなかった Mailbox は、後から受け手になっても記録に入らない', () => {
    const s = new Store()
    const sent = s.appendMessage({ kind: 'request', from: user, to: { type: 'role', id: 'reviewer' }, body: 'b' })
    s.ensureMailbox('late', 'reviewer')
    assert.equal(s.isRecipient('late', sent), false, '送った後に作られた Mailbox は、role 宛てでも受け手でない')
    assert.equal(s.hasReceived('late', sent), false)
  })

  it('送る時点になかった Mailbox も、後から作られた project の role 宛て・直接宛ては受け取った分として返信できる', () => {
    const s = new Store()
    const byRole = s.appendMessage({ kind: 'request', from: user, to: { type: 'role', id: 'deployer', project: 'C:\\work\\demo' }, body: 'b' })
    const direct = s.appendMessage({ kind: 'request', from: user, to: { type: 'mailbox', id: 'later' }, body: 'b' })
    s.ensureMailbox('later', 'deployer')
    s.setProject('later', 'C:\\work\\demo')
    assert.equal(s.hasReceived('later', byRole), true)
    assert.equal(s.hasReceived('later', direct), true)
  })

  it('再起動と詰め直しの後も記録は残る', () => {
    const file = tmpFile()
    const s1 = new Store({ file })
    s1.ensureMailbox('x', 'reviewer')
    const sent = s1.appendMessage({ kind: 'request', from: user, to: { type: 'role', id: 'reviewer' }, body: 'b' })
    s1.ensureMailbox('x', 'deployer')
    const noise = s1.appendMessage({ kind: 'notice', from: user, to: { type: 'user', id: 'browser' }, body: 'n' })
    s1.deleteMessages([noise.id])
    assert.ok(s1.compact())

    const s2 = new Store({ file })
    const again = s2.getMessage(sent.id)!
    assert.equal(s2.hasReceived('x', again), true, '再起動後も、今の role (deployer) に関係なく受け手のまま')
    assert.equal(s2.oldestOpenRequestTo('x')?.id, sent.id)
    // もう一度詰め直しても記録は残る (compact は recipients を書く)
    const noise2 = s2.appendMessage({ kind: 'notice', from: user, to: { type: 'user', id: 'browser' }, body: 'n2' })
    s2.deleteMessages([noise2.id])
    assert.ok(s2.compact())
    const s3 = new Store({ file })
    assert.equal(s3.hasReceived('x', s3.getMessage(sent.id)!), true, '詰め直した後も')
  })

  it('記録のない前の形式の Message は、今の状態で判定する (読めないことはない)', () => {
    const file = tmpFile()
    const s1 = new Store({ file })
    s1.ensureMailbox('x', 'reviewer')
    // 記録の前の形式の行 (recipients がない) を直接書く
    const legacy: Message = { id: 'm_legacy', seq: 1, ts: new Date().toISOString(), kind: 'request', from: user, to: { type: 'role', id: 'reviewer' }, body: 'old' }
    appendFileSync(file, JSON.stringify({ op: 'message', message: legacy }) + '\n')
    const s2 = new Store({ file })
    assert.equal(s2.lastSeq, 1)
    assert.equal(s2.hasReceived('x', legacy), true, '記録がないので今の受け手で代用')
    assert.equal(s2.oldestOpenRequestTo('x')?.id, 'm_legacy')
    assert.equal(readFileSync(file, 'utf8').includes('"recipients"'), false, '前の形式の行は書き換えない')
  })
})

describe('Store: 送った時点か今の受け手 (C114)', () => {
  const P = 'C:\work\p'
  it('送った時点に project のなかった Mailbox が、後でその project になると受け取った分になる。再起動と詰め直しの後も', () => {
    const file = tmpFile()
    const s1 = new Store({ file })
    s1.ensureMailbox('x', 'deployer')
    const sent = s1.appendMessage({ kind: 'request', from: user, to: { type: 'role', id: 'deployer', project: P }, body: 'b' })
    assert.equal(s1.hasReceived('x', sent), false, 'まだ渡されていない')
    s1.setProject('x', P)
    assert.equal(s1.hasReceived('x', sent), true, '今の受け手')
    const noise = s1.appendMessage({ kind: 'notice', from: user, to: { type: 'user', id: 'browser' }, body: 'n' })
    s1.deleteMessages([noise.id])
    assert.ok(s1.compact())
    const s2 = new Store({ file })
    assert.equal(s2.hasReceived('x', s2.getMessage(sent.id)!), true)
    assert.equal(s2.oldestOpenRequestTo('x')?.id, sent.id)
  })

  it('known は書かない。known のある古い行も読める', () => {
    const file = tmpFile()
    const s1 = new Store({ file })
    s1.ensureMailbox('x', 'reviewer')
    s1.appendMessage({ kind: 'request', from: user, to: { type: 'role', id: 'reviewer' }, body: 'b' })
    assert.equal(readFileSync(file, 'utf8').includes('"known"'), false, '新しい行に known はない')
    const old: Message = { id: 'm_known', seq: 2, ts: new Date().toISOString(), kind: 'request', from: user, to: { type: 'role', id: 'reviewer' }, body: 'old' }
    appendFileSync(file, JSON.stringify({ op: 'message', message: old, recipients: [], known: ['x', 'y'] }) + '\n')
    const s2 = new Store({ file })
    assert.equal(s2.lastSeq, 2)
    assert.equal(s2.hasReceived('x', s2.getMessage('m_known')!), true, '記録の受け手になくても、今の受け手 (role reviewer、seq が後) なら受け取った分')
  })
})
