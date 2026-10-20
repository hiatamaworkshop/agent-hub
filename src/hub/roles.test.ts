import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { createApp } from './app.js'
import { HubError, Hub } from './hub.js'
import { loadRoles, parseRoles, RolesError } from './roles.js'
import { Store } from './store.js'
import type { Message } from '../shared/types.js'

const dir = mkdtempSync(join(tmpdir(), 'roles-test-'))
after(() => rmSync(dir, { recursive: true, force: true }))

const valid = {
  reviewer: { description: '変更のレビュー担当', subscribe: ['review.request'] },
  deployer: { description: 'デプロイ担当', subscribe: [] },
}

describe('loadRoles: ファイルの有無', () => {
  it('ファイルがなければ null (P0 と同じ動き)', () => {
    assert.equal(loadRoles(join(dir, 'absent.json')), null)
  })

  it('読めるファイルは role 名の Map になり、既定購読と説明を持つ', () => {
    const file = join(dir, 'roles.json')
    writeFileSync(file, JSON.stringify(valid))
    const roles = loadRoles(file)!
    assert.deepEqual([...roles.keys()], ['reviewer', 'deployer'])
    assert.equal(roles.get('reviewer')?.description, '変更のレビュー担当')
    assert.deepEqual(roles.get('reviewer')?.subscribe, ['review.request'])
  })

  it('ファイルとして読めないもの (ディレクトリ) は RolesError で、ファイル名を含む', () => {
    const sub = join(dir, 'a-dir')
    mkdirSync(sub)
    assert.throws(() => loadRoles(sub), (e: unknown) => e instanceof RolesError && e.message.includes('a-dir'))
  })
})

describe('parseRoles: 形の検証', () => {
  const bad: [string, string, RegExp][] = [
    ['JSON として壊れている', '{"reviewer": {', /JSON として読めない/],
    ['空のファイル', '', /JSON として読めない/],
    ['配列 (オブジェクトでない)', '[]', /role 名をキーにしたオブジェクト/],
    ['null', 'null', /role 名をキーにしたオブジェクト/],
    ['role 名が規則に合わない', '{"Bad Name": {"description": "x", "subscribe": []}}', /role 名は/],
    ['role の値がオブジェクトでない', '{"reviewer": "レビュー"}', /オブジェクトであること/],
    ['description がない', '{"reviewer": {"subscribe": []}}', /description は文字列/],
    ['description が文字列でない', '{"reviewer": {"description": 3, "subscribe": []}}', /description は文字列/],
    ['subscribe がない', '{"reviewer": {"description": "x"}}', /subscribe はトピック名の配列/],
    ['subscribe が配列でない', '{"reviewer": {"description": "x", "subscribe": "review.request"}}', /subscribe はトピック名の配列/],
    ['subscribe のトピック名が規則に合わない', '{"reviewer": {"description": "x", "subscribe": ["Review Request"]}}', /"Review Request" はトピック名/],
    ['subscribe の要素が文字列でない', '{"reviewer": {"description": "x", "subscribe": [1]}}', /1 はトピック名/],
  ]
  for (const [label, text, message] of bad) {
    it(`${label} は RolesError で、ファイル名と場所を示す`, () => {
      assert.throws(() => parseRoles(text, 'roles.json'), (e: unknown) => e instanceof RolesError && message.test(e.message) && e.message.includes('roles.json'))
    })
  }

  it('未知の項目は読み捨てず、role の定義に残す (後のメッセージ形の宣言のため)', () => {
    const roles = parseRoles(JSON.stringify({ reviewer: { description: 'x', subscribe: [], accepts: ['review'] } }))
    assert.deepEqual(roles.get('reviewer')?.accepts, ['review'])
  })
})

// Hub と Store を role 定義つきで組む。main.ts と同じ配線
function hubWith(roles: ReturnType<typeof parseRoles> | null) {
  const store = new Store({ roleSubscriptions: (role) => roles?.get(role)?.subscribe ?? [] })
  return { hub: new Hub(store, { roles }), store }
}
const cli = { type: 'user', id: 'cli', role: null } as const

