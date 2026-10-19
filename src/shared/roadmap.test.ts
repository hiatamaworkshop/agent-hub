import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { checkRoadmap, parseRoadmap } from './roadmap.js'

const sample = [
  '# ロードマップ',
  '',
  '## P1',
  '- [x] C1 終わったもの',
  '- [ ] C2 開いているもの',
  '',
  '## 項目',
  '',
  '### C2. 開いているもの',
  '',
  '本文。',
  '',
  '#### 完了条件',
  '- [x] 一つ目',
  '- [ ] 二つ目',
  '  - [x] 入れ子も数える',
  '',
  '#### 記録',
  '- [ ] 完了条件の外は数えない',
  '',
  '### C3. 提案のもの',
  '状態: 提案',
  '',
  '説明。',
  '',
  '### C4. 保留のもの',
  '状態: 保留(理由)',
  '',
].join('\r\n')

describe('parseRoadmap', () => {
  it('項目の ID・題・状態・完了条件の進み具合・行を取り出す (CRLF も読む)', () => {
    const { items } = parseRoadmap(sample)
    assert.deepEqual(
      items.map((i) => [i.id, i.title, i.status, i.statusReason, i.conditions, i.line, i.endLine]),
      [
        ['C2', '開いているもの', 'decided', undefined, { done: 2, total: 3 }, 9, 19],
        ['C3', '提案のもの', 'proposed', undefined, null, 21, 24],
        ['C4', '保留のもの', 'held', '理由', null, 26, 27],
      ],
    )
  })

  it('節の外の `[ ] C<n>` / `[x] C<n>` を参照として取り出す', () => {
    assert.deepEqual(parseRoadmap(sample).refs, [
      { id: 'C1', checked: true, line: 4 },
      { id: 'C2', checked: false, line: 5 },
    ])
  })

  it('コードブロックの中の見出しは項目にしない', () => {
    const text = ['## 項目', '```', '### C9. 例', '```', '### C1. 本物', '#### 完了条件', '- [ ] a'].join('\n')
    assert.deepEqual(parseRoadmap(text).items.map((i) => i.id), ['C1'])
  })

  it('問題がなければ空', () => {
    assert.deepEqual(checkRoadmap(sample), [])
  })
})

describe('checkRoadmap', () => {
  const messages = (text: string) => checkRoadmap(text).map((p) => [p.level, p.line, p.message])

  it('ID の重複', () => {
    const text = ['### C1. a', '#### 完了条件', '- [ ] x', '### C1. b', '#### 完了条件', '- [ ] y'].join('\n')
    assert.deepEqual(messages(text), [['error', 4, 'C1 が重複している (先の定義は 1 行目)']])
  })

  it('状態の語彙と位置', () => {
    const text = [
      '### C1. a',
      '状態: 検討中',
      '### C2. b',
      '',
      '状態: 提案',
      '### C3. c',
      '状態: ブロック',
    ].join('\n')
    const ps = checkRoadmap(text)
    assert.ok(ps.some((p) => p.line === 2 && p.message.startsWith('状態の語彙')))
    assert.ok(ps.some((p) => p.line === 5 && p.message === '状態の行は見出しの直後に 1 行だけ書く'))
    assert.ok(ps.some((p) => p.line === 7 && p.message === 'C3: ブロックには理由を書く'))
    // 語彙の崩れた C1 に「完了条件がない」を重ねない
    assert.equal(ps.filter((p) => p.message.startsWith('C1:')).length, 0)
  })

  it('決定の項目に完了条件がない、またはチェックボックスがない', () => {
    const text = ['### C1. a', '本文', '### C2. b', '#### 完了条件', '文だけ'].join('\n')
    assert.deepEqual(
      checkRoadmap(text).map((p) => [p.line, p.message.split(':')[0]]),
      [
        [1, 'C1'],
        [3, 'C2'],
      ],
    )
  })

  it('完了条件が全部埋まった決定の項目は warning', () => {
    const text = ['### C1. a', '#### 完了条件', '- [x] x'].join('\n')
    assert.deepEqual(checkRoadmap(text).map((p) => p.level), ['warning'])
  })

  it('フェーズの参照が実在の項目と食い違う', () => {
    const text = ['- [ ] C5 ない', '- [x] C1 まだある', '### C1. a', '#### 完了条件', '- [ ] x'].join('\n')
    assert.deepEqual(
      checkRoadmap(text).map((p) => [p.line, p.message]),
      [
        [1, '`[ ] C5` が指す項目の節がない'],
        [2, '`[x] C1` は終わった印だが、項目の節が残っている'],
      ],
    )
  })

  it('見出しの形の崩れ', () => {
    const text = ['### C1 ドットなし', '状態: 提案'].join('\n')
    assert.deepEqual(messages(text), [['error', 1, '項目の見出しは `### C<n>. 題` の形にする: ### C1 ドットなし']])
  })

  it('リポジトリの roadmap.md は規則どおり', () => {
    const text = readFileSync(new URL('../../docs/roadmap.md', import.meta.url), 'utf8')
    assert.deepEqual(checkRoadmap(text).filter((p) => p.level === 'error'), [])
  })
})
