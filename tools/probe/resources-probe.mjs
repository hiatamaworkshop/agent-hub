#!/usr/bin/env node
// design.md §6.1m の実機検証用プローブ (C1)。本実装ではない。
// MCP 標準の resources/subscribe + notifications/resources/updated で、クライアントがモデルのターンを始めるかを見る。
// クライアントからの要求をすべて logs/resources-probe.log に追記する。logs/resources-trigger.txt を書き換えると、
// 未読を 1 つ増やして resources/updated と list_changed を送る。stdout は MCP が使うので書かない。
import { appendFileSync, mkdirSync, watchFile, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const logs = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'logs')
mkdirSync(logs, { recursive: true })
const LOG = join(logs, 'resources-probe.log')
const TRIGGER = join(logs, 'resources-trigger.txt')
const log = (s) => appendFileSync(LOG, `${new Date().toISOString()} ${s}\n`)
const URI = 'hub://inbox'
let unread = 0
const subscribed = new Set()

const server = new Server(
  { name: 'resources-probe', version: '0.0.1' },
  {
    capabilities: { resources: { subscribe: true, listChanged: true }, tools: {} },
    instructions: 'hub://inbox holds unread messages for you. When it changes, call the read_inbox tool.',
  },
)
server.oninitialized = () => log(`initialized client=${JSON.stringify(server.getClientVersion())} caps=${JSON.stringify(server.getClientCapabilities())}`)
server.setRequestHandler(ListResourcesRequestSchema, () => {
  log('resources/list')
  return { resources: [{ uri: URI, name: 'inbox', description: 'Unread messages for this session', mimeType: 'text/plain' }] }
})
server.setRequestHandler(ReadResourceRequestSchema, (req) => {
  log(`resources/read ${req.params.uri}`)
  return { contents: [{ uri: URI, mimeType: 'text/plain', text: `unread: ${unread}` }] }
})
server.setRequestHandler(SubscribeRequestSchema, (req) => {
  log(`resources/subscribe ${req.params.uri}`)
  subscribed.add(req.params.uri)
  return {}
})
server.setRequestHandler(UnsubscribeRequestSchema, (req) => {
  log(`resources/unsubscribe ${req.params.uri}`)
  subscribed.delete(req.params.uri)
  return {}
})
server.setRequestHandler(ListToolsRequestSchema, () => {
  log('tools/list')
  return { tools: [{ name: 'read_inbox', description: 'Read unread messages', inputSchema: { type: 'object', properties: {} } }] }
})
server.setRequestHandler(CallToolRequestSchema, (req) => {
  log(`tools/call ${req.params.name}`)
  const text = `PROBE-MESSAGE #${unread}: reply with the word "pineapple".`
  unread = 0
  return { content: [{ type: 'text', text }] }
})

writeFileSync(TRIGGER, '')
watchFile(TRIGGER, { interval: 500 }, async () => {
  unread += 1
  log(`trigger -> unread=${unread} subscribed=${[...subscribed].join(',') || '(none)'}`)
  try {
    await server.notification({ method: 'notifications/resources/updated', params: { uri: URI } })
    await server.notification({ method: 'notifications/resources/list_changed' })
    log('sent resources/updated + list_changed')
  } catch (e) {
    log(`send failed: ${e}`)
  }
})

log('--- start')
await server.connect(new StdioServerTransport())
