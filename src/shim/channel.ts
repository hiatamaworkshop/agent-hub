// Claude Code Channels への依存はこのファイルに閉じ込める (研究プレビューで契約が変わりうる。plan-p0.md リスク)
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { toChannelParams } from '../shared/format.js'
import type { Message } from '../shared/types.js'
import { skippedText } from './instructions.js'

// 存在するだけで Claude Code が通知リスナーを登録する (design.md §6.1)
export const CHANNEL_CAPABILITY = { 'claude/channel': {} }

// Claude Code が tool search で遅延ロードせず、最初から読み込むようにする (design.md §6.1c)
export const ALWAYS_LOAD_META = { 'anthropic/alwaysLoad': true }

// トランスポートに書けた時点で解決する。Claude が読んだ保証ではない (protocol.md §4)
export async function pushToChannel(server: Server, m: Message, mailbox: string): Promise<void> {
  await server.notification({ method: 'notifications/claude/channel', params: { ...toChannelParams(m, mailbox) } })
}

// agent-hub 自身からのお知らせ。from="hub" は送り手が名乗れない値 (Sender は user / mailbox だけ)
export async function pushSkippedNotice(server: Server, skipped: number, mailbox: string): Promise<void> {
  const content = skippedText(skipped, mailbox)
  await server.notification({ method: 'notifications/claude/channel', params: { content, meta: { kind: 'notice', from: 'hub', mailbox } } })
}
