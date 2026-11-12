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

  it('Channels の meta は既知のキー (files の既知の要素キーと item) だけ。ほかのキーは載せない', () => {
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

  const item = { id: 'C160', project: 'C:\\work\\agent-hub', source: 'docs/roadmap.md', promise: 'p1', conditions: ['a "quoted" <tag> & more'] }

  it('既知のキー item は通る。値は変換せず、JSON 文字列そのものが属性になる', () => {
    const attr = toChannelParams({ ...base, meta: { item } }, 'deployer').meta.meta
    assert.equal(attr, JSON.stringify({ item }))
    assert.deepEqual(JSON.parse(attr!), { item })
  })

  it('既知のキーでないキーは落とす (item と一緒でも)', () => {
    const attr = toChannelParams({ ...base, meta: { item, note: 'x', evil: { severity: 'high' } } }, 'deployer').meta.meta
    assert.deepEqual(Object.keys(JSON.parse(attr!)), ['item'])
    assert.equal(attr!.includes('note'), false)
    assert.equal(attr!.includes('evil'), false)
  })

  it('item は ID が ^C[1-9][0-9]*$ の形のときだけ通す (C163): 有効な ID は通る', () => {
    const good = { id: 'C163', project: 'C:\\work\\agent-hub', source: null, promise: null }
    const attr = toChannelParams({ ...base, meta: { item: good } }, 'deployer').meta.meta
    assert.deepEqual(JSON.parse(attr!), { item: good })
    assert.deepEqual(JSON.parse(toChannelParams({ ...base, meta: { item: 'C163' } }, 'deployer').meta.meta!), { item: 'C163' })
  })

  it('item は ID が形に合わないなら落とす (C163)', () => {
    for (const id of ['c163', 'C0', 'C01', 'C1 ', 'X1', 'C1\nC2', 'C1\n', '', 'C']) {
      const p = toChannelParams({ ...base, meta: { item: { id, project: 'p' } } }, 'deployer')
      assert.equal('meta' in p.meta, false, JSON.stringify(id))
      const s = toChannelParams({ ...base, meta: { item: id } }, 'deployer')
      assert.equal('meta' in s.meta, false, JSON.stringify(id))
    }
  })

  it('item が文字列でない・ID がない値は落とす (C163): 数・null・配列・ID のない object・ID が文字列でない object', () => {
    const bad: unknown[] = [1, null, ['C1'], true, {}, { id: 5 }, { id: null }, { id: ['C1'] }]
    for (const item of bad) {
      const p = toChannelParams({ ...base, meta: { item } }, 'deployer')
      assert.equal('meta' in p.meta, false, JSON.stringify(item))
    }
  })

  it('item が落ちても files は残る。落ちた item は属性に入らない (C163)', () => {
    const f = { id: 'f_' + 'e'.repeat(32), mime: 'image/png', size: 1, width: 1, height: 1 }
    const attr = toChannelParams({ ...base, meta: { files: [f], item: { id: 'x1' } } }, 'deployer').meta.meta!
    assert.deepEqual(Object.keys(JSON.parse(attr)), ['files'])
    assert.equal(attr.includes('x1'), false)
  })

  it('値の " < > & は変換せず、そのまま属性値の JSON に入る', () => {
    const m: Message = { ...base, meta: { files: [{ id: 'f_' + 'd'.repeat(32), mime: 'image/png', size: 1, width: 1, height: 1, error: 'a"b<c>&d' }], item } }
    const attr = toChannelParams(m, 'deployer').meta.meta!
    assert.equal(attr.includes('&quot;') || attr.includes('&lt;') || attr.includes('&gt;') || attr.includes('&amp;'), false, attr)
    const parsed = JSON.parse(attr) as { files: { error: string }[]; item: typeof item }
    assert.equal(parsed.files[0]!.error, 'a"b<c>&d')
    assert.equal(parsed.item.conditions[0], 'a "quoted" <tag> & more')
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
