// @ts-check
// The card state derivation (design.md §3.15, C150): one copy, used by the page (public/index.html, which loads this file
// from GET /shared/card-state.js) and by any command that imports it. No Node APIs and no DOM: data in, state out.
// The caller gives the clock (ctx.now, in ms) and the facts it holds itself (CardContext below). The page passes the
// browser's clock; a command passes its own. The Hub holds no state for this: it only sends the backlog and the Events.

/**
 * What the derivation needs besides the Mailbox. The page fills it from its own state (the Events it has seen over SSE,
 * the browser's clock, the limits from GET /config); a command fills it from the Hub's responses.
 * @typedef {object} CardContext
 * @property {number} now the current time in ms (Date.now() in the page)
 * @property {number | null} hubStartedAt the start time of the Hub that answered, in ms; null if unknown (GET /mailboxes startedAt)
 * @property {number | null} readRetentionHours the Hub's read retention in hours (GET /config limits.readRetentionHours); null if unknown, 0 means kept
 * @property {any[]} mailboxes the Mailboxes the caller has, used to tell whether a request's target is connected
 * @property {any} lastEvent the newest Event of the Mailbox the caller knows (its own list, and the Hub's backlog.lastEvent), or null
 * @property {any} lastTurnEnd the newest turn end of the Mailbox the caller knows (the same two sources), or null
 * @property {(seq: number) => any} messageOf the stored Message with this seq, or null (not held: the page fetches it, C183)
 * @property {((name: string, seq: number) => boolean) | undefined} [personWroteAfter] whether the person has sent this Mailbox a Message newer than seq (C183); absent means no
 * @property {boolean | undefined} [historyReady] false while the page has not read the history yet: a report to the person is then not counted, because the person's later Messages are not all held (C183). Absent means ready
 */

/** How long a hand-over counts as Working when its turn end is not known (the Event log may have dropped it), in hours. */
export const STALE_HANDED_HOURS = 12
/** How long a turn that ended with background tasks still running counts as Working, in minutes (C43). */
export const BACKGROUND_MAX_MINUTES = 60

/** Event kinds that wait for an answer from a person (a question, or a permission prompt). */
export const WAITING = new Set(['question', 'permission'])

/** Labels of Event kinds, as shown in the reasons ("detail") of a card. */
export const EVENT_LABEL = {
  'turn.end': 'turn end', 'turn.failed': 'turn failed', question: 'question', 'question.answered': 'answered',
  permission: 'permission', 'permission.resolved': 'approved', notification: 'notification', 'session.boundary': 'boundary',
  'session.start': 'session start', 'model.switch': 'model switch',
}

/** Which field of an Event's payload holds its detail (the reason of a turn failure, a notification, a tool name). */
export const DETAIL_FIELD = { 'turn.failed': 'error', notification: 'notification_type', 'permission.resolved': 'tool_name' }

/** Notifications that mean the person has to act: the automatic resume after a usage limit does not go on. The value is the reason. */
export const QUOTA_NEEDS_YOU = new Map([
  ['quota_auto_resume_stale', 'usage limit, press Enter'],
  ['quota_auto_resume_disabled', 'usage limit, auto-resume off'],
])

// The reply-format headings (tools/dev/roles's leader.md and deployer.md; design.md §3.15). A line that starts with a heading and a
// colon begins a section, which runs to the next heading. The kind sets how the section is coloured ('' for none) (C183: this rule is
// read by the page's colouring and by the card, from here, so they cannot drift). The leader's type reads both the English headings
// and the Japanese ones before them (the mapping table of design.md §3.15)
export const REPORT_HEADINGS = new Map([
  ['NEEDS DECISION', 'decide'], ['NEEDS ACTION', 'op'], ['NOT VERIFIED', 'unverified'],
  ['RESULT', ''], ['SKIPPED', ''],
  ['要判断', 'decide'], ['要対応', 'decide'], ['要操作', 'op'], ['未確認', 'unverified'],
  ['結果', ''], ['確認', ''], ['見送り', ''],
  ['GOAL', ''], ['SCOPE', ''], ['SPEC', ''], ['DONE WHEN', ''], ['REPORT FORMAT', ''], ['CHANGED', ''], ['VERIFIED', ''], ['NOTES', ''],
])
export const HEADING_RE = new RegExp(`^(\\s*)(${[...REPORT_HEADINGS.keys()].join('|')})([:：])(.*)$`)
/** A section whose heading is followed by nothing but an empty mark (なし, -, —, none): it is not coloured and does not count (C183). */
export const EMPTY_SECTION = /^\s*(なし|-|—|none)?\s*[。.]?\s*$/i

