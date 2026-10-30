import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { createApp } from './app.js'
import { DEFAULT_CONFIG, loadConfig, parseConfig } from './config.js'
import { Hub } from './hub.js'
import { Store } from './store.js'

const dir = mkdtempSync(join(tmpdir(), 'hub-config-'))
after(() => rmSync(dir, { recursive: true, force: true }))

describe('loadConfig: ファイルの有無', () => {
  it('ファイルがなければ、すべて既定で警告もない (起動ログの 1 行だけ)', () => {
    const r = loadConfig(join(dir, 'absent.json'))
    assert.deepEqual(r.config, DEFAULT_CONFIG)
    assert.deepEqual(r.warnings, [])
    assert.equal(r.file, null)
  })

  it('JSON でないファイルは、すべて既定で、警告にファイル名が入る (止まらない)', () => {
    const file = join(dir, 'broken.json')
    writeFileSync(file, '{"projects": {')
    const r = loadConfig(file)
    assert.deepEqual(r.config, DEFAULT_CONFIG)
    assert.equal(r.warnings.length, 1)
    assert.match(r.warnings[0]!, /broken\.json.*JSON として読めない/)
  })

  it('ファイルとして読めないもの (ディレクトリ) は、すべて既定で警告', () => {
    const sub = join(dir, 'a-dir')
    mkdirSync(sub)
    const r = loadConfig(sub)
    assert.deepEqual(r.config, DEFAULT_CONFIG)
    assert.equal(r.warnings.length, 1)
  })

  it('読める値は反映される', () => {
    const file = join(dir, 'ok.json')
    writeFileSync(file, '{"projects": {"olderDays": 7}}')
    const r = loadConfig(file)
    assert.equal(r.config.projects.olderDays, 7)
    assert.deepEqual(r.warnings, [])
    assert.equal(r.file, file)
  })
})

describe('parseConfig: 値ごとの検証', () => {
  const bad: [string, string, RegExp][] = [
    ['文字列', '{"projects": {"olderDays": "30"}}', /projects\.olderDays/],
    ['小数', '{"projects": {"olderDays": 1.5}}', /projects\.olderDays/],
    ['0', '{"projects": {"olderDays": 0}}', /projects\.olderDays/],
    ['負', '{"projects": {"olderDays": -3}}', /projects\.olderDays/],
    ['大きすぎる', '{"projects": {"olderDays": 99999}}', /projects\.olderDays/],
    ['null', '{"projects": {"olderDays": null}}', /projects\.olderDays/],
  ]
  for (const [name, text, re] of bad) {
    it(`olderDays が${name}なら、既定 (30) に戻し、名前を挙げる`, () => {
      const r = parseConfig(text)
      assert.equal(r.config.projects.olderDays, 30)
      assert.equal(r.warnings.length, 1)
      assert.match(r.warnings[0]!, re)
    })
  }

  it('範囲の端 (1 と 3650) は通る', () => {
    assert.equal(parseConfig('{"projects": {"olderDays": 1}}').config.projects.olderDays, 1)
    assert.equal(parseConfig('{"projects": {"olderDays": 3650}}').config.projects.olderDays, 3650)
  })

  it('未知の項目は無視し、名前を挙げる。ほかの値は効く', () => {
    const r = parseConfig('{"projects": {"olderDays": 5, "bogus": 1}, "extra": {}, "constructor": 1, "__proto__": 2}')
    assert.equal(r.config.projects.olderDays, 5)
    assert.equal(r.warnings.length, 4)
    assert.ok(r.warnings.some((w) => w.includes('projects.bogus')))
    assert.ok(r.warnings.some((w) => w.includes('"extra"')))
    assert.ok(r.warnings.some((w) => w.includes('"constructor"')))
    assert.equal(Object.getPrototypeOf(r.config), Object.prototype)
  })

  it('節がオブジェクトでなければ既定で警告。最上位が配列でも既定で警告', () => {
    assert.equal(parseConfig('{"projects": 3}').warnings.length, 1)
    assert.deepEqual(parseConfig('[]').config, DEFAULT_CONFIG)
    assert.equal(parseConfig('[]').warnings.length, 1)
  })

  it('既定の値を書き換えても、次に読む既定は変わらない', () => {
    parseConfig('{"projects": {"olderDays": 9}}')
    assert.equal(DEFAULT_CONFIG.projects.olderDays, 30)
    assert.equal(parseConfig('{}').config.projects.olderDays, 30)
  })
})

describe('GET /config', () => {
  const TOKEN = 'test-token'
  const auth = { authorization: `Bearer ${TOKEN}` }
  const make = (config?: ReturnType<typeof parseConfig>) =>
    createApp({ hub: new Hub(new Store()), token: TOKEN, uiHtml: async () => '<html></html>', config })

  it('トークンなしは 401', async () => {
    assert.equal((await make().request('/config')).status, 401)
  })

  it('検証済みの値と警告を返す', async () => {
    const res = await make(parseConfig('{"projects": {"olderDays": 7, "x": 1}}')).request('/config', { headers: auth })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { config: unknown; warnings: string[] }
    assert.deepEqual(body.config, { projects: { olderDays: 7 } })
    assert.equal(body.warnings.length, 1)
  })

  it('設定を渡さなければ既定を返す', async () => {
    const body = (await (await make().request('/config', { headers: auth })).json()) as { config: unknown; warnings: string[] }
    assert.deepEqual(body, { config: DEFAULT_CONFIG, warnings: [] })
  })

  it('書く API はない (PUT / POST / DELETE は 404 か 405)', async () => {
    for (const method of ['PUT', 'POST', 'PATCH', 'DELETE']) {
      const res = await make().request('/config', { method, headers: { ...auth, 'content-type': 'application/json' }, body: method === 'DELETE' ? undefined : '{}' })
      assert.ok(res.status === 404 || res.status === 405, `${method} → ${res.status}`)
    }
  })
})
