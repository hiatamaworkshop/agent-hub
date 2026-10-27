// roadmap の項目 (`### C<n>. 題`) の索引と、書き方の規則の検査 (design.md §3.15、roadmap.md 冒頭)。
// ブラウザでもホストでも使えるよう、文字列だけを受け取り Node の API に依存しない

export type ItemStatus = 'decided' | 'proposed' | 'held' | 'blocked'

export interface RoadmapItem {
  id: string // `C7`
  num: number
  title: string
  status: ItemStatus
  statusReason?: string
  // `#### 完了条件` のチェックボックス。見出しがなければ null
  conditions: { done: number; total: number } | null
  // 完了条件の各行の文言 (チェックボックスを除く)。request の DONE WHEN に写す
  conditionTexts: string[]
  // 約束の指紋: 完了条件の文言だけから取る。チェックを付けても変わらず、文言を変えると変わる。完了条件がなければ null
  promise: string | null
  line: number // 見出しの行 (1 始まり)
  endLine: number // 節の最後の行
}

// フェーズや既知の問題にある `- [ ] C<n> …` / `- [x] C<n> …`
export interface ItemRef {
  id: string
  checked: boolean
  line: number
}

// `## 予定` の並び。取りかかる順 (design.md §3.15)
export interface PlanEntry {
  id: string
  line: number
}

// 節の外の閉じた行 (`[x] C<n>` / `[-] C<n>`)。日付は行にある `YYYY-MM-DD`。なければ null
export interface ClosedItem {
  id: string
  mark: 'x' | '-'
  date: string | null
  line: number
}

export interface RoadmapIndex {
  items: RoadmapItem[]
  refs: ItemRef[]
  // `## 予定` の見出しがなければ null
  plan: PlanEntry[] | null
  closed: ClosedItem[]
}

export interface RoadmapProblem {
  level: 'error' | 'warning'
  line: number
  message: string
}

