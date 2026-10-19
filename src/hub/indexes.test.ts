import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
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
    assert.deepEqual(Object.keys(c3).sort(), ['conditionTexts', 'conditions', 'id', 'line', 'promise', 'status', 'title'])
    assert.deepEqual(c3.conditionTexts, ['a', 'b'])
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

    await writeFile(file, '{ broken')
    assert.deepEqual(new IndexStore(file).list(), [])
  })
})
