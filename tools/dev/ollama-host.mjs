#!/usr/bin/env node
// A check client for the inbox path (C191): a local Ollama model that uses agent-hub's shim as an MCP server.
// Ollama is a model runtime, not an MCP client, so this host does the MCP part: it starts the shim over stdio with its own
// clientInfo.name (not claude-code, so the shim takes the inbox path, design.md §3.7), passes the shim's tool list to Ollama as
// `tools`, and runs the model's tool calls through the shim. The shim's instructions are given to the model as the system message.
//
// A turn happens only when a line is typed (or piped) on this host's stdin. There is no timer and no loop of its own: after a
// reply the host waits for the next line. The shim reads HUB_TOKEN the way it always does (the environment first, then agent-hub's
// `.env`); this host never reads the token.
//
// Usage (from the agent-hub folder):
//   node tools/dev/ollama-host.mjs --mailbox <name> [--model qwen2.5:3b] [--ollama http://127.0.0.1:11434] [--hub <url>]
// --hub sets HUB_URL for the shim (default: the shim's own setting, the environment or `.env`). Ctrl+C or the line /exit ends it.
//
// Not run by npm test or CI: it needs a local Ollama with the model, and a Hub (design.md §6.1ak records a run).
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CLIENT_NAME = 'ollama-check-host'
// Limits how many model calls one typed line may cause (a model that keeps calling tools is stopped, not looped)
const MAX_STEPS = 6

function parseArgs(argv) {
  const opts = { model: 'qwen2.5:3b', ollama: 'http://127.0.0.1:11434', mailbox: undefined, hub: undefined }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    const val = argv[i + 1]
    if (key === '--model') opts.model = need(key, val, argv, i++)
    else if (key === '--ollama') opts.ollama = need(key, val, argv, i++)
    else if (key === '--mailbox') opts.mailbox = need(key, val, argv, i++)
    else if (key === '--hub') opts.hub = need(key, val, argv, i++)
    else throw new Error(`unknown option: ${key}`)
  }
  if (!opts.mailbox) throw new Error('--mailbox <name> is required (the Mailbox this host attaches as)')
  opts.ollama = opts.ollama.replace(/\/+$/, '')
  return opts
}

function need(key, val, argv, i) {
  if (val === undefined || val.startsWith('--')) throw new Error(`${key} needs a value`)
  return val
}

const opts = parseArgs(process.argv.slice(2))

// The shim, started as Claude Code would start it, but with another clientInfo.name (set below by the MCP initialize)
const env = { ...process.env, HUB_MAILBOX: opts.mailbox }
if (opts.hub) env.HUB_URL = opts.hub
const client = new Client({ name: CLIENT_NAME, version: '0.1.0' })
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx', join(ROOT, 'src/shim/main.ts')],
  cwd: ROOT,
  env,
  stderr: 'inherit',
})
await client.connect(transport)

const instructions = client.getInstructions() ?? ''
const { tools: shimTools } = await client.listTools()
// Ollama's tool format: the shim's name, description and input schema as they are
const tools = shimTools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description ?? '', parameters: t.inputSchema } }))

const messages = [{ role: 'system', content: instructions }]
console.error(`[host] connected: client=${CLIENT_NAME} mailbox=${opts.mailbox} model=${opts.model} ollama=${opts.ollama}`)
console.error(`[host] tools: ${tools.map((t) => t.function.name).join(', ')}`)

// One typed line: send the messages to the model; run any tool calls it makes through the shim; stop when it answers in text
async function turn(line) {
  messages.push({ role: 'user', content: line })
  for (let step = 1; step <= MAX_STEPS; step++) {
    const res = await fetch(`${opts.ollama}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: opts.model, messages, tools, stream: false }),
    })
    if (!res.ok) throw new Error(`Ollama /api/chat ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const { message } = await res.json()
    messages.push(message)
    const calls = message.tool_calls ?? []
    if (calls.length === 0) {
      console.log(message.content ?? '')
      return
    }
    for (const call of calls) {
      const name = call.function?.name
      let args = call.function?.arguments ?? {}
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args)
        } catch {
          args = {}
        }
      }
      const result = await client.callTool({ name, arguments: args })
      const out = (result.content ?? []).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n')
      console.error(`[host] step ${step}: tool ${name} ${JSON.stringify(args)}${result.isError ? ' (error)' : ''}`)
      console.error(out)
      messages.push({ role: 'tool', content: out, tool_name: name })
    }
  }
  console.log(`[host] stopped after ${MAX_STEPS} model calls in this turn`)
}

// The turn starts only when a line is read. Lines are handled one at a time, so a piped file waits for each turn to finish
const rl = createInterface({ input: process.stdin })
for await (const raw of rl) {
  const line = raw.trim()
  if (line === '') continue
  if (line === '/exit') break
  try {
    await turn(line)
  } catch (e) {
    console.error(`[host] error: ${e instanceof Error ? e.message : String(e)}`)
  }
}
await client.close().catch(() => undefined)
process.exit(0)
