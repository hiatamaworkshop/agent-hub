// roadmap の項目の索引のキャッシュ (design.md §3.15 の索引の置き場所 b)。
// ホストのスクリプト (npm run docs:index) が parseRoadmap の結果を送り、Hub は作り直せる写しとして持つ。
// Hub は作業ツリーを読まない (§3.8)。正本はリポジトリにあり、ここが消えても送り直せば戻る。本文は持たない (ID・題・状態・完了条件の文言だけ)
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import { normalizeProjectPath } from '../shared/types.js'

export const MAX_INDEX_BYTES = 1024 * 1024

const itemSchema = z.object({
  id: z.string().regex(/^C\d{1,9}$/),
  title: z.string().min(1).max(500),
  status: z.enum(['decided', 'proposed', 'held', 'blocked']),
  statusReason: z.string().max(500).optional(),
  conditions: z.object({ done: z.number().int().nonnegative(), total: z.number().int().nonnegative() }).nullable(),
  conditionTexts: z.array(z.string().max(2000)).max(100),
  // 古い形の索引は送らない (省略は null 扱いで、UI は印を出さない)
  conditionChecks: z.array(z.boolean()).max(100).optional(),
  promise: z.string().regex(/^[0-9a-f]{8}$/).nullable(),
  line: z.number().int().positive(),
})

// 予定の並び (`## 予定`)。見出しがなければ送られない (null)
const planSchema = z.array(z.object({ id: z.string().regex(/^C\d{1,9}$/), line: z.number().int().positive() })).max(1000)

// 閉じた行 (`[x] C<n>` / `[-] C<n>`)。日付は行末の括弧の先頭 (なければ null)
const closedSchema = z
  .array(
    z.object({
      id: z.string().regex(/^C\d{1,9}$/),
      mark: z.enum(['x', '-']),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      line: z.number().int().positive(),
    }),
  )
  .max(1000)

// 送られた索引。ほかのキー (parseRoadmap の refs・num・endLine など) は捨てる。
// plan と closed を送らない古い形の索引も受ける (plan は null、closed は空として持つ)
export const indexInputSchema = z.object({
  project: z.string().min(1).max(4096),
  source: z.string().min(1).max(256),
  items: z.array(itemSchema.strip()).max(1000),
  plan: planSchema.nullish(),
  closed: closedSchema.nullish(),
})

export type IndexInput = z.infer<typeof indexInputSchema>
export type IndexItem = z.infer<typeof itemSchema>
export type IndexPlan = z.infer<typeof planSchema>
export type IndexClosed = z.infer<typeof closedSchema>

export interface ProjectIndex {
  project: string
  source: string
  updatedAt: string
  items: IndexItem[]
  plan: IndexPlan | null
  closed: IndexClosed
}

// 送られた形を持つ形にする。plan を送らない古い形は予定がないもの (null)、closed は空
function toProjectIndex(input: IndexInput, updatedAt: string): ProjectIndex {
  return { project: input.project, source: input.source, updatedAt, items: input.items, plan: input.plan ?? null, closed: input.closed ?? [] }
}

// 同じプロジェクト (区切りと大文字小文字を揃えたパス) の同じファイルは置き換える
const keyOf = (project: string, source: string) => `${normalizeProjectPath(project)}\n${source}`

export class IndexStore {
  private readonly indexes = new Map<string, ProjectIndex>()

  // file を省くとメモリのみ (テスト用)。読めない・壊れているときは空から始める (送り直せば戻るので止めない)
  constructor(
    private readonly file?: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!file) return
    let raw: string
    try {
      raw = readFileSync(file, 'utf8')
    } catch {
      return
    }
    try {
      const list = z.array(indexInputSchema.extend({ updatedAt: z.string() })).parse(JSON.parse(raw))
      for (const ix of list) this.indexes.set(keyOf(ix.project, ix.source), toProjectIndex(ix, ix.updatedAt))
    } catch (e) {
      console.warn(`[hub] ${file} を読めないので索引を空から始める: ${(e as Error).message}`)
    }
  }

  // 書けてからメモリを更新する (書けずに 500 を返したのに、新しい索引が GET /indexes に出ないように)
  put(input: IndexInput): ProjectIndex {
    const ix = toProjectIndex(input, this.now().toISOString())
    const key = keyOf(ix.project, ix.source)
    this.save(new Map(this.indexes).set(key, ix))
    this.indexes.set(key, ix)
    return ix
  }

  // 外した索引 (なければ null)。put と同じく書けてからメモリを更新する
  remove(project: string, source: string): ProjectIndex | null {
    const key = keyOf(project, source)
    const ix = this.indexes.get(key)
    if (!ix) return null
    const next = new Map(this.indexes)
    next.delete(key)
    this.save(next)
    this.indexes.delete(key)
    return ix
  }

  private save(next: Map<string, ProjectIndex>): void {
    if (!this.file) return
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify([...next.values()]))
    renameSync(tmp, this.file)
  }

  list(): ProjectIndex[] {
    return [...this.indexes.values()]
  }
}
