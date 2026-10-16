import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { toChannelParams, toHubMessageText } from './format.js'
import { postMessageSchema, type Message } from './types.js'

const base: Message = {
  id: 'm_01',
  seq: 1,
  ts: '2026-01-01T00:00:00.000Z',
  kind: 'request',
  from: { type: 'user', id: 'browser', role: null },
  to: { type: 'mailbox', id: 'deployer' },
  body: 'look',
}

describe('meta の配信属性', () => {
  it('meta があれば 1 属性に JSON 文字列で入れる (Channels と <hub-message> の両方)', () => {
    const m: Message = { ...base, meta: { files: [{ id: 'f_1' }], note: 'a "quoted" <tag>' } }
    const json = JSON.stringify(m.meta)
    assert.equal(toChannelParams(m, 'deployer').meta.meta, json)
    const text = toHubMessageText(m)
    assert.ok(text.includes(`meta="${json.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"`), text)
  })

  it('meta がなければ属性を足さない。空オブジェクトも足さない', () => {
    assert.equal('meta' in toChannelParams(base, 'deployer').meta, false)
    assert.equal('meta' in toChannelParams({ ...base, meta: {} }, 'deployer').meta, false)
    assert.ok(!toHubMessageText({ ...base, meta: {} }).includes(' meta="'))
  })
})

describe('postMessageSchema: meta', () => {
  const input = { kind: 'request', to: { type: 'topic', id: 'user.message' }, body: 'x' }

  it('キーは英小文字で始まり、英数字とアンダースコアだけ', () => {
    assert.equal(postMessageSchema.safeParse({ ...input, meta: { ok_key1: 1 } }).success, true)
    assert.equal(postMessageSchema.safeParse({ ...input, meta: { Bad: 1 } }).success, false)
    assert.equal(postMessageSchema.safeParse({ ...input, meta: { '1x': 1 } }).success, false)
    assert.equal(postMessageSchema.safeParse({ ...input, meta: { 'a-b': 1 } }).success, false)
    assert.equal(postMessageSchema.safeParse({ ...input, meta: { ['a'.repeat(33)]: 1 } }).success, false)
  })

  it('直列化して 8KB まで', () => {
    assert.equal(postMessageSchema.safeParse({ ...input, meta: { big: 'x'.repeat(8000) } }).success, true)
    assert.equal(postMessageSchema.safeParse({ ...input, meta: { big: 'x'.repeat(9000) } }).success, false)
  })

  it('配列や文字列は meta に使えない', () => {
    assert.equal(postMessageSchema.safeParse({ ...input, meta: [1] }).success, false)
    assert.equal(postMessageSchema.safeParse({ ...input, meta: 'x' }).success, false)
  })
})
