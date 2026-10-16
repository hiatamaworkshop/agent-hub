// エージェントへ渡す形への変換 (protocol.md §6)。送り手の属性は本文と区別できる場所に置く
import type { Address, Message, Sender } from './types.js'

export function formatAddress(a: Address): string {
  return `${a.type}:${a.id}`
}

export function formatSender(s: Sender): string {
  return `${s.type}:${s.id}`
}

// 本文から外側のタグを閉じられないよう、閉じタグの先頭 `</tag` を `<\/tag` にする。
// `</channel >` のような空白入りや大文字も閉じタグとして扱われうるので、`>` の有無や大小を問わない
export function escapeClosingTag(body: string, tag: string): string {
  return body.replace(new RegExp(`</(${tag})`, 'gi'), '<\\/$1')
}

// meta のキーは英数字とアンダースコアのみ (それ以外は Claude Code が黙って捨てる。design.md §6.1)
function attributes(m: Message): Record<string, string> {
  const a: Record<string, string> = {
    id: m.id,
    seq: String(m.seq),
    kind: m.kind,
    from: formatSender(m.from),
  }
  if (m.from.role) a.from_role = m.from.role
  a.to = formatAddress(m.to)
  if (m.replyTo) a.reply_to = m.replyTo
  if (m.forwardedFrom) a.forwarded_from = m.forwardedFrom
  // meta は 1 属性に JSON 文字列で入れる。送り手が書けない Hub 付与の属性とは別の名前になる (protocol.md §6)
  // Channels 経路では属性値の " < > & を Claude Code がエスケープするか未確認 (design.md §6.2-4)。確認するまで変換しない
  if (m.meta && Object.keys(m.meta).length > 0) a.meta = JSON.stringify(m.meta)
  return a
}

export interface ChannelParams {
  content: string
  meta: Record<string, string>
}

// notifications/claude/channel の params。mailbox は受け取った側の Mailbox 名
export function toChannelParams(m: Message, mailbox: string): ChannelParams {
  return {
    content: escapeClosingTag(m.body, 'channel'),
    meta: { ...attributes(m), mailbox },
  }
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// inbox() (polling) 向け。外側のタグがないので 1 件ずつ <hub-message> で包む
export function toHubMessageText(m: Message): string {
  const attrs = Object.entries(attributes(m))
    .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
    .join(' ')
  return `<hub-message ${attrs}>\n${escapeClosingTag(m.body, 'hub-message')}\n</hub-message>`
}
