// inbox ツール (polling 経路、protocol.md §5)。「中身を渡す」全クライアント共通の経路 (design.md §3.9)
import { toInboxText } from '../shared/format.js'
import type { InboxResult } from '../shared/types.js'
import { resolveFiles, type FileContext } from './files.js'
import type { HubClient } from './hub-client.js'

export interface InboxArgs {
  after?: number
  limit?: number
}

// 未読を取り、添付画像の path を足し、ack してから <hub-message> の文面にする。
// ack はツールの結果を返す直前に送る。Channels と同じく「クライアントに渡した」までしか言えない (protocol.md §4)
export async function fetchInbox(hub: HubClient, mailbox: string, args: InboxArgs, files: FileContext, log: (msg: string) => void): Promise<string> {
  const at = hub.attachment
  if (!at) throw new Error(`Hub に接続していない (${hub.state}${hub.lastError ? `: ${hub.lastError}` : ''})`)
  const q = new URLSearchParams()
  if (args.after !== undefined) q.set('after', String(args.after))
  if (args.limit !== undefined) q.set('limit', String(args.limit))
  const r = await hub.request<InboxResult>('GET', `/mailboxes/${mailbox}/inbox${q.size > 0 ? `?${q}` : ''}`)
  const messages = []
  for (const m of r.messages) messages.push(await resolveFiles(m, files))
  for (const m of r.messages) hub.remember(m.id)
  // 失敗しても次の inbox か attach で再送され、id で重複除去できる
  await hub.request('POST', `/attachments/${at.attachmentId}/ack`, { upTo: r.cursor }).catch((e) => log(`ack: ${e}`))
  return toInboxText({ messages, hasMore: r.hasMore }, mailbox)
}