const ITEM_HEADING = /^### C(\d+)\. (\S.*)$/
const LOOSE_ITEM_HEADING = /^###\s+C\d+\b/
const HEADING = /^(#{1,6})\s/
// 字下げしていても状態の行として読む (決定と取り違えないため)。字下げは checkRoadmap が error にする
const STATUS_LINE = /^\s*状態\s*[:：]/
const STATUS_VALUE = /^状態: (提案|保留|ブロック)(?:\((.+)\))?$/
const CONDITIONS_HEADING = /^#### 完了条件\s*$/
const CHECKBOX = /^\s*[-*] \[( |x|X)\] /
const REF = /^\s*[-*] \[( |x|X)\] C(\d+)\b/
const CLOSED = /^\s*[-*] \[([xX-])\] C(\d+)\b/
const DATE = /\d{4}-\d{2}-\d{2}/
const PLAN_HEADING = /^##\s+予定\s*$/
const PLAN_ITEM = /^\s*[-*] \[[ xX-]\] C(\d+)\b/
const FENCE = /^\s*(```|~~~)/

const STATUS_WORDS: Record<string, ItemStatus> = { 提案: 'proposed', 保留: 'held', ブロック: 'blocked' }

interface Line {
  text: string
  no: number
}

// コードブロックの中は見出しや参照として読まない
function contentLines(text: string): Line[] {
  const out: Line[] = []
  let fenced = false
  text.split(/\r?\n/).forEach((t, i) => {
    if (FENCE.test(t)) {
      fenced = !fenced
      return
    }
    if (!fenced) out.push({ text: t, no: i + 1 })
  })
  return out
}

function headingLevel(t: string): number {
  return HEADING.exec(t)?.[1]?.length ?? 0
}

interface Section {
  head: Line
  body: Line[]
}

// `### C<n>.` の節 (次の ### 以上の見出しまで) と、節の外の行に分ける
function split(lines: Line[]): { sections: Section[]; outside: Line[] } {
  const sections: Section[] = []
  const outside: Line[] = []
  let cur: Section | null = null
  for (const l of lines) {
    const lv = headingLevel(l.text)
    if (lv > 0 && lv <= 3) {
      cur = LOOSE_ITEM_HEADING.test(l.text) ? { head: l, body: [] } : null
      if (cur) sections.push(cur)
      else outside.push(l)
      continue
    }
    if (cur) cur.body.push(l)
    else outside.push(l)
  }
  return { sections, outside }
}

function readStatus(sec: Section): { status: ItemStatus; reason?: string; valid: boolean; present: boolean } {
  const first = sec.body[0]
  if (!first || !STATUS_LINE.test(first.text)) return { status: 'decided', valid: true, present: false }
  const m = STATUS_VALUE.exec(first.text.trim())
  if (!m) return { status: 'decided', valid: false, present: true }
  return { status: STATUS_WORDS[m[1]!]!, reason: m[2], valid: true, present: true }
}

function readConditions(sec: Section): { counts: { done: number; total: number } | null; texts: string[] } {
  let inside = false
  let found = false
  let done = 0
  const texts: string[] = []
  for (const l of sec.body) {
    const lv = headingLevel(l.text)
    if (lv > 0) {
      inside = CONDITIONS_HEADING.test(l.text)
      if (inside) found = true
      continue
    }
    if (!inside) continue
    const m = CHECKBOX.exec(l.text)
    if (!m) continue
    texts.push(l.text.slice(m[0].length).trim())
    if (m[1] !== ' ') done++
  }
  return { counts: found ? { done, total: texts.length } : null, texts }
}

// 約束の指紋。空白の揺れは同じとみなす。改ざん検知ではなく「変わったか」を見るだけなので FNV-1a (32 bit) で足りる
export function promiseFingerprint(texts: readonly string[]): string {
  const s = texts.map((t) => t.replace(/\s+/g, ' ').trim()).join('\n')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function endLine(sec: Section): number {
  let end = sec.head.no
  for (const l of sec.body) if (l.text.trim() !== '') end = l.no
  return end
}

// `## 予定` の節 (次の ## 以上の見出しまで)。節の行は refs に入れない (予定の行の誤りは readPlan の側で見る)
function readPlan(lines: Line[]): { plan: PlanEntry[] | null; planLines: Set<number> } {
  let found = false
  let inPlan = false
  const entries: PlanEntry[] = []
  const planLines = new Set<number>()
  for (const l of lines) {
    const lv = headingLevel(l.text)
    if (lv > 0 && lv <= 2) {
      inPlan = PLAN_HEADING.test(l.text)
      if (inPlan) found = true
      continue
    }
    if (!inPlan) continue
    planLines.add(l.no)
    const m = PLAN_ITEM.exec(l.text)
    if (m) entries.push({ id: `C${m[1]}`, line: l.no })
  }
  return { plan: found ? entries : null, planLines }
}

export function parseRoadmap(text: string): RoadmapIndex {
  const lines = contentLines(text)
  const { sections, outside } = split(lines)
  const items: RoadmapItem[] = []
  for (const sec of sections) {
    const m = ITEM_HEADING.exec(sec.head.text)
    if (!m) continue
    const st = readStatus(sec)
    const cond = readConditions(sec)
    items.push({
      id: `C${m[1]}`,
      num: Number(m[1]),
      title: m[2]!.trim(),
      status: st.status,
      ...(st.reason !== undefined ? { statusReason: st.reason } : {}),
      conditions: cond.counts,
      conditionTexts: cond.texts,
      promise: cond.counts ? promiseFingerprint(cond.texts) : null,
      line: sec.head.no,
      endLine: endLine(sec),
    })
  }
  const { plan, planLines } = readPlan(lines)
  const refs: ItemRef[] = []
  const closed: ClosedItem[] = []
  for (const l of outside) {
    if (planLines.has(l.no)) continue
    const m = REF.exec(l.text)
    if (m) refs.push({ id: `C${m[2]}`, checked: m[1] !== ' ', line: l.no })
    const c = CLOSED.exec(l.text)
    if (c) closed.push({ id: `C${c[2]}`, mark: c[1] === '-' ? '-' : 'x', date: DATE.exec(l.text)?.[0] ?? null, line: l.no })
  }
  return { items, refs, plan, closed }
}

// 規則の崩れ。error は直すべきもの、warning は人が見て判断するもの
export function checkRoadmap(text: string): RoadmapProblem[] {
  const problems: RoadmapProblem[] = []
  const err = (line: number, message: string) => problems.push({ level: 'error', line, message })
  const warn = (line: number, message: string) => problems.push({ level: 'warning', line, message })

  const { sections } = split(contentLines(text))
  const { items, refs, plan, closed } = parseRoadmap(text)
  // 状態の行が崩れた項目は、決定とみなした検査を重ねない
  const badStatus = new Set<number>()

  for (const sec of sections) {
    if (!ITEM_HEADING.test(sec.head.text)) err(sec.head.no, `項目の見出しは \`### C<n>. 題\` の形にする: ${sec.head.text}`)
    const st = readStatus(sec)
    if (st.present && !st.valid) {
      badStatus.add(sec.head.no)
      err(sec.body[0]!.no, `状態の語彙は \`状態: 提案 | 保留(理由) | ブロック(理由)\`: ${sec.body[0]!.text.trim()}`)
    }
    if (st.present && /^\s/.test(sec.body[0]!.text)) err(sec.body[0]!.no, '状態の行は字下げしない')
    for (const l of sec.body.slice(st.present ? 1 : 0)) {
      if (STATUS_LINE.test(l.text)) err(l.no, '状態の行は見出しの直後に 1 行だけ書く')
    }
  }

  const seen = new Map<string, number>()
  for (const it of items) {
    const prev = seen.get(it.id)
    if (prev !== undefined) err(it.line, `${it.id} が重複している (先の定義は ${prev} 行目)`)
    else seen.set(it.id, it.line)

    if (it.status === 'blocked' && !it.statusReason) err(it.line + 1, `${it.id}: ブロックには理由を書く`)
    // ブロックはほかの項目を待つときだけ。外の出来事を待つものは保留 (design.md §3.15)
    else if (it.status === 'blocked' && !/C\d+/.test(it.statusReason ?? '')) {
      err(it.line + 1, `${it.id}: ブロックは他の項目を待つときだけ。理由に C<n> を書く (外の出来事を待つなら保留)`)
    }
    if (it.status === 'held' && !it.statusReason) err(it.line + 1, `${it.id}: 保留には再開の条件を書く`)
    if (it.status === 'decided' && !badStatus.has(it.line)) {
      if (!it.conditions) err(it.line, `${it.id}: 決定の項目には \`#### 完了条件\` が要る (未決なら \`状態: 提案\` を書く)`)
      else if (it.conditions.total === 0) err(it.line, `${it.id}: \`#### 完了条件\` にチェックボックスがない`)
      else if (it.conditions.done === it.conditions.total) {
        warn(it.line, `${it.id}: 完了条件が全部埋まっている。節を消し、フェーズの行を \`[x] ${it.id}\` にして記録を書く`)
      }
    }
    // 決定の項目 (状態の行がないものと、ブロック) は予定に載る (design.md §3.15)。見出しがなければ下で 1 度だけ言う
    const decided = it.status === 'decided' || it.status === 'blocked'
    if (plan && decided && !badStatus.has(it.line) && !plan.some((p) => p.id === it.id)) {
      err(it.line, `${it.id}: 決定の項目が \`## 予定\` にない`)
    }
  }

  if (items.length > 0 && !plan) err(1, '項目があるのに `## 予定` がない (決定の項目を取りかかる順に `- [ ] C<n>` で並べる)')
  for (const p of plan ?? []) {
    const it = items.find((x) => x.id === p.id)
    if (!it) err(p.line, `${p.id}: \`## 予定\` に載せたが、項目の節がない`)
    else if (it.status === 'proposed' || it.status === 'held') {
      err(p.line, `${p.id}: 決定でない項目 (${it.status === 'proposed' ? '提案' : '保留'}) は \`## 予定\` に載せない`)
    }
  }

  for (const r of refs) {
    const exists = seen.has(r.id)
    if (!r.checked && !exists) err(r.line, `\`[ ] ${r.id}\` が指す項目の節がない`)
    if (r.checked && exists) err(r.line, `\`[x] ${r.id}\` は終わった印だが、項目の節が残っている`)
  }

  for (const c of closed) {
    if (!c.date) err(c.line, `\`[${c.mark}] ${c.id}\` の行に日付 (YYYY-MM-DD) がない`)
  }

  return problems.sort((a, b) => a.line - b.line)
}
