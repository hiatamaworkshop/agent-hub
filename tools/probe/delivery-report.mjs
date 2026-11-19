#!/usr/bin/env node
// Reads logs/probe.jsonl after the last run marker and prints, for each delivery check of design.md §6.3 (B1-B9), what the
// log shows (C172). The log cannot see the screen: what only the person at the terminal saw is left for them to write down.
//   node tools/probe/delivery-report.mjs --mark            writes a run marker (do this before starting the first session)
//   node tools/probe/delivery-report.mjs                   the report for the run since the last marker
//   node tools/probe/delivery-report.mjs --log <file>      the same, for another log file (default logs/probe.jsonl)
// Sessions are told apart by the probe's `startup` lines: the first is the start with the channel flag, a later one the
// start without it (B8).
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_LOG = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'logs', 'probe.jsonl')
const logArg = process.argv.indexOf('--log')
if (logArg >= 0 && (!process.argv[logArg + 1] || process.argv[logArg + 1].startsWith('--'))) {
  console.log('--log needs a file: node tools/probe/delivery-report.mjs --log <file>')
  process.exit(1)
}
const LOG_FILE = logArg >= 0 ? resolve(process.argv[logArg + 1]) : DEFAULT_LOG

if (process.argv.includes('--mark')) {
  appendFileSync(LOG_FILE, JSON.stringify({ ts: new Date().toISOString(), kind: 'run-marker', data: { for: 'design.md §6.3' } }) + '\n')
  console.log(`marked ${LOG_FILE}`)
  process.exit(0)
}

if (!existsSync(LOG_FILE)) {
  console.log(`No probe log at ${LOG_FILE}. Run the probe session first (tools/probe/README.md step 1).`)
  process.exit(1)
}

