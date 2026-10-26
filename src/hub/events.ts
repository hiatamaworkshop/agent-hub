// クライアントの hook 入力を Event の形に揃える (protocol.md §2 Event、design.md §3.7)。
// クライアント固有の知識はここに閉じ込め、Hub の保存形式と UI は kind だけを見る
import { createHash } from 'node:crypto'
import type { EventChanges, EventKind, HubEvent } from '../shared/types.js'

export interface EventDraft {
  kind: EventKind
  source: string
  sessionId?: string
  cwd?: string
  changes?: EventChanges
  // 上流に一意の値があるときだけ決める (重複の除去に使う)。なければ Hub が採番する
  id?: string
}

export type Converted = { event: EventDraft } | { ignored: string }

// previous は同じ session の直前の Event
export type EventConverter = (input: Record<string, unknown>, previous: HubEvent | undefined, now: Date) => Converted

// AskUserQuestion の表示から permission_prompt の Notification が出るまでの猶予。実機では 6 秒だった (design.md §6.1c)
export const QUESTION_PERMISSION_WINDOW_MS = 60_000

// hook (tools/hooks/post-event.mjs) が入力に足す欄。値の形は parseChanges で検査する
export const CHANGES_FIELD = 'agent_hub_git'
// 配列 1 つの上限。hook も同じ数で切る。超えた入力は事実だけ捨て、イベントは記録する
export const CHANGES_MAX_ITEMS = 1000
const CHANGES_MAX_PATH = 1000
const CHANGES_MAX_HEAD = 64

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

function paths(v: unknown): string[] | undefined {
  if (!Array.isArray(v) || v.length > CHANGES_MAX_ITEMS) return undefined
  if (!v.every((p) => typeof p === 'string' && p !== '' && p.length <= CHANGES_MAX_PATH)) return undefined
  return v as string[]
}

// 形が合わなければ undefined。呼び出し側は事実を捨てるだけで、イベントは止めない
export function parseChanges(v: unknown): EventChanges | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined
  const { head, changed, untracked } = v as Record<string, unknown>
  if (typeof head !== 'string' || head === '' || head.length > CHANGES_MAX_HEAD) return undefined
  const c = paths(changed)
  const u = paths(untracked)
  if (!c || !u) return undefined
  return { head, changed: c, untracked: u }
}

function stableId(...parts: string[]): string {
  return 'e_' + createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 32)
}

// Claude Code の hook 入力 (design.md §6.1b)
export const fromClaudeCodeHook: EventConverter = (input, previous, now) => {
  const hook = str(input.hook_event_name)
  if (!hook) return { ignored: 'no_hook_event_name' }
  const sessionId = str(input.session_id)
  const changes = parseChanges(input[CHANGES_FIELD])
  const base = { source: 'claude-code', sessionId, cwd: str(input.cwd), ...(changes ? { changes } : {}) }
  const toolUseId = str(input.tool_use_id)

  switch (hook) {
    case 'Stop':
      return { event: { ...base, kind: 'turn.end' } }
    // API のエラーでターンが終わった (usage limit など)。error と last_assistant_message は payload のまま持つ (design.md §6.1q)
    case 'StopFailure':
      return { event: { ...base, kind: 'turn.failed' } }
    case 'PreToolUse':
    case 'PostToolUse': {
      if (input.tool_name !== 'AskUserQuestion') return { ignored: 'unsupported_tool' }
      const kind = hook === 'PreToolUse' ? 'question' : 'question.answered'
      // tool_use_id は呼び出しごとに一意なので、hook が重ねて届いても 1 件にまとまる
      return { event: { ...base, kind, ...(sessionId && toolUseId ? { id: stableId(sessionId, kind, toolUseId) } : {}) } }
    }
    case 'Notification': {
      if (input.notification_type !== 'permission_prompt') return { event: { ...base, kind: 'notification' } }
      // 質問の表示でも permission_prompt が出る (design.md §6.1c)。回答前の質問の直後なら、同じ待ちの重複として捨てる
      if (
        previous?.kind === 'question' &&
        now.getTime() - Date.parse(previous.ts) <= QUESTION_PERMISSION_WINDOW_MS
      ) {
        return { ignored: 'question_prompt' }
      }
      return { event: { ...base, kind: 'permission' } }
    }
    default:
      return { ignored: 'unsupported_hook' }
  }
}

// source (POST /events/:source) ごとの変換。クライアントを足すときは変換を書いてここに 1 行足す (design.md §3.7)
export const CONVERTERS: ReadonlyMap<string, EventConverter> = new Map([['claude-code', fromClaudeCodeHook]])

// source を名乗らない POST /events の扱い。名乗る前に配った hook の設定を動かし続けるため
export const DEFAULT_SOURCE = 'claude-code'
