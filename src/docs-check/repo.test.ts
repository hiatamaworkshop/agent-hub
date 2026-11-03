import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { hubRoutes } from './hub-routes.js'
import { checkDecisionDates, checkKinds, checkMap, checkRepo, checkRoutes, parseMap } from './repo.js'

const claudeMd = [
  '# Rules',
  '',
  '## Document map',
  '',
  '- [README.md](README.md) — the entrance (see docs/design.md §9)',
  '- [docs/design.md](docs/design.md)',
  '  - §1 Background / §2.1 Parts — what is built',
  '  - §3 Questions',
  '',
  '## Other',
  '  - §7 not on the map',
].join('\n')

const design = ['# Design', '## 1. Background', '### 1.1 Why', '## 2. Parts', '### 2.1 Hub', '### 2.2 UI', '#### 2.2.1 Deep', '## 3. Questions', '```', '## 4. In a fence', '```'].join('\n')

describe('checkMap', () => {
  it('reads § entries only from nested bullets under a linked file', () => {
    assert.deepEqual([...parseMap(claudeMd).entries()], [
      ['docs/design.md', [{ number: '1', line: 7 }, { number: '2.1', line: 7 }, { number: '3', line: 8 }]],
    ])
  })

  it('passes when every entry has a heading and every heading is covered', () => {
    const covered = design.replace('### 2.2 UI\n#### 2.2.1 Deep\n', '')
    assert.deepEqual(checkMap(claudeMd, { 'docs/design.md': covered }), [])
  })

  it('errors on an entry with no heading, and warns on a heading not covered', () => {
    const moved = design.replace('## 3. Questions', '## 4. Questions')
    assert.deepEqual(checkMap(claudeMd, { 'docs/design.md': moved }), [
      { file: 'CLAUDE.md', line: 8, level: 'error', message: 'the map lists §3 of docs/design.md, which has no such heading' },
      { file: 'docs/design.md', line: 6, level: 'warning', message: '§2.2 is not on the document map in CLAUDE.md (nor its parent or a child)' },
      { file: 'docs/design.md', line: 8, level: 'warning', message: '§4 is not on the document map in CLAUDE.md (nor its parent or a child)' },
    ])
  })

  it('errors when a listed file is missing', () => {
    assert.equal(checkMap(claudeMd, {})[0]?.message, 'the map lists sections of docs/design.md, which was not found')
  })
})

const protocol = [
  '# Protocol',
  '## 2. Data model',
  '### Event',
  '  "kind": "turn.end | question",',
  '### Message',
  '  "kind": "request | reply",',
  '## 3. API',
  '| Method | Path | Content |',
  '|---|---|---|',
  '| GET | `/messages?after=<seq>` | history |',
  '| POST | `/messages` | create |',
  '## 4. Other',
  '| DELETE | `/outside` | not in §3 |',
].join('\n')

describe('checkRoutes', () => {
  it('passes when the routes and the §3 rows match (query strings and non-HTTP methods ignored)', () => {
    const routes = [{ method: 'GET', path: '/messages' }, { method: 'POST', path: '/messages' }, { method: 'ALL', path: '/*' }]
    assert.deepEqual(checkRoutes(routes, protocol), [])
  })

  it('errors on a route not in §3 and a row with no route', () => {
    const routes = [{ method: 'GET', path: '/messages' }, { method: 'DELETE', path: '/outside' }]
    assert.deepEqual(checkRoutes(routes, protocol).map((p) => [p.line, p.message]), [
      [8, 'the Hub serves DELETE /outside, which is not in the tables of §3'],
      [11, '§3 lists POST /messages, which the Hub does not serve'],
    ])
  })
})

describe('checkKinds', () => {
  it('passes when the kinds match', () => {
    assert.deepEqual(checkKinds(protocol, { Event: ['question', 'turn.end'], Message: ['request', 'reply'] }), [])
  })

  it('errors on a difference, naming both sides', () => {
    assert.deepEqual(checkKinds(protocol, { Event: ['turn.end', 'turn.failed'], Message: ['request', 'reply'] }), [
      { file: 'docs/protocol.md', line: 4, level: 'error', message: 'the Event kinds differ from EVENT_KINDS (missing turn.failed; not in EVENT_KINDS: question)' },
    ])
  })
})

describe('checkDecisionDates', () => {
  const text = (decided: string) => ['## 8. Before', '**Decision**: outside §9', '## 9. Open questions', '1. A question', `   ${decided}`, '   it was decided later (lowercase is prose)', '## 10. After'].join('\n')

  it('passes when each label has a date', () => {
    assert.deepEqual(checkDecisionDates(text('**Decision (2026-10-17, user)**: yes')), [])
    assert.deepEqual(checkDecisionDates(text('**Direction on areas (2026-10-16)**: split')), [])
  })

  it('errors on a label without a date', () => {
    assert.deepEqual(checkDecisionDates(text('(Decided: by cookie; §4)')), [
      { file: 'docs/design.md', line: 5, level: 'error', message: '"Decided" in §9 has no date (YYYY-MM-DD) on its line' },
    ])
  })

  it('errors on a plain-text label without a date (indent or list mark before it)', () => {
    assert.deepEqual(checkDecisionDates(text('   Decision (user): narrow them')), [
      { file: 'docs/design.md', line: 5, level: 'error', message: '"Decision" in §9 has no date (YYYY-MM-DD) on its line' },
    ])
    assert.deepEqual(checkDecisionDates(text('- Decided by the user: keep it')), [
      { file: 'docs/design.md', line: 5, level: 'error', message: '"Decided" in §9 has no date (YYYY-MM-DD) on its line' },
    ])
  })

  it('passes a plain-text label that has a date', () => {
    assert.deepEqual(checkDecisionDates(text('   Decision (2026-10-17, user): narrow them')), [])
    assert.deepEqual(checkDecisionDates(text('- Decided 2026-10-17 by the user: keep it')), [])
  })
})

describe('the repository', () => {
  it('has no drift between its documents, the Hub routes and the kinds', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url))
    assert.deepEqual(checkRepo(root, hubRoutes()), [])
  })
})
