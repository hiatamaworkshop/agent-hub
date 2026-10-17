// inbox ツール (polling 経路、protocol.md §5)。「中身を渡す」全クライアント共通の経路 (design.md §3.9)
import { toInboxText } from '../shared/format.js'
import type { InboxResult } from '../shared/types.js'
import { resolveFiles, type FileContext } from './files.js'
import type { HubClient } from './hub-client.js'
import { skippedText } from './instructions.js'

export interface InboxArgs {
  after?: number
  limit?: number
  unconfirmed?: boolean
}

// 未読を取り、添付画像の path を足し、ack してから <hub-message> の文面にする。
// ack はツールの結果を返す直前に、受領の確認 (received) として送る。エージェント自身がツールを呼び、結果として受け取るため (protocol.md §4)
export async function fetchInbox(hub: HubClient, mailbox: string, args: InboxArgs, files: FileContext, log: (msg: string) => void): Promise<string> {
  const at = hub.attachment
  if (!at) throw new Error(`Hub に接続していない (${hub.state}${hub.lastError ? `: ${hub.lastError}` : ''})`)
  const q = new URLSearchParams()
  if (args.after !== undefined) q.set('after', String(args.after))
  if (args.limit !== undefined) q.set('limit', String(args.limit))
  if (args.unconfirmed) q.set('unconfirmed', 'true')
  const r = await hub.request<InboxResult>('GET', `/mailboxes/${mailbox}/inbox${q.size > 0 ? `?${q}` : ''}`)
  const messages = []
  for (const m of r.messages) messages.push(await resolveFiles(m, files))
  for (const m of r.messages) hub.remember(m.id)
  // 失敗しても次の inbox か attach で再送され、id で重複除去できる
  // 受領の確認は返した範囲だけ (r.cursor は返していない既読の先まで進みうる)
  const received = r.messages.length > 0 ? { first: r.messages[0]!.seq, last: r.messages.at(-1)!.seq } : undefined
  await hub.request('POST', `/attachments/${at.attachmentId}/ack`, { upTo: r.cursor, ...(received ? { received } : {}) }).catch((e) => log(`ack: ${e}`))
  // 省略の件数は、届いた未読より先に agent-hub のお知らせとして 1 度だけ伝える (protocol.md §6.3)
  const skipped = hub.takeSkipped()
  return toInboxText({ messages, hasMore: r.hasMore }, mailbox, skipped > 0 ? [skippedText(skipped, mailbox)] : [])
}
