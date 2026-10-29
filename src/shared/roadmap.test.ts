import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { checkRoadmap, parseRoadmap, promiseFingerprint } from './roadmap.js'

const sample = [
  '# ロードマップ',
  '',
  '## P1',
  '- [x] C1 終わったもの (2026-10-16)',
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
  '## 予定',
  '- [ ] C2',
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

  it('完了条件の文言と約束の指紋。チェックを付けても指紋は変わらず、文言を変えると変わる', () => {
    const c2 = parseRoadmap(sample).items[0]!
    assert.deepEqual(c2.conditionTexts, ['一つ目', '二つ目', '入れ子も数える'])
    assert.deepEqual(c2.conditionChecks, [true, false, true], '完了条件の 1 行ずつのチェック (入れ子も数える)')
    assert.equal(c2.promise, promiseFingerprint(['一つ目', '二つ目', '入れ子も数える']))
    assert.match(c2.promise!, /^[0-9a-f]{8}$/)
    assert.equal(parseRoadmap(sample.replace('- [ ] 二つ目', '- [x] 二つ目')).items[0]!.promise, c2.promise)
    assert.equal(parseRoadmap(sample.replace('- [ ] 二つ目', '- [ ]   二つ目  ')).items[0]!.promise, c2.promise, '空白の揺れは同じ')
    assert.notEqual(parseRoadmap(sample.replace('- [ ] 二つ目', '- [ ] 二つ目を変えた')).items[0]!.promise, c2.promise)
    assert.equal(parseRoadmap(sample).items[1]!.promise, null, '完了条件がなければ null')
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

  it('## 予定 の並びと、閉じた行 (ID・x か -・日付) を取り出す。見出しがなければ plan は null', () => {
    const text = ['## 予定', '- [ ] C2', '- [ ] C1', '', '## 既知の問題', '- [x] C1 終わり (2026-10-16)', '- [-] C5 却下 (2026-10-17)', '- [x] C6 日付なし'].join('\n')
    const idx = parseRoadmap(text)
    assert.deepEqual(idx.plan, [
      { id: 'C2', line: 2 },
      { id: 'C1', line: 3 },
    ])
    assert.deepEqual(idx.closed, [
      { id: 'C1', mark: 'x', date: '2026-10-16', line: 6 },
      { id: 'C5', mark: '-', date: '2026-10-17', line: 7 },
      { id: 'C6', mark: 'x', date: null, line: 8 },
    ])
    assert.deepEqual(idx.refs.map((r) => r.line), [6, 8], '予定の行 (2・3 行目) は参照に入れない')
    assert.equal(parseRoadmap('### C1. a').plan, null)
  })

  it('閉じた日は行末の括弧の先頭。題の中の日付は数えない (C25 の形)', () => {
    const text = [
      '- [x] C25 **題 (2026-10-19、ユーザー)** (2026-10-20)',
      '- [-] C6 却下の題 (却下 2026-10-21、理由)',
      '- [x] C7 題 (2026-10-19) 末尾に文',
      '- [x] C8 題 (2026-10-19、理由)',
    ].join('\n')
    assert.deepEqual(
      parseRoadmap(text).closed.map((c) => [c.id, c.date]),
      [
        ['C25', '2026-10-20'],
        ['C6', '2026-10-21'],
        ['C7', null],
        ['C8', '2026-10-19'],
      ],
    )
  })

  it('問題がなければ空', () => {
    assert.deepEqual(checkRoadmap(sample), [])
  })
})

// 同じ台帳を英語の語彙で書いたもの (design.md §3.15 の対応表)。行の位置は sample と同じにする
const english = sample
  .replace('# ロードマップ', '# Roadmap')
  .replace(/#### 完了条件/g, '#### Done when')
  .replace('状態: 提案', 'Status: proposed')
  .replace('状態: 保留(理由)', 'Status: held(reason)')
  .replace('## 予定', '## Plan')

describe('英語の語彙の台帳', () => {
  it('日本語の台帳と同じ形の索引を返す (状態・理由・完了条件・指紋・予定・参照)', () => {
    const ja = parseRoadmap(sample)
    const en = parseRoadmap(english)
    assert.deepEqual(
      en.items.map((i) => ({ ...i, statusReason: i.statusReason && 'R' })),
      ja.items.map((i) => ({ ...i, statusReason: i.statusReason && 'R' })),
    )
    assert.equal(en.items[2]!.statusReason, 'reason')
    assert.deepEqual(en.plan, ja.plan)
    assert.deepEqual(en.refs, ja.refs)
    assert.deepEqual(checkRoadmap(english), [])
  })

  it('ブロックの理由 `after C<n>`、却下の `rejected YYYY-MM-DD`、ブロックを待つ項目の順', () => {
    const text = [
      '## Plan',
      '- [ ] C2',
      '- [ ] C1',
      '',
      '## Known issues',
      '- [x] C3 done (2026-10-16, requested)',
      '- [-] C4 dropped (rejected 2026-10-17, not needed)',
      '',
      '## Items',
      '### C1. first',
      '#### Done when',
      '- [ ] a',
      '### C2. second',
      'Status: blocked(after C1)',
      '#### Done when',
      '- [ ] b',
    ].join('\n')
    const idx = parseRoadmap(text)
    assert.deepEqual(idx.items.map((i) => [i.id, i.status, i.statusReason]), [['C1', 'decided', undefined], ['C2', 'blocked', 'after C1']])
    assert.deepEqual(idx.closed.map((c) => [c.id, c.mark, c.date]), [['C3', 'x', '2026-10-16'], ['C4', '-', '2026-10-17']])
    assert.deepEqual(messages(text), [['error', 2, 'C2: 待つ項目 C1 より前に並んでいる。C1 の後に置く']])
  })

  it('英語の状態の崩れ (語の大文字・知らない語) は日本語と同じに error。日本語と英語が混ざった台帳も読む', () => {
    const text = ['### C1. a', 'Status: Proposed', '### C2. b', 'status: pending', '### C3. c', '状態: 提案', '## Plan'].join('\n')
    const ps = checkRoadmap(text)
    assert.ok(ps.some((p) => p.line === 2 && p.message.startsWith('状態の語彙')))
    assert.ok(ps.some((p) => p.line === 4 && p.message.startsWith('状態の語彙')))
    assert.equal(parseRoadmap(text).items[2]!.status, 'proposed')
  })
})

const messages = (text: string) => checkRoadmap(text).map((p) => [p.level, p.line, p.message])

describe('checkRoadmap', () => {
  const messages = (text: string) => checkRoadmap(text).map((p) => [p.level, p.line, p.message])

  it('ID の重複', () => {
    const text = ['### C1. a', '#### 完了条件', '- [ ] x', '### C1. b', '#### 完了条件', '- [ ] y', '## 予定', '- [ ] C1'].join('\n')
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
      '## 予定',
      '- [ ] C3',
    ].join('\n')
    const ps = checkRoadmap(text)
    assert.ok(ps.some((p) => p.line === 2 && p.message.startsWith('状態の語彙')))
    assert.ok(ps.some((p) => p.line === 5 && p.message === '状態の行は見出しの直後に 1 行だけ書く'))
    assert.ok(ps.some((p) => p.line === 7 && p.message === 'C3: ブロックには理由を書く'))
    // 語彙の崩れた C1 に「完了条件がない」を重ねない
    assert.equal(ps.filter((p) => p.message.startsWith('C1:')).length, 0)
  })

  it('字下げした状態の行は状態として読み (決定と取り違えない)、字下げを error にする', () => {
    const text = ['### C1. a', '  状態: 提案', '### C2. b', '\t状態: 保留(待ち)', '## 予定'].join('\n')
    assert.deepEqual(parseRoadmap(text).items.map((it) => [it.id, it.status, it.statusReason]), [
      ['C1', 'proposed', undefined],
      ['C2', 'held', '待ち'],
    ])
    assert.deepEqual(messages(text), [
      ['error', 2, '状態の行は字下げしない'],
      ['error', 4, '状態の行は字下げしない'],
    ])
  })

  it('決定の項目に完了条件がない、またはチェックボックスがない', () => {
    const text = ['### C1. a', '本文', '### C2. b', '#### 完了条件', '文だけ', '## 予定', '- [ ] C1', '- [ ] C2'].join('\n')
    assert.deepEqual(
      checkRoadmap(text).map((p) => [p.line, p.message.split(':')[0]]),
      [
        [1, 'C1'],
        [3, 'C2'],
      ],
    )
  })

  it('完了条件が全部埋まった決定の項目は warning', () => {
    const text = ['### C1. a', '#### 完了条件', '- [x] x', '## 予定', '- [ ] C1'].join('\n')
    assert.deepEqual(checkRoadmap(text).map((p) => p.level), ['warning'])
  })

  it('フェーズの参照が実在の項目と食い違う', () => {
    const text = ['- [ ] C5 ない', '- [x] C1 まだある (2026-10-27)', '### C1. a', '#### 完了条件', '- [ ] x', '## 予定', '- [ ] C1'].join('\n')
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

  it('閉じた日が行末の括弧の先頭にない行は error (題の中の日付では通さない)', () => {
    const text = ['- [x] C7 題 (2026-10-19) 末尾に文'].join('\n')
    assert.deepEqual(messages(text), [['error', 1, '`[x] C7` の行末の括弧の先頭に日付 (YYYY-MM-DD) がない']])
  })

  it('項目があるのに `## 予定` がない', () => {
    const text = ['### C1. a', '#### 完了条件', '- [ ] x'].join('\n')
    assert.deepEqual(messages(text), [['error', 1, '項目があるのに `## 予定` (英語の台帳では `## Plan`) がない (決定の項目を取りかかる順に `- [ ] C<n>` で並べる)']])
  })

  it('決定の項目 (状態の行がないものと、ブロック) が予定にない。ブロックは決定として載せる', () => {
    const text = ['### C1. a', '#### 完了条件', '- [ ] x', '### C2. b', '状態: ブロック(C1 の後)', '#### 完了条件', '- [ ] y', '## 予定', '- [ ] C1'].join('\n')
    assert.deepEqual(messages(text), [['error', 4, 'C2: 決定の項目が `## 予定` (英語の台帳では `## Plan`) にない']])
    const ok = ['### C1. a', '#### 完了条件', '- [ ] x', '### C2. b', '状態: ブロック(C1 の後)', '#### 完了条件', '- [ ] y', '## 予定', '- [ ] C1', '- [ ] C2'].join('\n')
    assert.deepEqual(checkRoadmap(ok), [])
  })

  it('ブロックの理由に C<n> がない (外の出来事を待つものは保留)', () => {
    const text = ['### C1. a', '状態: ブロック(次の usage limit に当たるまで)', '#### 完了条件', '- [ ] x', '## 予定', '- [ ] C1'].join('\n')
    assert.deepEqual(messages(text), [['error', 2, 'C1: ブロックは他の項目を待つときだけ。理由に C<n> を書く (外の出来事を待つなら保留)']])
  })

  it('完了条件のないブロックは error (決まっていない項目は保留(C<n> の後))', () => {
    const text = ['### C1. a', '#### 完了条件', '- [ ] x', '### C2. b', '状態: ブロック(C1 の後)', '## 予定', '- [ ] C1', '- [ ] C2'].join('\n')
    assert.deepEqual(messages(text), [['error', 4, 'C2: ブロックは決定の項目 (完了条件を持つ) だけ。決まっていない項目は保留(C<n> の後)']])
  })

  it('ブロックが待つ項目より前に並ぶ', () => {
    const text = ['### C11. a', '#### 完了条件', '- [ ] x', '### C12. b', '状態: ブロック(C11 の後)', '#### 完了条件', '- [ ] y', '## 予定', '- [ ] C12', '- [ ] C11'].join('\n')
    assert.deepEqual(messages(text), [['error', 9, 'C12: 待つ項目 C11 より前に並んでいる。C11 の後に置く']])
  })

  it('ブロックの待つ項目がもう閉じている (節がない)', () => {
    const text = ['- [x] C11 終わり (2026-10-27)', '### C12. b', '状態: ブロック(C11 の後)', '#### 完了条件', '- [ ] y', '## 予定', '- [ ] C12'].join('\n')
    assert.deepEqual(messages(text), [['error', 7, 'C12: 待つ項目 C11 は閉じている (節がない)。ブロックを外す']])
  })

  it('予定に同じ ID が 2 度ある', () => {
    const text = ['### C1. a', '#### 完了条件', '- [ ] x', '## 予定', '- [ ] C1', '- [ ] C1'].join('\n')
    assert.deepEqual(messages(text), [['error', 6, 'C1: `## 予定` に 2 度載っている (先は 5 行目)']])
  })

  it('予定に `[ ]` でない行がある (完了・却下の行)', () => {
    const text = ['### C1. a', '#### 完了条件', '- [ ] x', '## 予定', '- [ ] C1', '- [x] C1', '- [-] C9 却下 (2026-10-27)'].join('\n')
    assert.deepEqual(messages(text), [
      ['error', 6, '予定の行は `- [ ] C<n>` の形にする (完了や却下は並べない)'],
      ['error', 7, '予定の行は `- [ ] C<n>` の形にする (完了や却下は並べない)'],
    ])
  })

  it('`## 予定` が 2 つ以上ある', () => {
    const text = ['### C1. a', '#### 完了条件', '- [ ] x', '## 予定', '- [ ] C1', '## 予定', '- [ ] C1'].join('\n')
    assert.deepEqual(messages(text), [
      ['error', 6, '`## 予定` が 2 つ以上ある。1 つにまとめる'],
      ['error', 7, 'C1: `## 予定` に 2 度載っている (先は 5 行目)'],
    ])
  })

  it('保留の項目は予定に載せない', () => {
    const text = ['### C1. a', '状態: 保留(理由)', '## 予定', '- [ ] C1'].join('\n')
    assert.deepEqual(messages(text), [['error', 4, 'C1: 決定でない項目 (保留) は `## 予定` に載せない']])
  })

  it('予定に決定でない項目 (提案・保留) や、節のない ID がある', () => {
    const text = ['### C1. a', '#### 完了条件', '- [ ] x', '### C2. b', '状態: 提案', '## 予定', '- [ ] C1', '- [ ] C2', '- [ ] C9'].join('\n')
    assert.deepEqual(messages(text), [
      ['error', 8, 'C2: 決定でない項目 (提案) は `## 予定` に載せない'],
      ['error', 9, 'C9: `## 予定` に載せたが、項目の節がない'],
    ])
  })

  it('保留に再開の条件 (理由) がない', () => {
    const text = ['### C1. a', '状態: 保留', '## 予定'].join('\n')
    assert.deepEqual(messages(text), [['error', 2, 'C1: 保留には再開の条件を書く']])
  })

  it('日付のない `[x] C<n>` と `[-] C<n>` の行', () => {
    const text = ['- [x] C1 終わった', '- [-] C2 却下 (2026-10-27)', '- [-] C3 却下'].join('\n')
    assert.deepEqual(messages(text), [
      ['error', 1, '`[x] C1` の行末の括弧の先頭に日付 (YYYY-MM-DD) がない'],
      ['error', 3, '`[-] C3` の行末の括弧の先頭に日付 (YYYY-MM-DD) がない'],
    ])
  })

  it('リポジトリの roadmap.md は規則どおり', () => {
    const text = readFileSync(new URL('../../docs/roadmap.md', import.meta.url), 'utf8')
    assert.deepEqual(checkRoadmap(text).filter((p) => p.level === 'error'), [])
  })
})

describe('status line vocabulary', () => {
  it('a lowercase `status:` in the body is prose, not a second status line', () => {
    const text = ['### C1. a', '#### Done when', '- [ ] x', 'status: see notes', '## Plan', '- [ ] C1'].join('\n')
    assert.ok(!checkRoadmap(text).some((p) => p.message.startsWith('状態の行は見出しの直後')))
  })
})
