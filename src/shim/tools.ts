// The MCP tools the shim publishes (protocol.md §5). main.ts serves them for tools/list and docs:check reads their names (C124), so this file has no side effects
import { MESSAGE_KINDS } from '../shared/types.js'
import { ALWAYS_LOAD_META } from './channel.js'

export const SHIM_TOOLS = [
  {
    name: 'post_message',
    description:
      'agent-hub にメッセージを送る。受け取ったメッセージ (<channel> / <hub-message>) への返信は kind="reply" と reply_to=<その id> を指定する (to を省略すると送り手に返る)。' +
      '結果は id / seq / to と、user 宛てなら delivered (UI に表示される)、それ以外は recipients (届けた Mailbox)。recipients が空なら warning が付く。' +
      '相手が全員未接続なら unattached と warning が付く。受け付けは済んでおり、相手が接続したときに未読として届く。item が C<n> の形でなければエラーになる。',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...MESSAGE_KINDS], description: 'request (依頼) / reply (返信) / notice (通知)' },
        body: { type: 'string', description: '本文' },
        to: { type: 'string', description: '宛先。mailbox:<名前> / role:<名前> / topic:<名前> / user:browser。role:<名前> は自分と同じプロジェクト (作業フォルダ) の Mailbox にだけ届く。ほかのプロジェクトには mailbox:<名前> で送る。reply では省略可' },
        reply_to: { type: 'string', description: '返信元のメッセージ id (kind=reply では必須)' },
        item: { type: 'string', description: 'roadmap の項目 ID (C<n> の形。例: C77)。項目の作業の request / reply に付ける。reply で省くと、元のメッセージの項目を引き継ぐ' },
      },
      required: ['kind', 'body'],
    },
  },
  {
    name: 'subscribe',
    description:
      'トピックを個別に購読する。以後そのトピック宛てのメッセージを受け取る。role の既定購読 (roles.json) にあるトピックは購読しなくても届く。今の購読は whoami で確認できる',
    inputSchema: { type: 'object', properties: { topic: { type: 'string', description: 'トピック名。例: user.message、review.request' } }, required: ['topic'] },
  },
  {
    name: 'unsubscribe',
    description: 'トピックの個別購読を解除する。role の既定購読 (roles.json) は解除されない',
    inputSchema: { type: 'object', properties: { topic: { type: 'string', description: '解除するトピック名' } }, required: ['topic'] },
  },
  {
    name: 'inbox',
    description:
      '自分の Mailbox の未読を取り出す。各メッセージは <hub-message> で包まれて返り、返した分は既読になる。<channel> で届いたものは既読なので含まれない (unconfirmed: true なら含む)',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, description: '最大件数 (既定 20)' },
        after: { type: 'integer', minimum: 0, description: 'この seq より後だけを取る (省略時は未読の先頭から)' },
        unconfirmed: {
          type: 'boolean',
          description: 'true なら、<channel> で渡したが受領の確認 (inbox で取り出す・reply_to で返信する) がない分も返す。<channel> が届いていないときの取り直し用',
        },
      },
    },
  },
  {
    name: 'whoami',
    description: 'agent-hub での自分の Mailbox 名・role・接続状態・購読を返す',
    inputSchema: { type: 'object', properties: {} },
  },
].map((t) => ({ ...t, _meta: ALWAYS_LOAD_META }))
