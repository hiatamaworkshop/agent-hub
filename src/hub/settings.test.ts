import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { SettingsError, SettingsStore } from './settings.js'

const dirs: string[] = []
async function tempStore(): Promise<{ store: SettingsStore; file: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'hub-settings-'))
  dirs.push(dir)
  const file = join(dir, 'nested', 'settings.json')
  return { store: new SettingsStore(file), file, dir }
}

after(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})

async function failure(p: Promise<unknown> | (() => unknown)): Promise<SettingsError> {
  try {
    await (typeof p === 'function' ? p() : p)
  } catch (e) {
    assert.ok(e instanceof SettingsError, `expected SettingsError, got ${String(e)}`)
    return e
  }
  assert.fail('expected a failure')
}

describe('settings: 読み書き', () => {
  it('ファイルがなければ空の設定を返す', async () => {
    const { store } = await tempStore()
    assert.deepEqual(await store.read(), { version: 1, commands: [] })
  })

  it('書いたものを読み直せる。ディレクトリがなければ作る', async () => {
    const { store, file } = await tempStore()
    const saved = await store.write({ commands: [{ name: 'cp', text: 'commit and push' }] })
    assert.deepEqual(saved, { version: 1, commands: [{ name: 'cp', text: 'commit and push' }] })
    assert.deepEqual(await store.read(), saved)
    const onDisk = JSON.parse(await readFile(file, 'utf8'))
    assert.deepEqual(onDisk, { version: 1, commands: [{ name: 'cp', text: 'commit and push' }] })
  })

  it('改行を含む text と、$ARGS を含む text を保存できる', async () => {
    const { store } = await tempStore()
    const text = 'review:\n$ARGS\n'
    await store.write({ commands: [{ name: 'rv', text }] })
    assert.equal((await store.read()).commands[0]!.text, text)
  })

  it('commands 以外のキーは保存時に保持する', async () => {
    const { store, file } = await tempStore()
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, JSON.stringify({ version: 1, commands: [], note: 'keep me', extra: { a: 1 } }))
    await store.write({ commands: [{ name: 'cp', text: 'x' }] })
    const onDisk = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(onDisk.note, 'keep me')
    assert.deepEqual(onDisk.extra, { a: 1 })
    assert.deepEqual(onDisk.commands, [{ name: 'cp', text: 'x' }])
    // GET の応答には commands と version だけを返す
    assert.deepEqual(Object.keys(await store.read()).sort(), ['commands', 'version'])
  })

  it('手編集された値を次の読みで反映する (キャッシュしない)', async () => {
    const { store, file } = await tempStore()
    await store.write({ commands: [{ name: 'cp', text: 'a' }] })
    await writeFile(file, JSON.stringify({ version: 1, commands: [{ name: 'cp', text: 'edited' }] }))
    assert.equal((await store.read()).commands[0]!.text, 'edited')
  })

  it('同時に書いても直列化され、最後に正しい JSON が残る', async () => {
    const { store, file } = await tempStore()
    const writes = Array.from({ length: 8 }, (_, i) => store.write({ commands: [{ name: 'c' + i, text: 'v' + i }] }))
    await Promise.all(writes)
    const onDisk = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(onDisk.commands.length, 1)
    const leftovers = (await readdir(join(file, '..'))).filter((f) => f.endsWith('.tmp'))
    assert.deepEqual(leftovers, [])
  })
})

describe('settings: 壊れたファイル', () => {
  it('JSON 不正の GET は 500 settings_invalid で、中身を含めない', async () => {
    const { store, file } = await tempStore()
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, '{ "secret": "do-not-echo", broken')
    const e = await failure(() => store.read())
    assert.equal(e.status, 500)
    assert.equal(e.code, 'settings_invalid')
    assert.match(e.message, /not valid JSON/)
    assert.ok(!e.message.includes('do-not-echo'))
  })

  it('スキーマ違反 (commands が配列でない、version が 2) の GET は 500', async () => {
    const { store, file } = await tempStore()
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, JSON.stringify({ version: 1, commands: 'nope' }))
    assert.equal((await failure(() => store.read())).code, 'settings_invalid')
    await writeFile(file, JSON.stringify({ version: 2, commands: [] }))
    assert.equal((await failure(() => store.read())).code, 'settings_invalid')
    await writeFile(file, JSON.stringify([1, 2]))
    assert.equal((await failure(() => store.read())).code, 'settings_invalid')
  })

  it('壊れたファイルへの PUT は元の内容を .bak に退避してから新しく書く', async () => {
    const { store, file } = await tempStore()
    await mkdir(join(file, '..'), { recursive: true })
    const original = '{ "hand": "edited", broken'
    await writeFile(file, original)
    await store.write({ commands: [{ name: 'cp', text: 'ok' }] })
    assert.equal(await readFile(`${file}.bak`, 'utf8'), original)
    assert.deepEqual(await store.read(), { version: 1, commands: [{ name: 'cp', text: 'ok' }] })
  })
})

describe('settings: 検証 (違反は 400 と英語の message)', () => {
  const bad: [string, unknown, RegExp][] = [
    ['本文がオブジェクトでない', [], /JSON object/],
    ['未知のトップレベルキー', { commands: [], other: 1 }, /unknown key "other" in the request body/],
    ['commands がない', {}, /"commands" is required/],
    ['commands が配列でない', { commands: 'x' }, /must be an array/],
    ['101 個', { commands: Array.from({ length: 101 }, (_, i) => ({ name: 'c' + i, text: 'x' })) }, /at most 100 items/],
    ['大文字の name', { commands: [{ name: 'CP', text: 'x' }] }, /commands\[0\]\.name/],
    ['先頭が記号の name', { commands: [{ name: '-cp', text: 'x' }] }, /commands\[0\]\.name/],
    ['33 文字の name', { commands: [{ name: 'a'.repeat(33), text: 'x' }] }, /commands\[0\]\.name/],
    ['ドットを含む name', { commands: [{ name: 'a.b', text: 'x' }] }, /commands\[0\]\.name/],
    ['name がない', { commands: [{ text: 'x' }] }, /commands\[0\]\.name/],
    ['重複', { commands: [{ name: 'cp', text: 'x' }, { name: 'cp', text: 'y' }] }, /duplicate command name "cp"/],
    ['未知のキー', { commands: [{ name: 'cp', text: 'x', extra: 1 }] }, /unknown key "extra" in commands\[0\]/],
    ['text が空', { commands: [{ name: 'cp', text: '' }] }, /text of "cp" must be 1 to 8000 characters/],
    ['text が 8001 文字', { commands: [{ name: 'cp', text: 'x'.repeat(8001) }] }, /text of "cp"/],
    ['text が文字列でない', { commands: [{ name: 'cp', text: 3 }] }, /text of "cp"/],
  ]
  for (const [label, body, re] of bad) {
    it(label, async () => {
      const { store, file } = await tempStore()
      const e = await failure(() => store.write(body))
      assert.equal(e.status, 400)
      assert.equal(e.code, 'invalid_request')
      assert.match(e.message, re)
      // 違反したときはファイルを作らない
      await assert.rejects(readFile(file, 'utf8'))
    })
  }

  it('text の 8000 文字ちょうどと、100 個ちょうどは通る', async () => {
    const { store } = await tempStore()
    const commands = Array.from({ length: 100 }, (_, i) => ({ name: 'c' + i, text: i === 0 ? 'x'.repeat(8000) : 'x' }))
    const saved = await store.write({ commands })
    assert.equal(saved.commands.length, 100)
    assert.equal(saved.commands[0]!.text.length, 8000)
  })
})