const all = readFileSync(LOG_FILE, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
const markAt = all.map((e) => e.kind).lastIndexOf('run-marker')
const lines = markAt >= 0 ? all.slice(markAt + 1) : all
if (markAt < 0) console.log('(no run marker found: reading the whole log)')

// Split into sessions at each startup line
const sessions = []
for (const e of lines) {
  if (e.kind === 'startup') sessions.push({ startup: e, events: [] })
  else if (sessions.length) sessions.at(-1).events.push(e)
}
if (!sessions.length) {
  console.log('No probe session in the log since the marker. Start one (tools/probe/README.md step 1) and run this again.')
  process.exit(1)
}

const t = (e) => Date.parse(e.ts)
const hooks = (s, name) => s.events.filter((e) => e.kind === 'hook' && (!name || e.data?.payload?.hook_event_name === name))
const pushes = (s, name) => s.events.filter((e) => e.kind === 'pushed' && e.data?.meta?.case === name)
const after = (s, e, pred, withinMs) => s.events.find((x) => t(x) > t(e) && t(x) - t(e) <= withinMs && pred(x))
const isStop = (x) => x.kind === 'hook' && x.data?.payload?.hook_event_name === 'Stop'
const out = []
const row = (id, verdict, detail) => out.push(`${id}  ${verdict.padEnd(9)} ${detail}`)

const s1 = sessions[0]
const s2 = sessions[1]
const init = s1.events.find((e) => e.kind === 'rpc-in' && e.data?.method === 'initialize')
const client = init?.data?.params?.clientInfo
console.log(`Session 1 started ${s1.startup.ts}; Claude Code ${client?.version ?? '(no initialize)'}; protocol ${init?.data?.params?.protocolVersion ?? '?'}`)
if (s2) console.log(`Session 2 started ${s2.startup.ts}`)

// B2 first: a Stop after the hello push with nothing typed means the notification started a turn. That is also B1's evidence
const hello = pushes(s1, 'hello')[0]
const woke = hello && after(s1, hello, isStop, 180_000)
row('B1', woke ? 'ok' : hello ? 'check' : 'not run', woke ? 'a notification reached the model (see B2); also confirm the banner line was shown' : 'no evidence of a registered channel in the log; did the banner line show?')
row('B2', woke ? 'ok' : hello ? 'NOT SEEN' : 'not run', hello ? (woke ? `a turn ended ${Math.round((t(woke) - t(hello)) / 1000)} s after /case/hello (no typing in between, as the step asks)` : 'no Stop within 3 minutes of /case/hello') : 'send /case/hello (step 2)')
row('B3', client?.name === 'claude-code' ? 'ok' : 'CHANGED', `clientInfo.name = ${JSON.stringify(client?.name)}`)

const notes = s1.events.filter((e) => e.kind === 'note').map((e) => String(e.data?.text ?? ''))
const bodyNote = notes.find((n) => n.includes('INJECTED-LINE'))
const attrNote = notes.find((n) => n.includes('probe_quote'))
const bodyOk = bodyNote && bodyNote.includes('<\\/channel>') && !/BEFORE <\/channel>/.test(bodyNote)
const attrOk = attrNote && attrNote.includes('&quot;') && attrNote.includes('&amp;')
row('B4', !bodyNote || !attrNote ? 'not run' : bodyOk && attrOk ? 'ok' : 'CHANGED', `body: ${bodyNote ? (bodyOk ? '</channel> arrived as <\\/channel>' : 'no <\\/channel> in the copy') : 'no copy (step 3)'}; meta: ${attrNote ? (attrOk ? 'values arrived as entities' : 'values not escaped as before') : 'no copy (step 3b)'}`)

const h = hooks(s1)
const missing = h.filter((e) => !e.data?.payload?.session_id || !e.data?.payload?.cwd)
const stop = hooks(s1, 'Stop')[0]
row('B5', !h.length ? 'not run' : !missing.length && stop && 'background_tasks' in stop.data.payload ? 'ok' : 'CHANGED', `${h.length} hook inputs, ${missing.length} without session_id or cwd; Stop ${stop ? (('background_tasks' in stop.data.payload) ? 'has' : 'lacks') + ' background_tasks' : 'not seen'}`)

const env = s1.startup.data?.env ?? {}
const headerOk = h.length && h.every((e) => e.data?.headers?.['x-hub-mailbox'] === env.HUB_MAILBOX)
const sid = env.CLAUDE_CODE_SESSION_ID
const firstSid = h[0]?.data?.payload?.session_id
row('B6', !h.length ? 'not run' : headerOk && env.PROBE_EXPANDED_MAILBOX === env.HUB_MAILBOX && sid && sid === firstSid ? 'ok' : 'CHANGED',
  `X-Hub-Mailbox ${headerOk ? 'expanded on every hook' : 'missing or not expanded'}; HUB_MAILBOX inherited: ${env.HUB_MAILBOX ?? 'no'}; CLAUDE_CODE_SESSION_ID ${sid ? (sid === firstSid ? '= the hooks\' session_id' : `≠ the hooks' (${firstSid})`) : 'absent'}`)

const ask = hooks(s1, 'PreToolUse').find((e) => e.data?.payload?.tool_name === 'AskUserQuestion')
const dq = ask && pushes(s1, 'during_question').find((e) => t(e) > t(ask))
// A permission prompt counts unless it is within 60 s after the question (the prompt the question itself may raise)
const perm = hooks(s1, 'Notification').filter((e) => e.data?.payload?.notification_type === 'permission_prompt' && !(ask && t(e) >= t(ask) && t(e) - t(ask) <= 60_000))
// A permission wait runs from its prompt to the session's next hook input after it (open-ended if there is none)
const waitEnd = (p) => hooks(s1).find((x) => t(x) > t(p))
const helloInPerm = perm.some((p) => {
  const end = waitEnd(p)
  return pushes(s1, 'hello').some((x) => t(x) > t(p) && (!end || t(x) < t(end)))
})
row('B7', ask && dq ? 'see screen' : 'not run', `question: ${ask && dq ? `notification pushed ${Math.round((t(dq) - t(ask)) / 1000)} s into the wait` : 'step 4 not in the log'}; permission: ${helloInPerm ? 'a notification was pushed during a permission wait' : 'not in the log'}. Whether each was held (not taken as the answer, the dialog stayed, handed over after) is what you saw`)

if (s2) {
  const h2 = pushes(s2, 'hello')[0]
  const turned = h2 && after(s2, h2, isStop, 120_000)
  row('B8', !h2 ? 'not run' : turned ? 'CHANGED' : 'ok', !h2 ? 'send /case/hello to the second session' : turned ? 'a turn followed the notification without the flag: delivery now reaches the model, or you typed' : 'no turn within 2 minutes of the notification (dropped silently, as before); also confirm nothing showed and no error')
} else row('B8', 'not run', 'start a second session without the channel flag (design.md §6.3, B8)')

const starts = hooks(s1, 'SessionStart').filter((e) => e.data?.payload?.source === 'clear')
const sids = new Set(hooks(s1, 'Stop').map((e) => e.data?.payload?.session_id))
row('B9', !starts.length && sids.size < 2 ? 'not run' : sids.size >= 2 && hooks(s1).every((e) => e.data?.headers?.['x-hub-mailbox']) ? 'ok' : 'CHANGED', `${sids.size} distinct session_id on Stop hooks; ${starts.length} SessionStart with source "clear"`)

console.log('')
for (const l of out) console.log(l)
console.log('\nok: as recorded. CHANGED: differs from the record; write a new design.md §6.1 entry. not run / see screen: a step to do, or what you saw.')