/**
 * The sections of a body, split at its reply-format headings. Each section has its kind, whether it begins with a heading, whether
 * it is empty (its heading is followed by an empty mark only, and nothing else), and its lines. A heading line has pre, hd (the
 * heading and its colon) and rest; any other line has rest only. A body with no heading gives one section with kind ''.
 * @param {string} text
 * @returns {{ kind: string, heading: boolean, empty: boolean, lines: { pre?: string, hd?: string, rest: string }[] }[]}
 */
export function sectionsOf(text) {
  /** @type {{ kind: string, heading: boolean, empty: boolean, lines: { pre?: string, hd?: string, rest: string }[] }[]} */
  const sections = []
  for (const line of String(text).split('\n')) {
    const m = HEADING_RE.exec(line)
    const [pre = '', name = '', colon = '', rest = ''] = m ? [m[1], m[2], m[3], m[4]] : []
    if (m || sections.length === 0) sections.push({ kind: m ? (REPORT_HEADINGS.get(name) ?? '') : '', heading: !!m, empty: false, lines: [] })
    const current = sections[sections.length - 1]
    if (current) current.lines.push(m ? { pre, hd: name + colon, rest } : { rest: line })
  }
  for (const s of sections) s.empty = s.lines.every((l) => (l.hd ? EMPTY_SECTION.test(l.rest ?? '') : (l.rest ?? '').trim() === ''))
  return sections
}

/** What a report asks of the person, by its section kind: a decision or an action (C183). */
export const NEEDS_LABEL = { decide: 'decision', op: 'action' }

/**
 * The parts of a report that need the person: 'decide' (NEEDS DECISION, 要判断, 要対応) and/or 'op' (NEEDS ACTION, 要操作), when the
 * section has content other than an empty mark. Empty when the report asks for nothing (C183).
 * @param {string} text the body of the report
 * @returns {string[]}
 */
export function needsOf(text) {
  const kinds = new Set(sectionsOf(text).filter((s) => s.heading && !s.empty && (s.kind === 'decide' || s.kind === 'op')).map((s) => s.kind))
  return ['decide', 'op'].filter((k) => kinds.has(k))
}

/** An empty tally: a count, and the oldest item it is about (where a badge click goes, C44). */
export const NONE = { count: 0, oldestAt: null, oldestSeq: null, eventId: null }

/**
 * Adds two tallies. The oldest of the two is kept, with its place to jump to.
 * @param {any} a
 * @param {any} b
 */
export function addTally(a, b) {
  const first = [a, b].filter((t) => t.oldestAt).sort((x, y) => Date.parse(x.oldestAt) - Date.parse(y.oldestAt))[0]
  return {
    count: a.count + b.count,
    oldestAt: first ? first.oldestAt : null,
    oldestSeq: first ? first.oldestSeq ?? null : null,
    eventId: first ? first.eventId ?? null : null,
  }
}

/**
 * Whether an Event belongs to an earlier Attachment (a session that is no longer connected). Such an Event is not counted
 * as waiting now: the terminal may be gone (after a restart of the terminal, or a takeover). An Event from after the current
 * attach counts even if its session_id differs (/clear changes it, design.md §6.2).
 * An Attachment with no session_id (a client that sends none, C183) has no session to compare with, so any Event that has a
 * session_id and is older than the attach is an earlier Attachment's: otherwise an earlier Claude Code session's Events would count for it.
 * @param {any} mb
 * @param {any} ev
 */
export function staleEvent(mb, ev) {
  const at = mb.attachment
  if (!at || !ev || !ev.sessionId) return false
  const before = Date.parse(ev.ts) < Date.parse(at.attachedAt)
  if (at.sessionId) return ev.sessionId !== at.sessionId && before
  return before
}

/**
 * The detail of an Event (the usage limit's reason, a notification type, a tool name). The Hub gives it as backlog.lastEvent.detail;
 * an Event from SSE carries it in its payload.
 * @param {any} ev
 * @returns {string}
 */
export function eventDetailOf(ev) {
  if (ev.detail) return ev.detail
  const p = ev.payload && typeof ev.payload === 'object' ? ev.payload : {}
  const v = DETAIL_FIELD[/** @type {keyof typeof DETAIL_FIELD} */ (ev.kind)] ? p[DETAIL_FIELD[/** @type {keyof typeof DETAIL_FIELD} */ (ev.kind)]] : ''
  return typeof v === 'string' ? v : ''
}

