#!/usr/bin/env node
// SessionStart command hook (C129, design.md §3.13). After a context reset (compact, clear, resume, or a new start that takes over a
// Mailbox) it prints the requests still open in this session's Mailbox to stdout. Plain stdout on SessionStart is added to the new
// context (design.md §6.1ae). The text is made by src/shared/open-requests.js, the same function the shim's open_requests tool uses.
// Read-only: GET /mailboxes/resolve, GET /mailboxes, and GET /messages?after for the seq of each listed request. It never posts and
// never moves a cursor.
//
// It prints nothing and exits 0 when there is nothing to print or anything fails: no HUB_TOKEN, no Mailbox, an unreachable Hub,
// a non-2xx answer, bad JSON, or nothing open. It never fails the start.
//
// Which Mailbox this session is, the Hub answers (GET /mailboxes/resolve, C161) in the order it resolves Events: the session map
// it has learned, then HUB_MAILBOX (the X-Hub-Mailbox header the Event hooks send), then the cwd folder name (design.md §3.4).
// Environment (as for the Event hooks): HUB_TOKEN, HUB_MAILBOX, HUB_PORT (default 7777).
import { messageLookup, openRequestsText } from '../../src/shared/open-requests.js'

// The whole hook. settings.json allows 6 seconds; this ends before that
const BUDGET_MS = 4000
const started = Date.now()
const remaining = () => Math.max(1, BUDGET_MS - (Date.now() - started))

async function readStdin() {
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  return text
}

async function main() {
  const token = process.env.HUB_TOKEN
  if (!token) return ''
  const input = JSON.parse(await readStdin())
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return ''
  const base = `http://127.0.0.1:${process.env.HUB_PORT || '7777'}`
  const get = async (path, headers = {}) => {
    const res = await fetch(base + path, { headers: { ...headers, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(remaining()) })
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`)
    return res.json()
  }
  const query = new URLSearchParams()
  if (typeof input.session_id === 'string' && input.session_id !== '') query.set('session_id', input.session_id)
  query.set('cwd', typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : process.cwd())
  const header = process.env.HUB_MAILBOX ? { 'x-hub-mailbox': process.env.HUB_MAILBOX } : {}
  const resolved = await get(`/mailboxes/resolve?${query}`, header)
  const name = resolved && typeof resolved.mailbox === 'string' ? resolved.mailbox : undefined
  if (!name) return ''
  const listed = await get('/mailboxes')
  if (!listed || !Array.isArray(listed.mailboxes)) return ''
  const mb = listed.mailboxes.find((m) => m && m.name === name)
  if (!mb) return ''
  // The id and item of a listed request are in its message. A read that fails is reported as a failed read, not as a deletion
  return openRequestsText(mb, messageLookup(get))
}

// Writes the text and exits. The timer is the last word if the Hub or stdin hangs
setTimeout(() => process.exit(0), BUDGET_MS)
main()
  .then((text) => {
    if (text) process.stdout.write(`${text}\n`, () => process.exit(0))
    else process.exit(0)
  })
  .catch(() => process.exit(0))
