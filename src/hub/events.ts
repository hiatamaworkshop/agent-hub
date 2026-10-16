// クライアントの hook 入力を Event の形に揃える (protocol.md §2 Event、design.md §3.7)。
// クライアント固有の知識はここに閉じ込め、Hub の保存形式と UI は kind だけを見る
import { createHash } from 'node:crypto'
import type { EventKind, HubEvent } from '../shared/types.js'

export interface EventDraft {
  kind: EventKind
  source: string
  sessionId?: string
  cwd?: string
  // 上流に一意の値があるときだけ決める (重複の除去に使う)。なければ Hub が採番する
  id?: string
}

export type Converted = { event: EventDraft } | { ignored: string }

// AskUserQuestion の表示から permission_prompt の Notification が出るまでの猶予。実機では 6 秒だった (design.md §6.1c)
export const QUESTION_PERMISSION_WINDOW_MS = 60_000

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

function stableId(...parts: string[]): string {
  return 'e_' + createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 32)
}

// Claude Code の hook 入力 (design.md §6.1b)。previous は同じ session の直前の Event
export function fromClaudeCodeHook(input: Record<string, unknown>, previous: HubEvent | undefined, now: Date): Converted {
  const hook = str(input.hook_event_name)
  if (!hook) return { ignored: 'no_hook_event_name' }
  const sessionId = str(input.session_id)
  const base = { source: 'claude-code', sessionId, cwd: str(input.cwd) }
  const toolUseId = str(input.tool_use_id)

  switch (hook) {
    case 'Stop':
      return { event: { ...base, kind: 'turn.end' } }
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