/** The effort levels the card shows (C61). */
export const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

/**
 * The last model and effort seen in a Mailbox's Events, for the card's line (C61, C182). The model comes from session.start (`model`;
 * Antigravity's `modelName`), model.switch (`to_model`), and, for Antigravity only, turn.end (`modelName`). A superseded Event does not
 * count. Values only: the card says they were seen, not that they are the current setting.
 * @param {Iterable<any>} events the Events the caller holds (any Mailbox; the name selects)
 * @param {string} name the Mailbox
 * @returns {{ model: string | null, effort: string | null }}
 */
export function lastSeenOf(events, name) {
  /** @type {{ ts: string, id: string } | null} */
  let model = null
  /** @type {{ ts: string, level: string } | null} */
  let effort = null
  for (const ev of events) {
    if (ev.mailbox !== name || ev.superseded) continue
    const p = ev.payload && typeof ev.payload === 'object' ? ev.payload : {}
    const antigravity = ev.source === 'antigravity'
    let value = null
    if (ev.kind === 'session.start') value = p.model ?? (antigravity ? p.modelName : null)
    else if (ev.kind === 'turn.end' && antigravity) value = p.modelName
    else if (ev.kind === 'model.switch') value = p.to_model
    if (typeof value === 'string' && value !== '' && (!model || model.ts < ev.ts)) model = { ts: ev.ts, id: value }
    const level = p.effort && typeof p.effort === 'object' ? p.effort.level : null
    if (typeof level === 'string' && EFFORT_LEVELS.has(level) && (!effort || effort.ts < ev.ts)) effort = { ts: ev.ts, level }
  }
  return { model: model ? model.id : null, effort: effort ? effort.level : null }
}

/**
 * Background tasks still running when a turn ended (Stop's background_tasks). The Hub gives it as lastTurnEnd.running;
 * an Event from SSE carries it in its payload.
 * @param {any} end
 * @returns {{ count: number, description: string } | null}
 */
export function runningOf(end) {
  if (!end) return null
  if (end.running) return end.running
  const p = end.payload && typeof end.payload === 'object' ? end.payload : {}
  const tasks = Array.isArray(p.background_tasks) ? p.background_tasks.filter((/** @type {any} */ t) => t && t.status === 'running') : []
  if (!tasks.length) return null
  return { count: tasks.length, description: typeof tasks[0].description === 'string' ? tasks[0].description : '' }
}

/**
 * The first line of a handed Message: the summary of a request (the GOAL line and the like), or the kind and sender otherwise.
 * @param {any} m
 * @returns {string}
 */
export function summaryOf(m) {
  if (!m) return ''
  if (m.kind !== 'request') return `${m.kind} from ${m.from.id}`
  return (m.body || '').split('\n').find((/** @type {string} */ l) => l.trim()) || ''
}

/**
 * The targets of this Mailbox's open requests, without the person. Empty if there are none.
 * @param {any} outgoing
 */
export function outgoingTargets(outgoing) {
  return [...new Set((outgoing.to || []).filter((/** @type {any} */ a) => a.type !== 'user').map((/** @type {any} */ a) => a.id))].join(', ')
}

/**
 * The names of the targets of open requests (not the person) that are all not connected; null if any is connected,
 * or if the Hub does not say who the recipients are (an older Hub).
 * @param {any} outgoing
 * @param {any[]} mailboxes
 * @returns {string | null}
 */
export function absentTargets(outgoing, mailboxes) {
  const targets = (outgoing.to || []).filter((/** @type {any} */ a) => a.type !== 'user')
  if (!targets.length || !targets.every((/** @type {any} */ a) => Array.isArray(a.recipients))) return null
  /** @type {string[]} */
  const names = []
  for (const a of targets) {
    if (!a.recipients.length) { names.push(a.id); continue }
    for (const name of a.recipients) {
      const mb = mailboxes.find((x) => x.name === name)
      if (!mb || mb.attachment) return null
      names.push(name)
    }
  }
  return [...new Set(names)].join(', ')
}

/**
 * How long a hand-over counts as Working when no turn end is known, in hours. A shorter read retention than that
 * (the Event log is dropped sooner) shortens it.
 * @param {number | null} readRetentionHours
 */
