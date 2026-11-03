import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { codeNames } from './code-names.js'
import { hubRoutes } from './hub-routes.js'
import { checkDecisionDates, checkKinds, checkMap, checkMcpTools, checkRepo, checkRoutes, checkShimEvents, checkUiEmitters, checkUiEvents, parseMap } from './repo.js'

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

describe('checkMcpTools (C124)', () => {
  const protocol = (rows: string[]) => ['## 5. MCP tools (published by the shim)', '', '| Tool | Arguments | Behavior |', '|---|---|---|', ...rows, '', '## 6. Format'].join('\n')

  it('passes when every published tool has a row and every row is a published tool or says not built', () => {
    const doc = protocol(['| `post_message` | `kind` | Sends |', '| `attach` | `mailbox` | Not built. Switches |'])
    assert.deepEqual(checkMcpTools(['post_message'], doc), [])
  })

  it('errors on a published tool with no row, and on a row with no tool that does not say not built', () => {
    const doc = protocol(['| `post_message` | `kind` | Sends |', '| `list_topics` | none | Known topics |'])
    assert.deepEqual(checkMcpTools(['post_message', 'inbox'], doc), [
      { file: 'docs/protocol.md', line: 1, level: 'error', message: 'the shim publishes the MCP tool inbox, which has no row in §5' },
      { file: 'docs/protocol.md', line: 6, level: 'error', message: '§5 lists list_topics, which the shim does not publish (say "not built" in the row if it is not built yet)' },
    ])
  })

  it('errors when a row says not built but the shim publishes the tool', () => {
    const doc = protocol(['| `inbox` | `after?` | Not built. Fetches |'])
    assert.deepEqual(checkMcpTools(['inbox'], doc), [{ file: 'docs/protocol.md', line: 5, level: 'error', message: '§5 says inbox is not built, but the shim publishes it' }])
  })
})

describe('checkUiEvents (C124)', () => {
  const protocol = (names: string) => ['## 7. Event types UI ↔ Hub (SSE `event:` names)', '', names, '', '- `index.updated` is `{ "project" }`', '', '## 8. Vocabulary'].join('\n')

  it('passes when the names sent and the names listed are the same', () => {
    assert.deepEqual(checkUiEvents(['event', 'message.deleted'], protocol('`event` (detection events), `message.deleted`')), [])
  })

  it('errors on a name sent but not listed, and on a listed name the Hub does not send', () => {
    assert.deepEqual(checkUiEvents(['event', 'mailbox.created'], protocol('`event`, `mailbox.acked`')), [
      { file: 'docs/protocol.md', line: 3, level: 'error', message: 'the Hub sends the UI event mailbox.created on /stream, which is not in §7' },
      { file: 'docs/protocol.md', line: 3, level: 'error', message: '§7 lists mailbox.acked, which the Hub does not send on /stream' },
    ])
  })
})

describe('checkUiEmitters (C124 review)', () => {
  const declared = (n: string) => ({ event: 3, 'index.deleted': 7 })[n] ?? 1

  it('passes when every listed name has an emitUi call with that literal and every call names a listed name', () => {
    const emitters = [
      { name: 'event', file: 'src/hub/hub.ts', line: 291 },
      { name: 'index.deleted', file: 'src/hub/app.ts', line: 329 },
    ]
    assert.deepEqual(checkUiEmitters(['event', 'index.deleted'], emitters, declared), [])
  })

  it('errors on a listed name that no emitUi sends (its last emitter was removed), naming the entry', () => {
    assert.deepEqual(checkUiEmitters(['event', 'index.deleted'], [{ name: 'event', file: 'src/hub/hub.ts', line: 291 }], declared), [
      { file: 'src/shared/types.ts', line: 7, level: 'error', message: "UI_EVENT_NAMES lists index.deleted, which no emitUi('index.deleted', ...) in src/hub sends" },
    ])
  })

  it('errors on an emitUi call with a name that is not a literal, and on a literal name that is not listed', () => {
    const emitters = [{ name: 'event', file: 'src/hub/hub.ts', line: 299 }, { name: null, file: 'src/hub/hub.ts', line: 300 }, { name: 'foo', file: 'src/hub/hub.ts', line: 301 }]
    assert.deepEqual(checkUiEmitters(['event'], emitters, declared), [
      { file: 'src/hub/hub.ts', line: 300, level: 'error', message: 'emitUi is called with a name that is not a string literal, so the docs check cannot read which UI event it sends' },
      { file: 'src/hub/hub.ts', line: 301, level: 'error', message: 'emitUi(\'foo\', ...) sends foo, which is not in UI_EVENT_NAMES' },
    ])
  })
})

describe('checkShimEvents (C124)', () => {
  const protocol = (rows: string[]) =>
    ['## 3. The Hub\'s HTTP API', '', '### For the shim', '', '#### SSE `event:` names for the shim', '', '| event | data | Meaning |', '|---|---|---|', ...rows, '', '#### Next', '| `ignored` | row outside the table |', '## 4. Delivery'].join('\n')

  it('passes when the table lists the names the shim stream sends', () => {
    assert.deepEqual(checkShimEvents(['message', 'terminated'], protocol(['| `message` | Message | x |', '| `terminated` | `{ "reason" }` | y |'])), [])
  })

  it('errors on a name sent but not in the table, and on a row the Hub does not send', () => {
    assert.deepEqual(checkShimEvents(['message', 'heartbeat'], protocol(['| `message` | Message | x |', '| `terminated` | `{ "reason" }` | y |'])), [
      { file: 'docs/protocol.md', line: 1, level: 'error', message: 'the Hub sends the shim event heartbeat, which is not in the SSE table for the shim in §3' },
      { file: 'docs/protocol.md', line: 10, level: 'error', message: '§3\'s SSE table for the shim lists terminated, which the Hub does not send' },
    ])
  })
})

describe('the repository', () => {
  it('has no drift between its documents, the Hub routes, the kinds and the names the code sends', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url))
    assert.deepEqual(checkRepo(root, hubRoutes(), codeNames()), [])
  })
})
