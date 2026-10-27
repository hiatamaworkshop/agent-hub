import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { parseRoadmap } from '../shared/roadmap.js'
import { createApp } from './app.js'
import { Hub, type UiEvent } from './hub.js'
import { IndexStore } from './indexes.js'
import { Store } from './store.js'

const TOKEN = 'test-token-0123456789'
const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

const roadmap = ['## 項目', '### C3. 題', '#### 完了条件', '- [x] a', '- [ ] b', '### C4. 提案', '状態: 提案'].join('\n')

function setup(indexes: IndexStore | null = new IndexStore(undefined, () => new Date('2026-10-19T00:00:00Z'))) {
  const hub = new Hub(new Store())
  const ui: UiEvent[] = []
  hub.onUi((e) => ui.push(e))
  const app = createApp({ hub, token: TOKEN, uiHtml: async () => null, ...(indexes ? { indexes } : {}) })
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = auth) =>
    app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { call, ui }
}

describe('PUT /indexes と GET /indexes (design.md §3.15)', () => {
  it('parseRoadmap の結果をそのまま受け取り、余分なキーを落として返す。UI に index.updated を流す', async () => {
    const { call, ui } = setup()
    const res = await call('PUT', '/indexes', { project: 'C:\\work\\vcp', source: 'docs/roadmap.md', ...parseRoadmap(roadmap) })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { project: 'C:\\work\\vcp', source: 'docs/roadmap.md', updatedAt: '2026-10-19T00:00:00.000Z', items: 2 })
    assert.deepEqual(ui, [{ event: 'index.updated', data: { project: 'C:\\work\\vcp', source: 'docs/roadmap.md', updatedAt: '2026-10-19T00:00:00.000Z' } }])

    const { indexes } = (await (await call('GET', '/indexes')).json()) as { indexes: { items: Record<string, unknown>[] }[] }
    assert.equal(indexes.length, 1)
    const c3 = indexes[0]!.items[0]!
    assert.deepEqual(Object.keys(c3).sort(), ['conditionChecks', 'conditionTexts', 'conditions', 'id', 'line', 'promise', 'status', 'title'])
    assert.deepEqual(c3.conditionTexts, ['a', 'b'])
    assert.deepEqual(c3.conditionChecks, [true, false], '1 行ずつのチェックを持つ')
  })

  it('完了条件の 1 行ずつのチェックは省略できる (古い形の索引も受ける)', async () => {
    const { call } = setup()
    const old = { id: 'C3', title: '題', status: 'decided', conditionTexts: ['a'], conditions: { done: 0, total: 1 }, promise: null, line: 1 }
    assert.equal((await call('PUT', '/indexes', { project: '/w/a', source: 'docs/roadmap.md', items: [old] })).status, 200)
    assert.equal((await call('PUT', '/indexes', { project: '/w/a', source: 'docs/roadmap.md', items: [{ ...old, conditionChecks: [true, 'x'] }] })).status, 400, '真偽の配列でなければ 400')
    const { indexes } = (await (await call('GET', '/indexes')).json()) as { indexes: { items: Record<string, unknown>[] }[] }
    assert.equal(indexes[0]!.items[0]!.conditionChecks, undefined, '送らない行は持たない (UI は印を出さない)')
  })

  it('予定 (plan) と閉じた行 (closed) を持ち、GET で返す。送らない古い形は plan が null、closed が空', async () => {
    const { call } = setup()
    const plan = [
      { id: 'C4', line: 9 },
      { id: 'C3', line: 8 },
    ]
    const closed = [{ id: 'C1', mark: 'x', date: '2026-10-27', line: 30 }]
    await call('PUT', '/indexes', { project: '/w/a', source: 'docs/roadmap.md', ...parseRoadmap(roadmap), plan, closed })
    await call('PUT', '/indexes', { project: '/w/b', source: 'docs/roadmap.md', items: parseRoadmap(roadmap).items })
    const { indexes } = (await (await call('GET', '/indexes')).json()) as { indexes: { project: string; plan: unknown; closed: unknown }[] }
    const a = indexes.find((i) => i.project === '/w/a')!
    const b = indexes.find((i) => i.project === '/w/b')!
    assert.deepEqual(a.plan, plan, '並びを保つ')
    assert.deepEqual(a.closed, closed)
    assert.equal(b.plan, null, '予定を送らない古い形は null')
    assert.deepEqual(b.closed, [])
  })

  it('予定と閉じた行の形が違えば 400', async () => {
    const { call } = setup()
    const base = { project: '/w/a', source: 'docs/roadmap.md', items: [] }
    assert.equal((await call('PUT', '/indexes', { ...base, plan: [{ id: 'X1', line: 1 }] })).status, 400)
    assert.equal((await call('PUT', '/indexes', { ...base, plan: [{ id: 'C1', line: 0 }] })).status, 400)
    assert.equal((await call('PUT', '/indexes', { ...base, closed: [{ id: 'C1', mark: 'y', date: null, line: 1 }] })).status, 400)
    assert.equal((await call('PUT', '/indexes', { ...base, closed: [{ id: 'C1', mark: 'x', date: '2026/10/27', line: 1 }] })).status, 400)
    assert.equal((await call('PUT', '/indexes', { ...base, plan: null, closed: [] })).status, 200, 'null と空は受ける')
  })

  it('同じプロジェクト (表記の揺れを揃える) の同じファイルは置き換え、別のファイルは並べる', async () => {
    const { call } = setup()
    const body = (project: string, source: string) => ({ project, source, items: parseRoadmap(roadmap).items })
    await call('PUT', '/indexes', body('C:\\work\\vcp', 'docs/roadmap.md'))
    await call('PUT', '/indexes', body('c:/work/vcp/', 'docs/roadmap.md'))
    await call('PUT', '/indexes', body('c:/work/vcp', 'docs/TODO.md'))
    const { indexes } = (await (await call('GET', '/indexes')).json()) as { indexes: { project: string; source: string }[] }
    assert.deepEqual(indexes.map((i) => [i.project, i.source]), [['c:/work/vcp/', 'docs/roadmap.md'], ['c:/work/vcp', 'docs/TODO.md']])
  })

  it('DELETE /indexes は同じプロジェクト (表記の揺れを揃える) の同じファイルを外し、index.deleted を流す', async () => {
    const { call, ui } = setup()
    const body = (source: string) => ({ project: 'C:\\work\\vcp', source, items: parseRoadmap(roadmap).items })
    await call('PUT', '/indexes', body('docs/roadmap.md'))
    await call('PUT', '/indexes', body('docs/TODO.md'))
    ui.length = 0
    const q = (project: string, source: string) => `/indexes?project=${encodeURIComponent(project)}&source=${encodeURIComponent(source)}`
    const res = await call('DELETE', q('c:/work/vcp/', 'docs/roadmap.md'))
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { project: 'C:\\work\\vcp', source: 'docs/roadmap.md' })
    assert.deepEqual(ui, [{ event: 'index.deleted', data: { project: 'C:\\work\\vcp', source: 'docs/roadmap.md' } }])
    const { indexes } = (await (await call('GET', '/indexes')).json()) as { indexes: { source: string }[] }
    assert.deepEqual(indexes.map((i) => i.source), ['docs/TODO.md'])
    assert.equal((await call('DELETE', q('c:/work/vcp', 'docs/roadmap.md'))).status, 404)
    assert.equal((await call('DELETE', '/indexes?project=x')).status, 400)
  })

  it('形の違う入力は 400、トークンがなければ 401、IndexStore がなければ 404', async () => {
    const { call } = setup()
    assert.equal((await call('PUT', '/indexes', { project: 'p', source: 's', items: [{ id: 'X1' }] })).status, 400)
    assert.equal((await call('PUT', '/indexes', { source: 's', items: [] })).status, 400)
    assert.equal((await call('GET', '/indexes', undefined, {})).status, 401)
    assert.equal((await setup(null).call('GET', '/indexes')).status, 404)
  })

  it('ファイルに書き、次の起動で読み戻す。壊れたファイルは空から始める', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hub-indexes-'))
    const file = join(dir, 'sub', 'indexes.json')
    new IndexStore(file).put({ project: '/w/a', source: 'docs/roadmap.md', items: parseRoadmap(roadmap).items })
    assert.deepEqual(new IndexStore(file).list().map((i) => i.items.map((x) => x.id)), [['C3', 'C4']])
    assert.ok((await readFile(file, 'utf8')).startsWith('['))
    new IndexStore(file).remove('/w/a', 'docs/roadmap.md')
    assert.deepEqual(new IndexStore(file).list(), [], '外したことも次の起動に残る')
    new IndexStore(file).put({ project: '/w/a', source: 'docs/roadmap.md', items: parseRoadmap(roadmap).items })

    await writeFile(file, '{ broken')
    assert.deepEqual(new IndexStore(file).list(), [])
  })

  it('ファイルに書けなければ、メモリの索引も前のまま', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hub-indexes-'))
    const file = join(dir, 'indexes.json')
    const store = new IndexStore(file)
    store.put({ project: '/w/a', source: 'docs/roadmap.md', items: [] })
    // 一時ファイルの場所をフォルダで塞ぎ、書き込みを失敗させる
    await mkdir(`${file}.tmp`)
    assert.throws(() => store.put({ project: '/w/a', source: 'docs/roadmap.md', items: parseRoadmap(roadmap).items }))
    assert.throws(() => store.put({ project: '/w/b', source: 'docs/roadmap.md', items: [] }))
    assert.deepEqual(store.list().map((i) => [i.project, i.items.length]), [['/w/a', 0]])
  })
})