export function staleHandedHours(readRetentionHours) {
  const r = readRetentionHours
  return typeof r === 'number' && r > 0 ? Math.min(STALE_HANDED_HOURS, r) : STALE_HANDED_HOURS
}

/**
 * Whose move it is: the Events and requests that a person has to answer. `count` is how many; `detail` says why.
 * @param {any} mb
 * @param {CardContext} ctx
 * @returns {{ count: number, oldestAt: string | null, oldestSeq: number | null, eventId: string | null, detail: string }}
 */
export function humanTurnOf(mb, ctx) {
  let t = NONE
  /** @type {string[]} */
  const why = []
  const ev = ctx.lastEvent
  if (ev && WAITING.has(ev.kind) && !staleEvent(mb, ev)) {
    t = addTally(t, { count: 1, oldestAt: ev.ts, eventId: ev.id })
    why.push(/** @type {Record<string, string>} */ (EVENT_LABEL)[ev.kind] || ev.kind)
  } else if (ev && ev.kind === 'notification' && QUOTA_NEEDS_YOU.has(eventDetailOf(ev)) && !staleEvent(mb, ev)) {
    // The automatic resume after a usage limit does not go on (stale), or is off (disabled). A person presses Enter or changes the setting
    t = addTally(t, { count: 1, oldestAt: ev.ts, eventId: ev.id })
    why.push(/** @type {string} */ (QUOTA_NEEDS_YOU.get(eventDetailOf(ev))))
  }
  const out = mb.backlog && mb.backlog.outgoing
  const asks = ((out && out.to) || []).filter((/** @type {any} */ a) => a.type === 'user')
  // A Hub without a count per target (before C40) counts one request to the person as one
  for (const a of asks) t = addTally(t, { count: a.count ?? 1, oldestAt: a.oldestAt ?? out.oldestAt, oldestSeq: a.oldestSeq ?? null })
  if (asks.length) why.push('request')
  // A report to the person that asks for a decision or an action (C183): the Mailbox's latest Message to the person, while it has such a
  // section with content, and the person has not written to this Mailbox since. The Hub gives only its seq and time; the page holds (or
  // fetches) the body. Until the body is held nothing counts, so the card waits for the page
  const report = mb.backlog && mb.backlog.lastToUser
  if (report && ctx.historyReady !== false) {
    const body = ctx.messageOf(report.seq)
    const newer = typeof ctx.personWroteAfter === 'function' && ctx.personWroteAfter(mb.name, report.seq)
    const needs = body && !newer ? needsOf(body.body || '') : []
    if (needs.length) {
      t = addTally(t, { count: 1, oldestAt: report.ts, oldestSeq: report.seq })
      for (const k of needs) why.push(/** @type {Record<string, string>} */ (NEEDS_LABEL)[k] ?? k)
    }
  }
  return { ...t, detail: why.join(', ') }
}

/**
 * The state of a card (design.md §3.15): Needs you, Paused, Working, Stopped, Waiting on others, Idle, Offline.
 * Returns null for a Hub that sends no backlog (no state is shown). `since` is the time the state began; `until` (ms) is
 * when a Working that waits for background tasks stops being Working; `quiet` marks Working that is not a signal (only unread
 * messages); `guess` marks Working when the session has sent no Events, so its turn end is not known.
 * @param {any} mb a Mailbox as the Hub describes it (attachment, backlog)
 * @param {CardContext} ctx
 * @returns {{ key: string, since?: string | null, until?: number | null, detail?: string, quiet?: boolean, guess?: boolean } | null}
 */
