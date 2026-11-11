#!/usr/bin/env node
// SessionStart command hook (C129, design.md §3.13). After a context reset (compact, clear, resume, or a new start that takes over a
// Mailbox) it prints the requests still open in this session's Mailbox to stdout. Plain stdout on SessionStart is added to the new
// context (design.md §6.1ae). The text is made by src/shared/open-requests.js, the same function the shim's open_requests tool uses.
// Read-only: GET /mailboxes, and GET /messages?after for the seq of each listed request. It never posts and never moves a cursor.
//
// It prints nothing and exits 0 when there is nothing to print or anything fails: no HUB_TOKEN, no Mailbox, an unreachable Hub,
// a non-2xx answer, bad JSON, or nothing open. It never fails the start.
//
// The Mailbox is the one whose Attachment has this session_id, then HUB_MAILBOX (the X-Hub-Mailbox header the Event hooks send).
// The Hub's Event resolution also uses the session map it has learned and the cwd folder name (design.md §3.4); this hook does not
// (C129, open: the planning session decides). Environment (as for the Event hooks): HUB_TOKEN, HUB_MAILBOX, HUB_PORT (default 7777).
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

// The Mailbox this session is: its Attachment's session_id first, then HUB_MAILBOX. Undefined when neither matches
function mailboxFor(mailboxes, sessionId, header) {
  if (typeof sessionId === 'string' && sessionId !== '') {
    const hit = mailboxes.find((mb) => mb && mb.attachment && mb.attachment.sessionId === sessionId)
    if (hit) return hit
  }
  if (typeof header === 'string' && header !== '') return mailboxes.find((mb) => mb && mb.name === header)
  return undefined
}

async function main() {
  const token = process.env.HUB_TOKEN
  if (!token) return ''
  const input = JSON.parse(await readStdin())
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return ''
  const base = `http://127.0.0.1:${process.env.HUB_PORT || '7777'}`
  const get = async (path) => {
    const res = await fetch(base + path, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(remaining()) })
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`)
    return res.json()
  }
  const listed = await get('/mailboxes')
  if (!listed || !Array.isArray(listed.mailboxes)) return ''
  const mb = mailboxFor(listed.mailboxes, input.session_id, process.env.HUB_MAILBOX)
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