describe('Hub: role の検証と説明 (roles.json がある場合)', () => {
  const roles = parseRoles(JSON.stringify(valid))

  it('定義にない role での attach は 400 unknown_role で、Mailbox を作らない', () => {
    const { hub, store } = hubWith(roles)
    assert.throws(() => hub.attach('x', { client: 'claude-code', role: 'reviwer' }), (e: unknown) => e instanceof HubError && e.status === 400 && e.code === 'unknown_role')
    assert.equal(store.getMailbox('x'), undefined)
  })

  it('定義にある role での attach は通り、roleDescription に説明を返す', () => {
    const { hub } = hubWith(roles)
    const at = hub.attach('rev-a', { client: 'claude-code', role: 'reviewer' })
    assert.equal(at.role, 'reviewer')
    assert.equal(at.roleDescription, '変更のレビュー担当')
  })

  it('role を省いた attach は既存の role を保ち、その説明を返す。role がなければ null', () => {
    const { hub } = hubWith(roles)
    hub.attach('rev-a', { client: 'claude-code', role: 'reviewer' })
    assert.equal(hub.attach('rev-a', { client: 'claude-code' }).roleDescription, '変更のレビュー担当')
    assert.equal(hub.attach('plain', { client: 'claude-code' }).roleDescription, null)
    assert.equal(hub.attach('plain', { client: 'claude-code', role: null }).roleDescription, null)
  })

  it('実効購読は role の既定購読と個別購読の和。role の既定は unsubscribe で外れない', () => {
    const { hub, store } = hubWith(roles)
    hub.attach('rev-a', { client: 'claude-code', role: 'reviewer' })
    hub.subscribe('rev-a', 'news')
    assert.deepEqual(store.effectiveSubscriptions('rev-a'), ['news', 'review.request'])

    hub.unsubscribe('rev-a', 'review.request') // 個別購読にないので何も変わらない
    assert.deepEqual(store.effectiveSubscriptions('rev-a'), ['news', 'review.request'])
    hub.unsubscribe('rev-a', 'news')
    assert.deepEqual(store.effectiveSubscriptions('rev-a'), ['review.request'])
  })

  it('role を持つ前に届いた role 既定のトピック宛ては未読にならず、持った後のものは届く', () => {
    const { hub, store } = hubWith(roles)
    const before = hub.postMessage({ kind: 'request', to: { type: 'topic', id: 'review.request' }, body: 'before' }, cli)
    hub.attach('rev-a', { client: 'claude-code', role: 'reviewer' })
    const after = hub.postMessage({ kind: 'request', to: { type: 'topic', id: 'review.request' }, body: 'after' }, cli)
    assert.deepEqual(store.unread('rev-a').map((m: Message) => m.id), [after.id])
    assert.notEqual(before.id, after.id)
  })

  it('role 宛て (to: role:reviewer) は、その role を持つ Mailbox だけが受け取る', () => {
    const { hub, store } = hubWith(roles)
    hub.attach('rev-a', { client: 'claude-code', role: 'reviewer' })
    hub.attach('dep', { client: 'claude-code', role: 'deployer' })
    const m = hub.postMessage({ kind: 'request', to: { type: 'role', id: 'reviewer' }, body: 'to reviewers' }, cli)
    assert.deepEqual(store.unread('rev-a').map((x: Message) => x.id), [m.id])
    assert.deepEqual(store.unread('dep').map((x: Message) => x.id), [])
  })
})

describe('Hub: roles.json がない場合 (P0 と同じ動き)', () => {
  it('role 名は検証せず、説明は null で、既定購読もない', () => {
    const { hub, store } = hubWith(null)
    const at = hub.attach('x', { client: 'claude-code', role: 'anything-goes' })
    assert.equal(at.role, 'anything-goes')
    assert.equal(at.roleDescription, null)
    assert.deepEqual(store.effectiveSubscriptions('x'), [])
    assert.equal(hub.listRoles(), null)
  })
})

describe('GET /roles (design.md §3.15 の「プロジェクトは値」)', () => {
  it('roles.json の role を名前・説明・既定購読で返す。未知の項目は出さない。ファイルがなければ null', async () => {
    const roles = parseRoles(JSON.stringify({ reviewer: { description: 'r', subscribe: ['review.request'], accepts: ['review'] }, deployer: { description: 'd', subscribe: [] } }))
    const get = async (hub: Hub) => {
      const app = createApp({ hub, token: 'test-token-0123456789', uiHtml: async () => null })
      return (await (await app.request('/roles', { headers: { authorization: 'Bearer test-token-0123456789' } })).json()) as { roles: unknown }
    }
    assert.deepEqual(await get(hubWith(roles).hub), {
      roles: [
        { name: 'reviewer', description: 'r', subscribe: ['review.request'] },
        { name: 'deployer', description: 'd', subscribe: [] },
      ],
    })
    assert.deepEqual(await get(hubWith(null).hub), { roles: null })
  })
})
