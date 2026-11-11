// The MCP tools the shim publishes (protocol.md §5). main.ts serves them for tools/list and docs:check reads their names (C124), so this file has no side effects
import { MESSAGE_KINDS } from '../shared/types.js'
import { ALWAYS_LOAD_META } from './channel.js'

export const SHIM_TOOLS = [
  {
    name: 'post_message',
    description:
      'Send a message through agent-hub. To reply to a received message (<channel> / <hub-message>), set kind="reply" and reply_to=<its id>. Without to, it goes back to the sender. ' +
      'The result has id, seq and to, plus delivered for a message to the user (shown in the UI); otherwise recipients (the Mailboxes it was handed to). If recipients is empty, a warning is added. ' +
      'If every recipient is unconnected, unattached and a warning are added. It was accepted, and it arrives as unread when a recipient connects. An error is returned if item is not in the form C<n>.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...MESSAGE_KINDS], description: 'request (asks for work or a reply) / reply (answers a message) / notice (needs no reply)' },
        body: { type: 'string', description: 'body' },
        to: { type: 'string', description: 'Destination: mailbox:<name> / role:<name> / topic:<name> / user:browser. role:<name> reaches only the Mailboxes in the same project (working folder) as yours. For another project, send to mailbox:<name>. Optional for reply.' },
        reply_to: { type: 'string', description: 'id of the message being replied to (required for kind=reply)' },
        item: { type: 'string', description: 'roadmap item ID in the form C<n>, for example C77. Attach it to requests and replies about the work on the item. Omitted on a reply, it inherits the item of the original message.' },
      },
      required: ['kind', 'body'],
    },
  },
  {
    name: 'subscribe',
    description:
      'Subscribe to a topic. From then on, messages addressed to it are received. Topics in the default subscriptions of a role (roles.json) arrive without subscribing. Check your current subscriptions with whoami.',
    inputSchema: { type: 'object', properties: { topic: { type: 'string', description: 'topic name, for example user.message or review.request' } }, required: ['topic'] },
  },
  {
    name: 'unsubscribe',
    description: 'Unsubscribe from a topic. The default subscriptions of a role (roles.json) are not removed.',
    inputSchema: { type: 'object', properties: { topic: { type: 'string', description: 'topic name to unsubscribe' } }, required: ['topic'] },
  },
  {
    name: 'inbox',
    description:
      'Fetch the unread messages of your Mailbox. Each message is returned wrapped in <hub-message>, and what is returned is marked read. Messages that arrived as <channel> are already read, so they are not included (included with unconfirmed: true).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'maximum number (default 20)' },
        after: { type: 'integer', minimum: 0, description: 'only messages after this seq (omitted: from the first unread)' },
        unconfirmed: {
          type: 'boolean',
          description: 'true also returns messages handed over as <channel> that have no confirmation of receipt (fetched with inbox, or answered with reply_to). For fetching again when a <channel> message did not arrive.',
        },
      },
    },
  },
  {
    name: 'open_requests',
    description:
      'List the requests still open in your Mailbox: the ones you owe a reply to, and the ones you sent and still await a reply to. One line per request, with its id, seq, the other side and meta.item; no bodies. ' +
      'Read-only: it does not change what is unread or your cursor. Call it at the start of a session, and whenever you do not know what you are waiting on (for example after the context was compacted or cleared).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'whoami',
    description: 'Returns your Mailbox name, role, connection state and subscriptions in agent-hub',
    inputSchema: { type: 'object', properties: {} },
  },
].map((t) => ({ ...t, _meta: ALWAYS_LOAD_META }))
