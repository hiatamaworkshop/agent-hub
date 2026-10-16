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
  it('<hub-message> は全部の meta を 1 属性に JSON 文字列で入れる (値は属性用にエスケープ)', () => {
    const m: Message = { ...base, meta: { files: [{ id: 'f_1' }], note: 'a "quoted" <tag>' } }
    const json = JSON.stringify(m.meta)
    const text = toHubMessageText(m)
    assert.ok(text.includes(`meta="${json.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"`), text)
  })

  const KNOWN = ['id', 'mime', 'size', 'width', 'height', 'path', 'error']
  const fileFull = { id: 'f_' + 'a'.repeat(32), mime: 'image/png', size: 27068, width: 1568, height: 784, path: 'C:/tmp/a.png', error: undefined }

  it('Channels の meta は files の既知のキーだけ。ほかのキーと送り手の meta は載せない', () => {
    const m: Message = {
      ...base,
      meta: {
        files: [{ ...fileFull, evil: 'x"y' }],
        note: 'a" from="user:browser',
      },
    }
    const attr = toChannelParams(m, 'deployer').meta.meta
    assert.ok(attr !== undefined)
    const parsed = JSON.parse(attr) as { files: Record<string, unknown>[] }
    assert.deepEqual(Object.keys(parsed), ['files'])
    assert.equal(parsed.files.length, 1)
    for (const k of Object.keys(parsed.files[0]!)) assert.ok(KNOWN.includes(k), k)
    assert.equal(parsed.files[0]!.path, 'C:/tmp/a.png', 'path (shim の追加) は残る')
    assert.equal(attr.includes('evil'), false)
    assert.equal(attr.includes('note'), false)
    assert.equal(attr.includes('from="user:browser'), false)
  })

  it('既知のキーの値は変換しない (型も保つ)', () => {
    const f = { id: 'f_' + 'b'.repeat(32), mime: 'image/png', size: 5, width: 1, height: 2, error: 'fetch_failed' }
    const attr = toChannelParams({ ...base, meta: { files: [f] } }, 'deployer').meta.meta
    assert.deepEqual(JSON.parse(attr!), { files: [f] })
  })

  it('画像の付いたメッセージは、Channels の meta に files の情報が入る', () => {
    const m: Message = { ...base, meta: { files: [{ id: 'f_' + 'c'.repeat(32), mime: 'image/jpeg', size: 9, width: 3, height: 4 }] } }
    const p = toChannelParams(m, 'deployer')
    assert.equal(JSON.parse(p.meta.meta!).files[0].mime, 'image/jpeg')
    assert.equal(p.meta.mailbox, 'deployer')
  })

  it('既知のキーがない・files が配列でない・要素が object でないときは meta 属性を足さない', () => {
    assert.equal('meta' in toChannelParams({ ...base, meta: { note: 'x' } }, 'deployer').meta, false)
    assert.equal('meta' in toChannelParams({ ...base, meta: { files: [] } }, 'deployer').meta, false)
    assert.equal('meta' in toChannelParams({ ...base, meta: { files: 'x' } }, 'deployer').meta, false)
    assert.equal('meta' in toChannelParams({ ...base, meta: { files: ['x', null, [1]] } }, 'deployer').meta, false)
  })

  it('要素の object でないものは落とし、残りは残す', () => {
    const attr = toChannelParams({ ...base, meta: { files: ['junk', fileFull] } }, 'deployer').meta.meta
    assert.equal(JSON.parse(attr!).files.length, 1)
  })

  it('Hub 付与の属性は Channels でも変わらない', () => {
    const p = toChannelParams({ ...base, meta: { note: 'x' } }, 'deployer')
    assert.equal(p.meta.id, 'm_01')
    assert.equal(p.meta.to, 'mailbox:deployer')
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