export function stateOf(mb, ctx) {
  if (!mb.attachment) return { key: 'offline' }
  const human = humanTurnOf(mb, ctx)
  if (human.count) return { key: 'you', since: human.oldestAt, detail: human.detail }
  const ev = ctx.lastEvent
  // Paused: a usage limit stopped the turn. Checked before Working, because the Hub keeps the handed Message after the stop
  // (no Event marks the stop itself), and that Message would read as Working. The next Event (the resume, turn.end) ends it
  if (ev && ev.kind === 'turn.failed' && eventDetailOf(ev) === 'rate_limit' && !staleEvent(mb, ev)) return { key: 'paused', since: ev.ts, detail: 'usage limit' }
  const b = mb.backlog
  if (!b || !('outgoing' in b)) return null // a Hub without the facts (before the backlog): no state
  const end = ctx.lastTurnEnd
  const handed = b.lastHanded
  const fresh = handed && ctx.now - Date.parse(handed.ts) < staleHandedHours(ctx.readRetentionHours) * 3600000
  // With no turn end to compare with, a hand-over is Working only while it is in the window and its request is still open (C183):
  // a session that has sent no Events, and has answered (open: false), is Idle. A Mailbox with Events keeps the window rule as before
  // "Events" here are this attachment's: an Event of an earlier Attachment does not count (staleEvent, as for the waiting rules)
  const hasEvents = !!ev && !staleEvent(mb, ev)
  // Older Hubs omit `open`: only an explicit open: false is answered (C183, a missing flag is not an answer)
  const handedWorking = handed && (hasEvents && end ? Date.parse(handed.ts) > Date.parse(end.ts) : fresh && (hasEvents || handed.open !== false))
  // A request handed before this Hub started, with no reply and no turn end since the start: the turn was lost with the
  // restart, so it is shown as Stopped (Health check counts it), not as Working (C142). Only where the rule above
  // would say Working; a hand-over after a turn end is left to the rules below
  if (handedWorking && handed.open && ctx.hubStartedAt !== null && Date.parse(handed.ts) < ctx.hubStartedAt && !(end && Date.parse(end.ts) >= ctx.hubStartedAt)) {
    return { key: 'stopped', since: handed.ts, detail: 'Hub restarted after the hand-over' }
  }
  // Unread messages in a connected session are the agent's move, either just before they are handed over, or waiting for
  // inbox. The signal is for the person's move only (C71), so this is Working without the frame or the pulse (quiet)
  if (b.unread.count && !handedWorking) return { key: 'working', since: b.unread.oldestAt, quiet: true }
  if (handedWorking) {
    // A session with no Events has no hooks, so its turn end is not known: a guess, and the card says so
    return { key: 'working', since: handed.ts, guess: !hasEvents, detail: summaryOf(ctx.messageOf(handed.seq)) }
  }
  // If every target of an open request is not connected, nobody will read it and it stops there. The person starts the
  // session, so this is Needs you (C49). But a turn that ended with no reply is Stopped first, and the absent targets are
  // named after it (C109). Background tasks still running keep the C49 rule (Needs you), not the exception
  const absent = b.outgoing.count ? absentTargets(b.outgoing, ctx.mailboxes) : null
  const bg = runningOf(end)
  const until = end && Date.parse(end.ts) + BACKGROUND_MAX_MINUTES * 60000
  const inBackground = bg && ctx.now < until
  if (b.outgoing.count && !(absent && b.awaitingReply.count && !inBackground)) {
    if (absent) return { key: 'you', since: b.outgoing.oldestAt, detail: `${absent} not connected` }
    return { key: 'delegated', since: b.outgoing.oldestAt, detail: outgoingTargets(b.outgoing) }
  }
  if (b.awaitingReply.count) {
    // The turn ended with background tasks still running (Stop's background_tasks): the session goes on when they finish, so Working (C43)
    if (inBackground) {
      const more = bg.count > 1 ? ` (+${bg.count - 1})` : ''
      return { key: 'working', since: end.ts, until, detail: `background: ${bg.description || 'task'}${more}` }
    }
    // C187: a session with no Events whose last hand-over is not open (a notice, or an answered request, was handed after the request it
    // still owes a reply to). With no turn end to say the turn is over, the newest open request's time decides, as the open hand-over
    // did: Working? (a guess) while that time is in the window. A request handed before this Hub started is Stopped (C142). Past the
    // window it is Stopped, no reply, as before. An older Hub gives no newestAt, and then nothing here changes
    const newest = b.awaitingReply.newestAt
    if (!hasEvents && handed && handed.open === false && !absent && typeof newest === 'string') {
      const t = Date.parse(newest)
      if (ctx.now - t < staleHandedHours(ctx.readRetentionHours) * 3600000) {
        if (ctx.hubStartedAt !== null && t < ctx.hubStartedAt && !(end && Date.parse(end.ts) >= ctx.hubStartedAt)) {
          return { key: 'stopped', since: newest, detail: 'Hub restarted after the hand-over' }
        }
        return { key: 'working', since: newest, guess: true, detail: summaryOf(ctx.messageOf(b.awaitingReply.newestSeq)) }
      }
    }
    return { key: 'stopped', since: end ? end.ts : b.awaitingReply.oldestAt, detail: absent ? `${absent} not connected` : undefined }
  }
  return { key: 'idle', since: end ? end.ts : null }
}
