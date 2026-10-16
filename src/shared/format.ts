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
// meta は 1 属性に JSON 文字列で入れる。送り手が書けない Hub 付与の属性とは別の名前になる (protocol.md §6)
function attributes(m: Message, meta: Record<string, unknown> | undefined): Record<string, string> {
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
  if (meta && Object.keys(meta).length > 0) a.meta = JSON.stringify(meta)
  return a
}

// Channels の meta 属性に載せる files の既知のキー。Hub は id/mime/size/width/height を書き、shim は path か error を足す
const CHANNEL_FILE_KEYS = ['id', 'mime', 'size', 'width', 'height', 'path', 'error'] as const

// Channels に渡す meta。属性値の " < > & を Claude Code がどう扱うか未確認 (design.md §6.2-4) のため、
// 確認するまで files の既知のキーだけを載せる。値は変換しない (キーで選ぶだけ)。残るものがなければ undefined。
// ほかの送り手の meta は inbox (<hub-message>) からだけ読める
export function channelMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta || !Array.isArray(meta.files)) return undefined
  const files: Record<string, unknown>[] = []
  for (const f of meta.files as unknown[]) {
    if (typeof f !== 'object' || f === null || Array.isArray(f)) continue
    const kept: Record<string, unknown> = {}
    for (const k of CHANNEL_FILE_KEYS) {
      const v = (f as Record<string, unknown>)[k]
      if (v !== undefined) kept[k] = v
    }
    files.push(kept)
  }
  return files.length > 0 ? { files } : undefined
}

export interface ChannelParams {
  content: string
  meta: Record<string, string>
}

// notifications/claude/channel の params。mailbox は受け取った側の Mailbox 名
export function toChannelParams(m: Message, mailbox: string): ChannelParams {
  return {
    content: escapeClosingTag(m.body, 'channel'),
    meta: { ...attributes(m, channelMeta(m.meta)), mailbox },
  }
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// inbox() (polling) 向け。外側のタグがないので 1 件ずつ <hub-message> で包む
export function toHubMessageText(m: Message): string {
  const attrs = Object.entries(attributes(m, m.meta))
    .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
    .join(' ')
  return `<hub-message ${attrs}>\n${escapeClosingTag(m.body, 'hub-message')}\n</hub-message>`
}
