// カードの状態 (design.md §3.15) を、別のポートの Hub とヘッドレスの Chrome で場面ごとに確かめる。
// API で場面を作り、CDP で DOM を読んで、期待する状態と照らす。UI には単体テストがないので、UI を変えたら流す。
// 使い方: npm run ui:check  (Chrome の場所は CHROME、ポートは UI_CHECK_PORT / UI_CHECK_CDP_PORT で変えられる)
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PORT = Number(process.env.UI_CHECK_PORT ?? 7793)
const CDP_PORT = Number(process.env.UI_CHECK_CDP_PORT ?? 9333)
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const TOKEN = 'ui-check-token-0123456789'
const HUB = `http://127.0.0.1:${PORT}`
const work = mkdtempSync(join(tmpdir(), 'agent-hub-ui-check-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 5 日前に出され、まだ返信のない依頼 (C44)。Hub は ts を今の時刻で付けるので、起動の前にログへ直接書いておく
mkdirSync(join(work, 'hub'), { recursive: true })
const OLD_BODY = 'GOAL: 5 日前に出した依頼 (返信待ち)'
writeFileSync(
  join(work, 'hub', 'hub.jsonl'),
  JSON.stringify({ op: 'message', message: { id: 'm_ui_check_old', seq: 1, ts: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(), kind: 'request', from: { type: 'user', id: 'browser', role: null }, to: { type: 'mailbox', id: 'demo.old' }, body: OLD_BODY } }) + '\n',
)

const hub = spawn(process.execPath, ['--import', 'tsx', 'src/hub/main.ts'], {
  cwd: ROOT,
  env: { ...process.env, HUB_DATA_DIR: join(work, 'hub'), HUB_PORT: String(PORT), HUB_TOKEN: TOKEN, HUB_READ_RETENTION_HOURS: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let hubLog = ''
hub.stdout.on('data', (d) => (hubLog += d))
hub.stderr.on('data', (d) => (hubLog += d))
let chrome
let ws

async function api(method, path, body, headers = {}) {
  const res = await fetch(HUB + path, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`)
  return text ? JSON.parse(text) : {}
}

async function until(fn, label, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const v = await fn()
      if (v) return v
    } catch {}
    await sleep(250)
  }
  throw new Error(`timeout: ${label}`)
}

let nextId = 0
const pending = new Map()
const paused = [] // Fetch で止めた要求 (/mailboxes を履歴より後に返すための場面で使う)
function cdp(method, params = {}) {
  const id = ++nextId
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

// 画面のカード (名前 → 状態の行と枠のクラス) と、タブのタイトル
async function screen() {
  await sleep(1500) // SSE → Mailbox 一覧の取り直し (300ms) → 描画
  const expr = `JSON.stringify({
    title: document.title,
    cards: [...document.querySelectorAll('#mailboxes .mb')].map((b) => ({
      name: (b.querySelector('.name') || {}).textContent || '',
      cls: b.className,
      state: (b.querySelector('.state') || {}).textContent || '',
      doing: (b.querySelector('.doing') || {}).textContent || '',
    })),
  })`
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true })
  return JSON.parse(r.result.value)
}

let failed = 0
// expect: Mailbox 名 → 状態の行の先頭 (例 'Needs you (request)')、または { state, doing } (doing は作業中の要旨の行)。title は タブのタイトルの先頭
async function scene(label, expect, title = 'agent-hub') {
  const s = await screen()
  const problems = []
  for (const [name, want] of Object.entries(expect)) {
    const { state, doing } = typeof want === 'string' ? { state: want } : want
    const card = s.cards.find((c) => c.name === name)
    if (!card) problems.push(`${name}: カードがない`)
    else if (!card.state.startsWith(state)) problems.push(`${name}: 「${card.state}」 (期待は「${state}」)`)
    else if (doing !== undefined && card.doing !== doing) problems.push(`${name}: 要旨「${card.doing}」 (期待は「${doing}」)`)
  }
  if (!s.title.startsWith(title)) problems.push(`タブのタイトル「${s.title}」 (期待は「${title}」で始まる)`)
  if (problems.length) failed++
  console.log(`${problems.length ? 'NG' : 'ok'}  ${label}`)
  for (const p of problems) console.log(`      ${p}`)
}

// 本文が text の Message で、節ごとの行の数 (sec-decide など) と見出しの数を照らす。中身が「なし」の節は目立たせない
async function sections(label, text, expect) {
  const expr = `(() => {
    const box = [...document.querySelectorAll('.msg')].find((b) => (b.querySelector('.body') || {}).innerText === ${JSON.stringify(text)})
    if (!box) return null
    const n = (sel) => box.querySelectorAll(sel).length
    return { decide: n('.sec-decide'), op: n('.sec-op'), unverified: n('.sec-unverified'), hd: n('.hd') }
  })()`
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true })
  const got = r.result.value
  const ok = got && Object.entries(expect).every(([k, v]) => got[k] === v)
  if (!ok) failed++
  console.log(`${ok ? 'ok' : 'NG'}  ${label}`)
  if (!ok) console.log(`      ${got ? JSON.stringify(got) : '本文が見つからない (改行や見出しの行の扱いが変わった?)'} (期待は ${JSON.stringify(expect)})`)
}

try {
  await until(async () => (await fetch(`${HUB}/mailboxes`, { headers: { authorization: `Bearer ${TOKEN}` } })).ok, 'hub')
  const cwd = join(work, 'demo')
  const lead = await api('POST', '/mailboxes/demo.leader/attach', { client: 'claude-code', role: 'leader', cwd, sessionId: 's-lead' })
  const dep = await api('POST', '/mailboxes/demo.deployer/attach', { client: 'claude-code', role: 'deployer', cwd, sessionId: 's-dep' })
  // 5 日前の依頼を渡してあるが、返信がない (C44)。ほかの場面の状態に響かないよう、別の Mailbox に置く
  const old = await api('POST', '/mailboxes/demo.old/attach', { client: 'claude-code', cwd, sessionId: 's-old' })
  await api('POST', `/attachments/${old.attachmentId}/ack`, { upTo: 1 })
  const asLead = { 'x-hub-attachment': lead.attachmentId }
  const asDep = { 'x-hub-attachment': dep.attachmentId }
  const hook = (mailbox, body) => api('POST', '/events/claude-code', { cwd, ...body }, { 'x-hub-mailbox': mailbox })
  const turnEnd = (mailbox, session) => hook(mailbox, { hook_event_name: 'Stop', session_id: session })
  // Channels の shim の代わりに、今ある Message まで渡したことにする
  const ackAll = async (at) => {
    const last = (await api('GET', '/messages?after=0&limit=1000')).messages.at(-1)
    await api('POST', `/attachments/${at}/ack`, { upTo: last.seq })
  }
  await turnEnd('demo.leader', 's-lead')
  await turnEnd('demo.deployer', 's-dep')

  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${join(work, 'chrome')}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
  const page = await until(async () => (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((t) => t.type === 'page'), 'chrome')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.method === 'Fetch.requestPaused') paused.push(m.params.requestId)
    const p = m.id && pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result)
  })
  await cdp('Page.navigate', { url: `${HUB}/?token=${TOKEN}` })
  await sleep(1000)
  await scene('2 人とも手が空いている', { 'demo.leader': 'Idle', 'demo.deployer': 'Idle' })

  await api('POST', '/messages', { kind: 'request', to: { type: 'user', id: 'browser' }, body: 'A か B か' }, asLead)
  await turnEnd('demo.leader', 's-lead')
  await scene('leader が Hub で人に尋ねてターンを終えた (C40)', { 'demo.leader': 'Needs you (request)', 'demo.deployer': 'Idle' }, '1 waiting')

  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'demo.leader' }, body: 'A で進めて' })
  await scene('人が返信ではなく新しい依頼で答えた (C28 で質問が閉じる)', { 'demo.leader': 'Working' })

  await ackAll(lead.attachmentId)
  const job = await api('POST', '/messages', { kind: 'request', to: { type: 'role', id: 'deployer' }, body: 'GOAL: C1 を実装する' }, asLead)
  await turnEnd('demo.leader', 's-lead')
  await scene('leader が deployer に渡してターンを終えた', { 'demo.leader': 'Waiting on others (deployer)', 'demo.deployer': 'Working' })

  await ackAll(dep.attachmentId)
  await api('POST', '/messages', { kind: 'reply', replyTo: job.id, body: 'CHANGED: …' }, asDep)
  await turnEnd('demo.deployer', 's-dep')
  const order = (await api('GET', '/messages?after=0&limit=1000')).messages.findLast((m) => m.kind === 'request' && m.to.id === 'demo.leader')
  await ackAll(lead.attachmentId)
  const report = ['結果: C1 ができた', '確認: 試験が通る', '未確認: 画面で開くこと', '要判断: (1) 設計の解釈 A でよいか', '  既定: A', '要操作: なし'].join('\n')
  await api('POST', '/messages', { kind: 'reply', replyTo: order.id, body: report }, asLead)
  // 英語の見出しの型 (C64)。見出しは英語で固定し、本文は人の言語のまま
  const reportEn = ['RESULT: C1 ができた', 'VERIFIED: 試験が通る', 'NOT VERIFIED: 画面で開くこと', 'NEEDS DECISION: (1) 設計の解釈 A でよいか', '  既定: A', 'NEEDS ACTION: なし', 'SKIPPED: なし'].join('\n')
  await api('POST', '/messages', { kind: 'reply', replyTo: order.id, body: reportEn }, asLead)
  const reportEnAction = ['RESULT: C2 ができた', 'NEEDS ACTION: push の指示'].join('\n')
  await api('POST', '/messages', { kind: 'reply', replyTo: order.id, body: reportEnAction }, asLead)
  await turnEnd('demo.leader', 's-lead')
  await scene('報告が戻り、leader が人に返した', { 'demo.leader': 'Idle', 'demo.deployer': 'Idle' })
  await sections('leader の返事の見出しを節ごとに色分けする (C42)', report, { decide: 2, op: 0, unverified: 1, hd: 5 })
  await sections('英語の見出しの返事も日本語と同じに色分けする (C64)', reportEn, { decide: 2, op: 0, unverified: 1, hd: 6 })
  await sections('英語の NEEDS ACTION に中身があれば見出しの色を付ける (C64)', reportEnAction, { decide: 0, op: 1, unverified: 0, hd: 2 })

  // 未接続の reviewer に依頼して待つ (C49)。Mailbox はあるがセッションが起動していない
  const rev = await api('POST', '/mailboxes/demo.reviewer/attach', { client: 'claude-code', role: 'reviewer', cwd, sessionId: 's-rev' })
  await api('DELETE', `/attachments/${rev.attachmentId}`)
  const review = await api('POST', '/messages', { kind: 'request', to: { type: 'role', id: 'reviewer' }, body: 'TARGET: C1' }, asLead)
  if (JSON.stringify(review.unattached) !== JSON.stringify(['demo.reviewer'])) {
    failed++
    console.log(`NG  送信の応答が未接続の配信先を示す (C49): ${JSON.stringify({ recipients: review.recipients, unattached: review.unattached })}`)
  }
  await turnEnd('demo.leader', 's-lead')
  await scene('leader が未接続の reviewer に送った依頼を待っている (C49)', { 'demo.leader': 'Needs you (demo.reviewer not connected)' }, '1 waiting')
  const rev2 = await api('POST', '/mailboxes/demo.reviewer/attach', { client: 'claude-code', role: 'reviewer', cwd, sessionId: 's-rev-2' })
  await scene('reviewer が attach した (Waiting on others に戻る)', { 'demo.leader': 'Waiting on others (reviewer)', 'demo.reviewer': 'Working' })
  await ackAll(rev2.attachmentId)
  await api('POST', '/messages', { kind: 'reply', replyTo: review.id, body: 'FINDINGS: なし' }, { 'x-hub-attachment': rev2.attachmentId })
  await turnEnd('demo.reviewer', 's-rev-2')
  await ackAll(lead.attachmentId)
  await turnEnd('demo.leader', 's-lead')
  await scene('reviewer が返した', { 'demo.leader': 'Idle', 'demo.reviewer': 'Idle' })

  // ほかのプロジェクトの leader が、未接続の reviewer だけを待つ (C49)。All projects ではタブに数え、demo を選ぶとほかのプロジェクトの件数にも出る
  const othCwd = join(work, 'other')
  const othLead = await api('POST', '/mailboxes/oth.leader/attach', { client: 'claude-code', role: 'leader', cwd: othCwd, sessionId: 's-oth' })
  const othRev = await api('POST', '/mailboxes/oth.reviewer/attach', { client: 'claude-code', role: 'reviewer', cwd: othCwd, sessionId: 's-oth-rev' })
  await api('DELETE', `/attachments/${othRev.attachmentId}`)
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'oth.reviewer' }, body: 'TARGET: C2' }, { 'x-hub-attachment': othLead.attachmentId })
  await api('POST', '/events/claude-code', { cwd: othCwd, hook_event_name: 'Stop', session_id: 's-oth' }, { 'x-hub-mailbox': 'oth.leader' })
  await scene('ほかのプロジェクトの leader が未接続の reviewer を待っている (C49)', { 'oth.leader': 'Needs you (oth.reviewer not connected)' }, '1 waiting')
  // demo を選ぶと、ほかのプロジェクトの件数 (#elsewhere) に出る。タブの件数は All projects と同じ 1
  await cdp('Runtime.evaluate', { expression: "chooseProject([...projects.values()].find((p) => p.label === 'demo').key)", returnByValue: true })
  await sleep(1500)
  const filtered = JSON.parse((await cdp('Runtime.evaluate', { expression: "JSON.stringify({ hidden: $('elsewhere').hidden, text: $('elsewhere').textContent, title: document.title })", returnByValue: true })).result.value)
  const elsewhereOk = !filtered.hidden && filtered.text === '1 waiting in other projects' && filtered.title.startsWith('1 waiting')
  if (!elsewhereOk) failed++
  console.log(`${elsewhereOk ? 'ok' : 'NG'}  demo を選ぶと、ほかのプロジェクトの件数に未接続の 1 件が出る (C49)`)
  if (!elsewhereOk) console.log(`      ${JSON.stringify(filtered)} (期待は hidden: false、text: '1 waiting in other projects'、title: '1 waiting' で始まる)`)
  await cdp('Runtime.evaluate', { expression: "chooseProject('')", returnByValue: true })
  await api('DELETE', `/attachments/${othLead.attachmentId}`)

  // UI が最初に読むのは最近の Event 200 件だけ。ほかの Mailbox の Event で押し出しても、Hub の lastTurnEnd で Idle のまま (C41)
  for (let i = 0; i < 250; i++) await turnEnd('demo.noise', 's-noise')
  await cdp('Page.navigate', { url: `${HUB}/` })
  await sleep(1000)
  await scene('ターン終了を Event の窓から押し出して読み直した', { 'demo.leader': 'Idle', 'demo.deployer': 'Idle' })

  await hook('demo.leader', { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'tu-1', session_id: 's-lead' })
  await scene('leader がターミナルで質問した', { 'demo.leader': 'Needs you (question)' }, '1 waiting')
  await api('POST', '/mailboxes/demo.leader/attach', { client: 'claude-code', role: 'leader', cwd, sessionId: 's-lead-2' })
  await scene('別のセッションが attach した (前のセッションの質問は数えない。C41)', { 'demo.leader': 'Idle' })
  // /clear で hook の session_id が変わっても、今の接続の後に出た質問は数える
  await hook('demo.leader', { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'tu-2', session_id: 's-lead-3' })
  await scene('今の接続の後に、session_id の違う質問が出た (/clear の後を想定)', { 'demo.leader': 'Needs you (question)' }, '1 waiting')

  // usage limit (C38): StopFailure は turn.failed になり、渡された Message があっても Working でなく Paused と出る
  const failure = (mailbox, session) => hook(mailbox, { hook_event_name: 'StopFailure', session_id: session, error: 'rate_limit', last_assistant_message: "You've hit your limit" })
  const quota = (mailbox, session, type) => hook(mailbox, { hook_event_name: 'Notification', session_id: session, notification_type: type, message: type })
  await api('POST', '/messages', { kind: 'request', to: { type: 'role', id: 'deployer' }, body: 'GOAL: C2 を実装する' })
  await scene('deployer に依頼が渡った (未読があり、作業中)', { 'demo.deployer': 'Working' }, '1 waiting')
  await failure('demo.deployer', 's-dep')
  await scene('usage limit で止まった (Working より先に Paused)', { 'demo.deployer': 'Paused (usage limit)' }, '1 waiting')
  await quota('demo.deployer', 's-dep', 'quota_auto_resume_fired')
  await scene('自動の再開が動いた (Paused が解けて Working に戻る)', { 'demo.deployer': 'Working' }, '1 waiting')
  await failure('demo.deployer', 's-dep')
  await quota('demo.deployer', 's-dep', 'quota_auto_resume_stale')
  await scene('自動の再開が続かない (Needs you)', { 'demo.deployer': 'Needs you (usage limit, press Enter)' }, '2 waiting')
  await quota('demo.deployer', 's-dep', 'quota_auto_resume_disabled')
  await scene('自動の再開が無効 (Needs you)', { 'demo.deployer': 'Needs you (usage limit, auto-resume off)' }, '2 waiting')
  // 止まった Event が最近の窓から押し出されても、Hub の lastEvent.detail で Paused のまま
  await failure('demo.deployer', 's-dep')
  for (let i = 0; i < 250; i++) await turnEnd('demo.noise', 's-noise')
  await cdp('Page.navigate', { url: `${HUB}/` })
  await sleep(1000)
  await scene('止まった Event を窓から押し出して読み直した', { 'demo.deployer': 'Paused (usage limit)' }, '1 waiting')
  await turnEnd('demo.deployer', 's-dep')
  await ackAll(dep.attachmentId)
  await scene('ターンが終わった (Paused が解け、返信のない依頼があるので Stopped)', { 'demo.deployer': 'Stopped, no reply' }, '1 waiting')

  // 許可待ちの解除 (C30): 許可待ちの後に最初にツールが動いたら permission.resolved。拒否したときは何も届かない
  const permission = (mailbox, session) => hook(mailbox, { hook_event_name: 'Notification', session_id: session, notification_type: 'permission_prompt', message: 'Claude needs your permission' })
  const toolDone = (mailbox, session, id) => hook(mailbox, { hook_event_name: 'PostToolUse', session_id: session, tool_name: 'Bash', tool_use_id: id, tool_input: { command: 'npm test' }, tool_response: { stdout: 'ok' } })
  await api('POST', '/messages', { kind: 'request', to: { type: 'role', id: 'deployer' }, body: 'GOAL: C3 を実装する' })
  await ackAll(dep.attachmentId)
  await scene('deployer に次の依頼が渡った', { 'demo.deployer': 'Working' }, '1 waiting')
  await permission('demo.deployer', 's-dep')
  await scene('deployer が許可を求めた', { 'demo.deployer': 'Needs you (permission)' }, '2 waiting')
  await toolDone('demo.deployer', 's-dep', 'tu-b1')
  await scene('許可してツールが動いた (Needs you が解けて Working)', { 'demo.deployer': 'Working' }, '1 waiting')
  await toolDone('demo.deployer', 's-dep', 'tu-b2')
  await permission('demo.deployer', 's-dep')
  await scene('もう一度許可を求め、拒否した (何も届かず Needs you のまま)', { 'demo.deployer': 'Needs you (permission)' }, '2 waiting')

  // バックグラウンドの処理を待って終えたターン (C43)。Stop の background_tasks に走っている処理があれば、Stopped でなく Working
  const bgEnd = (tasks) => hook('demo.deployer', { hook_event_name: 'Stop', session_id: 's-dep', background_tasks: tasks })
  await toolDone('demo.deployer', 's-dep', 'tu-b3')
  await bgEnd([
    { id: 'bg1', type: 'shell', status: 'running', description: 'npm test', command: 'npm test' },
    { id: 'bg2', type: 'shell', status: 'completed', description: 'build', command: 'npm run build' },
  ])
  await scene('試験をバックグラウンドで流してターンを終えた (Stopped でなく Working。C43)', { 'demo.deployer': { state: 'Working', doing: 'background: npm test' } }, '1 waiting')
  for (let i = 0; i < 250; i++) await turnEnd('demo.noise', 's-noise')
  await cdp('Page.navigate', { url: `${HUB}/` })
  await sleep(1000)
  await scene('そのターン終了を窓から押し出して読み直した (Hub の lastTurnEnd.running で Working のまま)', { 'demo.deployer': { state: 'Working', doing: 'background: npm test' } }, '1 waiting')
  // 上限 (BACKGROUND_MAX_MINUTES) を過ぎた分は、UI の時計を進めて確かめる
  const later = await cdp('Runtime.evaluate', { expression: `(() => { const real = Date.now; Date.now = () => real() + 61 * 60000; const st = stateOf(mailboxList.find((m) => m.name === 'demo.deployer')); Date.now = real; return st && st.key })()`, returnByValue: true })
  const laterOk = later.result.value === 'stopped'
  if (!laterOk) failed++
  console.log(`${laterOk ? 'ok' : 'NG'}  走っている処理のあるターン終了から 61 分たつと Stopped に戻る (C43)`)
  if (!laterOk) console.log(`      ${JSON.stringify(later.result.value)} (期待は 'stopped')`)
  await bgEnd([])
  await scene('処理が終わったターンで返さなかった (Stopped)', { 'demo.deployer': 'Stopped, no reply' }, '1 waiting')

  // 溜まりのバッジから最も古いものへ飛ぶ (C44)。古い依頼は止まった Event と違って、畳んだ分の中にあることもある
  // タブは leader の質問の 1 件 (deployer の許可待ちは上の C43 の場面で解いた)
  await scene('5 日前の返信待ちの依頼が残っている', { 'demo.old': 'Stopped, no reply' }, '1 waiting')
  const jump = await cdp('Runtime.evaluate', {
    expression: `(async () => {
      const card = [...document.querySelectorAll('#mailboxes .mb')].find((b) => (b.querySelector('.name') || {}).textContent === 'demo.old')
      const chip = card && card.querySelector('.bl.jump[data-layer="agent"]')
      if (!chip) return null
      const text = chip.textContent
      chip.click()
      await new Promise((r) => setTimeout(r, 400))
      const box = document.querySelector('#list .msg[data-seq="1"]')
      if (!box) return { text, found: false }
      const list = document.getElementById('list').getBoundingClientRect()
      const r = box.getBoundingClientRect()
      return { text, found: true, hit: box.classList.contains('hit'), shown: r.top >= list.top && r.bottom <= list.bottom, body: box.textContent.includes(${JSON.stringify(OLD_BODY)}) }
    })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  const jv = jump.result.value
  const jumpOk = jv && jv.found && jv.hit && jv.shown && jv.body && jv.text.includes('Agent 1 · 5d')
  if (!jumpOk) failed++
  console.log(`${jumpOk ? 'ok' : 'NG'}  5 日前の返信待ちの Agent バッジを押すと、その依頼が見えて強調される (C44)`)
  if (!jumpOk) console.log(`      ${JSON.stringify(jv)} (期待は Agent 1 · 5d と、表示され強調された依頼)`)

  // 溜まりのバッジの飛び先 (C48)。demo の絞り込みで、隠れた場面・畳んだ範囲の中の場面・You と Stuck? の場面を確かめる
  const verify = (label, ok, detail) => {
    if (!ok) failed++
    console.log(`${ok ? 'ok' : 'NG'}  ${label}`)
    if (!ok) console.log(`      ${JSON.stringify(detail)}`)
  }
  const evaluate = async (expression) => (await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value
  const seqOf = async (body) => (await api('GET', '/messages?after=0&limit=1000')).messages.findLast((m) => m.body === body).seq
  // 畳んだ (Compact の印の付いた) 項目。ページ側の式を文字列で持つ
  const COMPACTED = "[...msgBoxes.values(), ...evtBoxes.values()].filter((b) => b.dataset.compacted === '1')"
  // バッジ (カードの名前と層) を実際に押し、強調された行と表示範囲を読む
  const jumpFrom = (card, layer) => evaluate(`(async () => {
    const box = [...document.querySelectorAll('#mailboxes .mb')].find((b) => (b.querySelector('.name') || {}).textContent === ${JSON.stringify(card)})
    const chip = box && box.querySelector('.bl.jump[data-layer="${layer}"]')
    if (!chip) return null
    const text = chip.textContent
    document.querySelectorAll('.hit').forEach((e) => e.classList.remove('hit')) // 前の飛び先の強調を消してから押す
    chip.click()
    await new Promise((r) => setTimeout(r, 400))
    const hit = document.querySelector('#list .hit')
    const stub = ${COMPACTED}.length > 0
    if (!hit) return { text, hit: null, stub }
    const list = document.getElementById('list').getBoundingClientRect()
    const r = hit.getBoundingClientRect()
    return { text, hit: hit.classList.contains('evt') ? 'evt' : 'msg', seq: hit.dataset.seq ?? null, shown: r.top >= list.top && r.bottom <= list.bottom, stub }
  })()`)
  // 隠れた Message の seq で jumpTo を呼ぶ。バッジと同じ形の t を渡す (隠れた Message を指すバッジは通常の数え方では出ない)
  const hiddenJump = (seq) => evaluate(`(() => {
    const list = $('list')
    const before = { top: list.scrollTop, folded: ${COMPACTED}.length, boxes: list.querySelectorAll('.msg, .evt').length }
    jumpTo({ count: 1, oldestAt: null, oldestSeq: ${seq}, eventId: null })
    const m = [...seen.values()].find((x) => x.seq === ${seq})
    const target = m && msgBoxes.get(m.id)
    return {
      status: $('status').textContent,
      moved: list.scrollTop !== before.top || ${COMPACTED}.length !== before.folded || list.querySelectorAll('.msg, .evt').length !== before.boxes,
      hit: !!(target && target.classList.contains('hit')),
      stillFolded: document.querySelector('#list [data-seq="${seq}"]').dataset.compacted === '1',
    }
  })()`)
  const demoKey = await evaluate("[...projects.values()].find((p) => p.label === 'demo').key")
  await evaluate(`chooseProject(${JSON.stringify(demoKey)})`)

  // 1. 隠れた依頼 (畳みの外): ステータスに隠れていると出し、スレッドは動かず、強調もしない
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'oth.reviewer' }, body: 'HIDDEN-NEW: 絞り込みで隠れた依頼 (畳みの外)' })
  await sleep(1500)
  const hiddenNew = await hiddenJump(await seqOf('HIDDEN-NEW: 絞り込みで隠れた依頼 (畳みの外)'))
  verify('隠れた依頼 (畳みの外) を指すと、隠れていると出し、スレッドは動かない (C48)', hiddenNew.status.includes('hidden by the project filter') && hiddenNew.status.includes('All projects') && !hiddenNew.moved && !hiddenNew.hit, hiddenNew)

  // 2. 隠れた依頼が畳みの中にある: keep を 1 にして畳み直すと、TARGET: C2 (ほかのプロジェクトの依頼) は畳みの中に入る
  const hiddenOld = await seqOf('TARGET: C2')
  await evaluate("$('keep').value = 1; $('fold').click()")
  await sleep(300)
  const inFold = await evaluate(`document.querySelector('#list [data-seq="${hiddenOld}"]').dataset.compacted === '1'`)
  verify('(準備) 隠れた依頼 TARGET: C2 が畳みの中にある', inFold, { hiddenOld })
  const hiddenFolded = await hiddenJump(hiddenOld)
  verify('隠れた依頼が畳みの中にあっても、畳みは開かず、ステータスに隠れていると出す (C48)', hiddenFolded.status.includes('hidden by the project filter') && hiddenFolded.status.includes('All projects') && !hiddenFolded.moved && hiddenFolded.stillFolded, hiddenFolded)

  // 3. 畳みの中の (隠れていない) 依頼: 畳みが開き、表示範囲に入って強調される
  const shownFolded = await evaluate(`document.querySelector('#list [data-seq="1"]').dataset.compacted === '1'`)
  verify('(準備) 隠れていない最も古い依頼 (#1) が畳みの中にある', shownFolded, {})
  const expanded = await jumpFrom('demo.old', 'agent')
  verify('畳みの中の (隠れていない) 依頼を指すと、畳みが開き、表示範囲に入って強調される (C48)', expanded && expanded.seq === '1' && expanded.hit === 'msg' && expanded.shown && !expanded.stub, expanded)

  // 4. You: hook の質問と人宛ての request の両方がある。古い方へ飛ぶ (request が古い場合)
  await api('POST', '/messages', { kind: 'request', to: { type: 'user', id: 'browser' }, body: 'YOU-REQ-OLD: 人宛ての依頼 (質問より古い)' }, { 'x-hub-attachment': rev2.attachmentId })
  await hook('demo.reviewer', { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'tu-y1', session_id: 's-rev-2' })
  await sleep(1500)
  const youReq = await seqOf('YOU-REQ-OLD: 人宛ての依頼 (質問より古い)')
  const youOld = await jumpFrom('demo.reviewer', 'you')
  verify('You: 質問より人宛ての request が古いとき、request へ飛んで強調される (C48)', youOld && youOld.seq === String(youReq) && youOld.shown, { youReq, youOld })

  // 5. You: 質問の Event が人宛ての request より古い場合は、Event へ飛ぶ
  const quiet = await api('POST', '/mailboxes/demo.quiet/attach', { client: 'claude-code', cwd, sessionId: 's-quiet' })
  await hook('demo.quiet', { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'tu-y2', session_id: 's-quiet' })
  await api('POST', '/messages', { kind: 'request', to: { type: 'user', id: 'browser' }, body: 'YOU-REQ-NEW: 人宛ての依頼 (質問より新しい)' }, { 'x-hub-attachment': quiet.attachmentId })
  await sleep(1500)
  const youEvt = await jumpFrom('demo.quiet', 'you')
  verify('You: 質問の Event が人宛ての request より古いとき、Event へ飛んで強調される (C48)', youEvt && youEvt.hit === 'evt' && youEvt.shown, youEvt)

  // 6. Stuck?: 未接続の Mailbox に届いた未読を押すと、その Message へ飛んで強調される
  const ghost = await api('POST', '/mailboxes/demo.ghost/attach', { client: 'claude-code', cwd, sessionId: 's-ghost' })
  await api('DELETE', `/attachments/${ghost.attachmentId}`)
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'demo.ghost' }, body: 'STUCK-UNREAD: 未接続の Mailbox の未読' })
  await sleep(1500)
  const stuckSeq = await seqOf('STUCK-UNREAD: 未接続の Mailbox の未読')
  const stuck = await jumpFrom('demo.ghost', 'stuck')
  verify('Stuck?: 未接続の Mailbox の未読を押すと、その Message へ飛んで強調される (C48)', stuck && stuck.seq === String(stuckSeq) && stuck.shown, { stuckSeq, stuck })
  await evaluate("chooseProject('')")

  // Items の 4 段 (C52): 予定 (plan の並び)、判断待ち (提案)、寝かせている (保留、既定で畳む)、最近閉じた (日付の新しい 5 件)
  const itemOf = (id, title, status, extra = {}) => ({ id, title, status, conditionTexts: [], promise: null, line: 1, conditions: null, ...extra })
  const sendIndex = (project, source, body) => api('PUT', '/indexes', { project, source, ...body })
  // 段ごとの組 (見出し・畳みの開き・項目の番号・閉じた行) を DOM から読む
  const readTiers = () => evaluate(`(() => {
    const groups = []
    const tags = {}
    let cur = null
    const take = (node) => {
      const id = node.querySelector('.id').textContent
      tags[id] = (node.querySelector('.tag') || {}).textContent || ''
      cur.ids.push(id)
    }
    for (const node of document.getElementById('items').children) {
      if (node.classList.contains('itemhead')) { cur = null; continue }
      if (node.classList.contains('tier')) { cur = { head: node.textContent, open: null, ids: [], rows: [] }; groups.push(cur); continue }
      if (node.tagName === 'DETAILS') {
        cur = { head: node.querySelector('summary').textContent, open: node.open, ids: [], rows: [] }
        groups.push(cur)
        node.querySelectorAll('.item').forEach(take)
        continue
      }
      if (!cur) continue
      if (node.classList.contains('item')) take(node)
      if (node.classList.contains('closedrow')) cur.rows.push(node.textContent)
    }
    return { groups, tags }
  })()`)
  await sendIndex(cwd, 'docs/roadmap.md', {
    items: [
      itemOf('C1', '一つ目', 'decided', { conditions: { done: 1, total: 2 }, line: 3 }),
      itemOf('C2', '二つ目 (C1 を待つ)', 'blocked', { statusReason: 'C1 の後' }),
      itemOf('C3', '三つ目 (人が決める)', 'proposed'),
      itemOf('C4', '四つ目 (保留)', 'held', { statusReason: '再開の条件', conditions: { done: 1, total: 2 } }),
      itemOf('C5', '五つ目 (予定の先頭)', 'decided', { conditions: { done: 0, total: 1 } }),
    ],
    plan: [{ id: 'C5', line: 20 }, { id: 'C1', line: 21 }, { id: 'C2', line: 22 }],
    closed: [
      { id: 'C20', mark: 'x', date: '2026-10-01', line: 10 },
      { id: 'C21', mark: 'x', date: '2026-10-02', line: 11 },
      { id: 'C22', mark: 'x', date: '2026-10-03', line: 12 },
      { id: 'C23', mark: 'x', date: '2026-10-04', line: 13 },
      { id: 'C24', mark: '-', date: '2026-10-05', line: 14 },
      { id: 'C25', mark: 'x', date: '2026-10-06', line: 15 },
      { id: 'C26', mark: 'x', date: '2026-10-06', line: 16 },
    ],
  })
  await sleep(1500)
  const tiers = await readTiers()
  const tiersOk = JSON.stringify(tiers.groups) === JSON.stringify([
    { head: 'Plan (3)', open: null, ids: ['C5', 'C1', 'C2'], rows: [] },
    { head: 'Awaiting a decision (1)', open: null, ids: ['C3'], rows: [] },
    { head: 'Parked (1)', open: false, ids: ['C4'], rows: [] },
    { head: 'Recently closed', open: null, ids: [], rows: ['C25 done 2026-10-06', 'C26 done 2026-10-06', 'C24 rejected 2026-10-05', 'C23 done 2026-10-04', 'C22 done 2026-10-03'] },
  ])
  verify('Items: 予定は plan の並び、判断待ちと寝かせている (畳む) と、最近閉じた 5 件 (同じ日は行の順) に分かれる (C52)', tiersOk, tiers.groups)
  verify('Items: ブロックは待つ項目を示す (waits C1)', tiers.tags.C2 === 'waits C1', tiers.tags)

  // 予定のない古い形の索引 (plan も closed も送らない): 決定とブロックを番号順に 1 段目に出す
  await api('DELETE', `/indexes?project=${encodeURIComponent(cwd)}&source=${encodeURIComponent('docs/roadmap.md')}`)
  await api('PUT', '/indexes', {
    project: join(work, 'old'),
    source: 'docs/old.md',
    items: [itemOf('C9', '九', 'proposed'), itemOf('C8', '八 (C7 を待つ)', 'blocked', { statusReason: 'C7 の後', conditions: { done: 0, total: 1 } }), itemOf('C7', '七', 'decided', { conditions: { done: 0, total: 1 } }), itemOf('C6', '六', 'decided', { conditions: { done: 0, total: 1 } })],
  })
  await sleep(1500)
  const oldTiers = await readTiers()
  const oldOk = JSON.stringify(oldTiers.groups) === JSON.stringify([
    { head: 'Plan (3) · no ## Plan (## 予定) in this file', open: null, ids: ['C6', 'C7', 'C8'], rows: [] },
    { head: 'Awaiting a decision (1)', open: null, ids: ['C9'], rows: [] },
  ])
  verify('Items: 予定のない索引は、決定とブロックを番号順に 1 段目に出す (C52)', oldOk && oldTiers.tags.C8 === 'waits C7', oldTiers)

  // カードの中身はモーダルで見る (C54)。本文は出さず、完了条件の 1 行ずつのチェック・依頼の状態・約束の差分・下書きとエディタのリンク
  await sendIndex(cwd, 'docs/roadmap.md', {
    items: [
      itemOf('C1', '一つ目', 'decided', { conditions: { done: 1, total: 2 }, conditionTexts: ['一つ目', '二つ目'], conditionChecks: [true, false], promise: 'aaaaaaaa', line: 3 }),
      itemOf('C2', '二つ目の項目', 'held', { statusReason: '再開の条件' }),
    ],
    plan: [{ id: 'C1', line: 20 }],
  })
  // 依頼のあとで完了条件の文言が変わった状態を作る (送った指紋と文言が今と違う)
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'demo.deployer' }, body: 'GOAL: C1 一つ目', meta: { item: { id: 'C1', project: cwd, source: 'docs/roadmap.md', promise: 'deadbeef', conditions: ['古い文言'] } } })
  const reqSeq = await seqOf('GOAL: C1 一つ目')
  // あとから来た、人が書いたのではない同じ項目の request (エージェントの request と、その無編集の転送)。項目のカードの「最新の request」にならない (C77)
  const itemAgent = await api('POST', '/mailboxes/demo.itemagent/attach', { client: 'claude-code', role: 'leader', cwd, sessionId: 's-item-agent' })
  const agentReq = await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'demo.deployer' }, body: 'GOAL: C1 from an agent', meta: { item: { id: 'C1', project: cwd, source: null, promise: null } } }, { 'x-hub-attachment': itemAgent.attachmentId })
  await api('POST', `/messages/${agentReq.id}/forward`, { to: { type: 'mailbox', id: 'demo.deployer' } })
  await sleep(1500)
  const clickCard = (id) => evaluate(`(() => {
    const c = [...document.querySelectorAll('#items .item')].find((x) => x.querySelector('.id').textContent === ${JSON.stringify(id)})
    if (!c) return false
    c.click()
    return true
  })()`)
  const modalState = () => evaluate(`(() => ({
    open: $('itemDialog').open,
    title: $('itemTitle').textContent,
    conds: [...$('itemConds').querySelectorAll('.cond')].map((x) => x.textContent),
    req: $('itemReq').textContent,
    diff: $('itemDiff').hidden ? null : $('itemDiff').textContent,
    href: $('itemEditor').getAttribute('href'),
  }))()`)
  // エディタのリンクの期待値 (パスは / に揃え、段ごとに符号化。駆動器の C: はそのまま)
  const editorHref = (dir, source, line) => {
    const segs = `${dir}/${source}`.replace(/\\/g, '/').replace(/\/+/g, '/').split('/').filter(Boolean)
    return 'vscode://file/' + segs.map((x, i) => (i === 0 && /^[A-Za-z]:$/.test(x) ? x : encodeURIComponent(x))).join('/') + ':' + line
  }
  await clickCard('C1')
  await sleep(300)
  const m1 = await modalState()
  verify('モーダル: 題・完了条件の 1 行ずつの [x] / [ ]・依頼の状態・約束の差分を出す (C54)', m1.open && m1.title === 'C1. 一つ目' && JSON.stringify(m1.conds) === JSON.stringify(['[x] 一つ目', '[ ] 二つ目']) && m1.req.startsWith(`Requested: request #${reqSeq}`) && m1.diff !== null && m1.diff.includes(`Done-when changed since #${reqSeq}`) && m1.diff.includes('- 古い文言') && m1.diff.includes('+ 一つ目'), m1)
  verify('Item cards count only requests the human wrote: an agent request and its unedited forward do not replace the latest request (C77)', m1.req.startsWith(`Requested: request #${reqSeq}`) && m1.diff !== null && m1.diff.includes(`since #${reqSeq}`), { req: m1.req, diff: m1.diff })
  verify('モーダル: エディタで開くリンクは vscode://file/<project>/<source>:<line> (C54)', m1.href === editorHref(cwd, 'docs/roadmap.md', 3), { href: m1.href, want: editorHref(cwd, 'docs/roadmap.md', 3) })
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(300)
  verify('モーダル: Esc で閉じる (C54)', (await modalState()).open === false)
  await clickCard('C2')
  await sleep(300)
  await evaluate("$('itemClose').click()")
  verify('モーダル: 閉じるボタンで閉じる (C54)', (await modalState()).open === false)
  await clickCard('C1')
  await sleep(300)
  await evaluate("$('itemDraft').click()")
  await sleep(300)
  const draft = await evaluate("({ open: $('itemDialog').open, body: $('body').value })")
  verify('モーダル: 「依頼の下書き」はカードを押したときと同じ下書きを入れ、モーダルを閉じる (C54)', !draft.open && draft.body.startsWith('GOAL: C1 一つ目') && draft.body.includes('DONE WHEN:') && draft.body.includes('- 一つ目'), draft)
  await evaluate("$('body').value = ''")
  // チェックを送らない古い形の索引は、印を出さない
  await api('PUT', '/indexes', { project: join(work, 'old2'), source: 'docs/x.md', items: [itemOf('C30', '古い形', 'decided', { conditionTexts: ['古い形の一行'], conditions: { done: 0, total: 1 } })] })
  await sleep(1500)
  await clickCard('C30')
  await sleep(300)
  const oldM = await modalState()
  verify('モーダル: チェックを送らない古い形の索引は印を出さない (C54)', JSON.stringify(oldM.conds) === JSON.stringify(['古い形の一行']), oldM)
  await evaluate("$('itemClose').click()")

  // サイドバーの幅 (C54): つまみで変えられ、200〜520px に収まり、ブラウザに覚える。保存値が壊れていれば既定の 260px
  const sideW = () => evaluate("Math.round(document.querySelector('aside').getBoundingClientRect().width)")
  const grip = () => evaluate("(() => { const r = $('sideResize').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()")
  const dragBy = async (dx) => {
    const g = await grip()
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: g.x, y: g.y, button: 'left', buttons: 1, clickCount: 1 })
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g.x + dx, y: g.y, button: 'left', buttons: 1 })
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g.x + dx, y: g.y, button: 'left', buttons: 0, clickCount: 1 })
    await sleep(200)
  }
  const stored = () => evaluate("(() => { try { return localStorage.getItem('agent-hub.sidebar') } catch (e) { return 'ERR' } })()")
  const reload = async () => {
    await cdp('Page.navigate', { url: `${HUB}/?token=${TOKEN}` })
    await sleep(1000)
  }
  await evaluate("try { localStorage.removeItem('agent-hub.sidebar') } catch (e) {}")
  // 起動時のプロジェクト (C72): URL の #project= は保存値より優先され、保存される。知らない値は無視し、保存もしない。何もなければ保存値を戻す。読んだら URL から消す
  {
    const keys = JSON.parse(await evaluate('JSON.stringify([...projects.keys()])'))
    const [a, b] = keys
    const open = async (hash, stored) => {
      await evaluate(stored === null ? "localStorage.removeItem('agent-hub.project')" : `localStorage.setItem('agent-hub.project', ${JSON.stringify(stored)})`)
      await cdp('Page.navigate', { url: `${HUB}/?token=${TOKEN}${hash}` })
      await sleep(1500)
      return JSON.parse(await evaluate("JSON.stringify({ sel: $('project').value, filter: FILTER.project, stored: localStorage.getItem('agent-hub.project'), hash: location.hash, search: location.search })"))
    }
    const win = await open(`#project=${encodeURIComponent(b)}`, a)
    verify('起動時のプロジェクト: URL の project は保存値に勝ち、保存される。読んだら URL から消える (C72)', keys.length >= 2 && win.filter === b && win.sel === b && win.stored === b && win.hash === '' && win.search === '', { keys, win })
    const bad = '"><img src=x onerror=alert(1)>'
    const unknown = await open(`#project=${encodeURIComponent(bad)}`, a)
    const noXss = await evaluate("document.querySelectorAll('img[src=x]').length === 0")
    verify('起動時のプロジェクト: 一覧にない project は無視し、保存もせず、保存値に戻る。マークアップは描かれない (C72)', unknown.filter === a && unknown.stored === a && unknown.hash === '' && noXss, { unknown, noXss })
    const none = await open('', b)
    verify('起動時のプロジェクト: project がなければ保存値を戻す (C72)', none.filter === b && none.stored === b, { none })
    await evaluate("localStorage.removeItem('agent-hub.project')")
  }
  await reload()
  const w0 = await sideW()
  await dragBy(100)
  const w1 = await sideW()
  verify('サイドバーの幅: つまみで広げられ、幅を覚える (C54)', w0 === 260 && Math.abs(w1 - 360) <= 2 && (await stored()) === String(w1), { w0, w1, stored: await stored() })
  await dragBy(1000)
  const wMax = await sideW()
  verify('サイドバーの幅: 広げすぎは 520px で止まる (C54)', wMax === 520 && (await stored()) === '520', { wMax, stored: await stored() })
  await dragBy(-2000)
  const wMin = await sideW()
  verify('サイドバーの幅: 狭めすぎは 200px で止まる (C54)', wMin === 200 && (await stored()) === '200', { wMin, stored: await stored() })
  await reload()
  verify('サイドバーの幅: 読み直しても覚えた幅 (200px) で出る (C54)', (await sideW()) === 200)
  await evaluate("localStorage.setItem('agent-hub.sidebar', 'abc')")
  await reload()
  const wBad = await sideW()
  const listOk = await evaluate("document.querySelector('#list').getBoundingClientRect().width > 0")
  verify('サイドバーの幅: 保存値が数でなければ既定の 260px で、表示は崩れない (C54)', wBad === 260 && listOk, { wBad, listOk })
  await evaluate("localStorage.setItem('agent-hub.sidebar', '9999')")
  await reload()
  verify('サイドバーの幅: 保存値が範囲外なら既定の 260px (C54)', (await sideW()) === 260)
  await evaluate("try { localStorage.removeItem('agent-hub.sidebar') } catch (e) {}")

  // 絞り込み (C59): 隠すだけで消さず、待ち (質問・許可待ち・人宛ての request) はどの軸でも隠さない。Reset で全部外れ、保存は軸ごと
  await hook('demo.old', { hook_event_name: 'Notification', session_id: 's-old', notification_type: 'idle_prompt', message: 'idle' })
  await sleep(1500)
  const fcheck = (group, label, on) => evaluate(`(() => {
    const l = [...document.querySelectorAll('#${group} .fopt')].find((x) => x.textContent === ${JSON.stringify(label)})
    if (!l) return false
    const c = l.querySelector('input')
    c.checked = ${on}
    c.dispatchEvent(new Event('change'))
    return true
  })()`)
  const fnoise = (on) => evaluate(`(() => { $('fNoise').checked = ${on}; $('fNoise').dispatchEvent(new Event('change')); return true })()`)
  const offMsg = (prefix) => evaluate(`(() => {
    const b = [...document.querySelectorAll('#list .msg')].find((x) => ((x.querySelector('.body') || {}).textContent || '').startsWith(${JSON.stringify(prefix)}))
    return b ? b.classList.contains('off') : null
  })()`)
  const cardNames = () => evaluate("[...document.querySelectorAll('#mailboxes .mb .name')].map((n) => n.textContent)")
  const reset = () => evaluate("$('resetFilter').click()")
  await evaluate("$('filterBtn').click()") // Filter ▾ を開き、欄を作らせる
  await sleep(200)
  // a. 保存がなければ Noise は on: 通知の Event だけが隠れ、Noise のチップが出て、Reset は既定と同じなので出ない
  await evaluate("['agent-hub.filter.mailboxes', 'agent-hub.filter.kinds', 'agent-hub.filter.noise'].forEach((k) => localStorage.removeItem(k))")
  await reload()
  await evaluate("$('filterBtn').click()")
  await sleep(200)
  const dflt = await evaluate(`(() => {
    const off = [...document.querySelectorAll('#list .off')]
    return { noise: FILTER.noise, resetShown: !$('resetFilter').hidden, chips: [...document.querySelectorAll('#chips .fchip')].map((c) => c.textContent), evt: off.filter((b) => b.classList.contains('evt')).map((b) => b.querySelector('.kind').textContent), msg: off.filter((b) => b.classList.contains('msg')).length, waitingOff: off.filter((b) => b.classList.contains('waiting')).length }
  })()`)
  verify('保存がなければ Noise は on: 通知の Event だけが隠れ、Noise のチップが出て、Reset は出ない (C59)', dflt.noise === true && !dflt.resetShown && JSON.stringify(dflt.chips) === JSON.stringify(['Hide noise×']) && dflt.evt.length >= 1 && dflt.evt.every((k) => k === 'notification') && dflt.msg === 0 && dflt.waitingOff === 0, dflt)
  // 通知が Noise で隠れているときのバッジの飛び先は、Reset ではなくチップの × かポップオーバーで外すと言う (C59 追補)
  const notifId = await evaluate("(() => { const b = [...document.querySelectorAll('#list .evt.off')].find((x) => x.querySelector('.kind').textContent === 'notification'); return b ? b.dataset.id : null })()")
  const noiseHint = await evaluate(`(() => { jumpTo({ count: 1, oldestAt: null, oldestSeq: null, eventId: ${JSON.stringify(notifId)} }); return $('status').textContent })()`)
  verify('通知が Noise で隠れているバッジの飛び先は、チップの × かポップオーバーで外すと言い、Reset とは言わない (C59)', notifId !== null && noiseHint.includes('hidden by the Noise filter') && noiseHint.includes('Hide noise chip (×)') && noiseHint.includes('Filter ▾') && !noiseHint.includes('Reset'), { notifId, noiseHint })
  // b. Noise のチップの × で off になり、何も隠れず、Reset が出る。on に戻すと通知だけがまた隠れる
  const chipX = (text) => evaluate(`(() => {
    const c = [...document.querySelectorAll('#chips .fchip')].find((x) => x.textContent.startsWith(${JSON.stringify(text)}))
    if (!c) return false
    c.querySelector('button').click()
    return true
  })()`)
  await chipX('Hide noise')
  const noiseOff = await evaluate("({ off: document.querySelectorAll('#list .off').length, noise: FILTER.noise, resetShown: !$('resetFilter').hidden, stored: localStorage.getItem('agent-hub.filter.noise') })")
  verify('Noise のチップの × で通知も見え、Reset が出る (保存は off) (C59)', noiseOff.off === 0 && noiseOff.noise === false && noiseOff.resetShown && noiseOff.stored === '0', noiseOff)
  await fnoise(true)
  const noise = await evaluate(`(() => {
    const off = [...document.querySelectorAll('#list .off')]
    return { evt: off.filter((b) => b.classList.contains('evt')).map((b) => b.querySelector('.kind').textContent), msg: off.filter((b) => b.classList.contains('msg')).length, waitingOff: off.filter((b) => b.classList.contains('waiting')).length }
  })()`)
  verify('Noise: 通知の Event だけを隠し、質問・許可待ちと Message は隠さない (C59)', noise.evt.length >= 1 && noise.evt.every((k) => k === 'notification') && noise.msg === 0 && noise.waitingOff === 0, noise)
  // c. Mailbox: 選んだ Mailbox と、待ちのあるカードだけ残る。未選択の Mailbox の Message は隠れるが、人宛ての request と質問は隠れない
  await fcheck('fMailbox', 'demo.leader', true)
  const onlyLeader = await cardNames()
  const cardsOk = onlyLeader.includes('demo.leader') && onlyLeader.includes('demo.reviewer') && onlyLeader.includes('demo.quiet') && !onlyLeader.includes('demo.old') && !onlyLeader.includes('demo.deployer')
  verify('Mailbox: 選んだ Mailbox と、待ちのあるカードだけを出す (C59)', cardsOk, onlyLeader)
  const mbMsg = { oldHidden: await offMsg(OLD_BODY), youReqShown: await offMsg('YOU-REQ-OLD'), waitsShown: await evaluate("[...document.querySelectorAll('#list .evt.waiting')].every((b) => !b.classList.contains('off'))") }
  verify('Mailbox: 未選択の Mailbox の Message は隠れ、人宛ての request と質問は隠れない (C59)', mbMsg.oldHidden === true && mbMsg.youReqShown === false && mbMsg.waitsShown, mbMsg)
  await reset()
  // Reset: 全部外れ、チップも消え、保存も空に戻る
  const back = await evaluate("({ offKinds: [...document.querySelectorAll('#list .off')].map((b) => b.querySelector('.kind').textContent), mailboxes: FILTER.mailboxes.size, kinds: FILTER.kinds.size, noise: FILTER.noise, chips: [...document.querySelectorAll('#chips .fchip')].map((c) => c.textContent), stored: localStorage.getItem('agent-hub.filter.kinds'), resetShown: !$('resetFilter').hidden })")
  const cardsBack = (await cardNames()).includes('demo.old')
  verify('Reset: 既定 (Noise on、ほかは外れる) に戻り、チップは Noise だけになり、Reset は出ない (C59)', back.offKinds.length > 0 && back.offKinds.every((k) => k === 'notification') && back.mailboxes === 0 && back.kinds === 0 && back.noise && JSON.stringify(back.chips) === JSON.stringify(['Hide noise×']) && back.stored === '[]' && !back.resetShown && cardsBack, { back, cardsBack })
  // d. Kind: reply を隠す。隠れた Message を指すバッジは、隠れた旨を出す。チップの × で 1 つ外れる
  await fcheck('fKind', 'reply', true)
  const kindOff = await evaluate("({ allMsgReply: [...document.querySelectorAll('#list .msg.off')].every((b) => b.querySelector('.kind').textContent === 'reply'), count: document.querySelectorAll('#list .msg.off').length })")
  verify('Kind: reply を隠す (ほかの Message は残る) (C59)', kindOff.allMsgReply && kindOff.count > 0, kindOff)
  const chipText = await evaluate("[...document.querySelectorAll('#chips .fchip')].map((c) => c.textContent)")
  verify('有効な絞り込みは、× 付きのチップで並ぶ (Noise の既定を含む) (C59)', JSON.stringify(chipText) === JSON.stringify(['Hide reply×', 'Hide noise×']), chipText)
  const replySeq = await seqOf('CHANGED: …')
  const hiddenStatus = await evaluate(`(() => { jumpTo({ count: 1, oldestAt: null, oldestSeq: ${replySeq}, eventId: null }); return $('status').textContent })()`)
  verify('隠れた返信を指すバッジは、Kind で隠れていると出し、スレッドは動かさない (C59)', hiddenStatus.includes('hidden by the Kind filter') && hiddenStatus.includes('Reset'), hiddenStatus)
  await chipX('Hide reply')
  verify('チップの × で Kind が外れ、隠れた返信が戻る (通知は既定の Noise で隠れたまま) (C59)', (await evaluate("[...document.querySelectorAll('#list .off')].every((b) => b.classList.contains('evt') && b.querySelector('.kind').textContent === 'notification')")) && (await evaluate("document.querySelectorAll('#list .msg.off').length")) === 0)
  // e. 全部の軸を掛けても、待ちは隠れない
  await fcheck('fMailbox', 'demo.leader', true)
  for (const label of ['request', 'reply', 'notice', 'turn end', 'turn failed', 'answered', 'approved', 'notification', 'boundary']) await fcheck('fKind', label, true)
  await fnoise(true)
  const all = await evaluate(`(() => {
    const humanReq = [...document.querySelectorAll('#list .msg')].filter((b) => b.querySelector('.kind').textContent === 'request' && b.querySelector('.addr').textContent.includes('→ user:browser'))
    const waits = [...document.querySelectorAll('#list .evt.waiting')]
    return {
      humanReq: humanReq.length, humanReqOff: humanReq.filter((b) => b.classList.contains('off')).length,
      waits: waits.length, waitsOff: waits.filter((b) => b.classList.contains('off')).length,
      cards: [...document.querySelectorAll('#mailboxes .mb .name')].map((n) => n.textContent),
    }
  })()`)
  const allOk = all.humanReq >= 1 && all.humanReqOff === 0 && all.waits >= 1 && all.waitsOff === 0 && all.cards.includes('demo.leader') && all.cards.includes('demo.quiet') && !all.cards.includes('demo.deployer')
  verify('全部の軸を掛けても、質問・許可待ち・人宛ての request と、待ちのあるカードは隠れない (C59)', allOk, all)
  await reset()
  // 保存された Mailbox が消えていて、履歴が /mailboxes より先に描かれる場面。/mailboxes を止めて履歴だけ描かせ、届いたら落とす
  await evaluate("localStorage.setItem('agent-hub.filter.mailboxes', JSON.stringify(['demo.gone']))")
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*/mailboxes', requestStage: 'Request' }] })
  await cdp('Page.navigate', { url: `${HUB}/?token=${TOKEN}` })
  await until(async () => paused.length > 0 && (await evaluate("document.querySelectorAll('#list .msg').length")) > 0, 'history before mailboxes')
  const stale = await evaluate("({ msgs: document.querySelectorAll('#list .msg').length, msgOff: document.querySelectorAll('#list .msg.off').length, chips: [...document.querySelectorAll('#chips .fchip')].map((c) => c.textContent), resetShown: !$('resetFilter').hidden })")
  await cdp('Fetch.continueRequest', { requestId: paused[0] })
  await sleep(1000)
  await cdp('Fetch.disable')
  const fresh = await evaluate("({ msgOff: document.querySelectorAll('#list .msg.off').length, chips: [...document.querySelectorAll('#chips .fchip')].map((c) => c.textContent), resetShown: !$('resetFilter').hidden, stored: localStorage.getItem('agent-hub.filter.mailboxes') })")
  verify('保存された消えた Mailbox は、履歴が先に描かれても、一覧が届いたとき外れてチップと Reset が消え、隠れていたものが出る (C59)', stale.msgs > 0 && stale.msgOff > 0 && stale.chips.includes('Mailbox: demo.gone×') && stale.resetShown && fresh.msgOff === 0 && JSON.stringify(fresh.chips) === JSON.stringify(['Hide noise×']) && !fresh.resetShown && fresh.stored === '[]', { stale, fresh })
  await reload()

  // f. Compact: 畳んだ件数と Expand はスレッド操作バーに出る。待ちは畳まれず、Expand で全部戻る
  await evaluate("$('keep').value = 1; $('fold').click()")
  await sleep(200)
  const fold1 = await evaluate("({ text: $('hiddenText').textContent, expand: !$('expand').hidden, bar: !$('hiddenInfo').hidden, waitsFolded: [...document.querySelectorAll('#list .evt.waiting')].filter((b) => b.dataset.compacted === '1').length })")
  verify('Compact: 畳んだ件数と Expand をスレッド操作バーに出し、待ちは畳まない (C59)', /older items compacted/.test(fold1.text) && fold1.expand && fold1.bar && fold1.waitsFolded === 0, fold1)
  await evaluate("$('expand').click()")
  await sleep(200)
  const fold2 = await evaluate("({ text: $('hiddenText').textContent, expand: $('expand').hidden, flagged: [...msgBoxes.values(), ...evtBoxes.values()].filter((b) => b.dataset.compacted === '1').length })")
  verify('Expand で畳みが開き、畳んだ件数と Expand がバーから消える (隠れた件数は既定の Noise のまま残る) (C59)', !/compacted/.test(fold2.text) && fold2.expand && fold2.flagged === 0, fold2)
  await evaluate("try { localStorage.removeItem('agent-hub.keep') } catch (e) {}")

  // g. 保存は軸ごと。読むとき、今ない Mailbox と決まっていない種類は黙って落とし、保存も直す
  await evaluate("localStorage.setItem('agent-hub.filter.mailboxes', JSON.stringify(['demo.leader', 'demo.gone'])); localStorage.setItem('agent-hub.filter.kinds', JSON.stringify(['reply', 'bogus'])); localStorage.setItem('agent-hub.filter.noise', '1')")
  await reload()
  const loaded = JSON.parse(await evaluate("JSON.stringify({ m: [...FILTER.mailboxes], k: [...FILTER.kinds], n: FILTER.noise, stored: localStorage.getItem('agent-hub.filter.mailboxes') })"))
  verify('保存された絞り込みは軸ごとに戻り、今ない Mailbox と決まっていない種類は黙って落とす (C59)', loaded.m.join() === 'demo.leader' && loaded.k.join() === 'reply' && loaded.n === true && loaded.stored === '["demo.leader"]', loaded)
  // 保存された off は、再読み込みのあとも off のまま
  await chipX('Hide noise')
  await reload()
  const offKept = await evaluate("FILTER.noise === false && localStorage.getItem('agent-hub.filter.noise') === '0' && !$('fNoise').checked")
  verify('保存された Noise の off は、再読み込みのあとも off のまま (C59)', offKept === true)
  await reset()
  const resetHidden = await evaluate("$('resetFilter').hidden && FILTER.noise === true")
  verify('Reset のあと、既定 (Noise on) で Reset は出ない (C59)', resetHidden === true)
  await evaluate("try { ['agent-hub.filter.mailboxes', 'agent-hub.filter.kinds', 'agent-hub.filter.noise'].forEach((k) => localStorage.removeItem(k)) } catch (e) {}")

  // モデルと effort (C61): カードに最後に見えた値を出す。両方・片方だけ・どちらもない。値のない欄は出さない
  for (const name of ['demo.m-both', 'demo.m-effort', 'demo.m-none', 'demo.m-switch', 'demo.m-undated', 'demo.m-dated']) await api('POST', `/mailboxes/${name}/attach`, { client: 'claude-code', role: 'deployer', cwd, sessionId: `s-${name}` })
  await hook('demo.m-both', { cwd, hook_event_name: 'SessionStart', session_id: 's-demo.m-both', source: 'startup', model: 'claude-opus-5' })
  await hook('demo.m-both', { cwd, hook_event_name: 'Stop', session_id: 's-demo.m-both', effort: { level: 'medium' } })
  await hook('demo.m-effort', { cwd, hook_event_name: 'Stop', session_id: 's-demo.m-effort', effort: { level: 'high' } })
  await hook('demo.m-none', { cwd, hook_event_name: 'SessionStart', session_id: 's-demo.m-none', source: 'startup' })
  await hook('demo.m-switch', { cwd, hook_event_name: 'PostModelSwitch', session_id: 's-demo.m-switch', from_model: 'claude-opus-5', to_model: 'claude-sonnet-5-5', requested_model: 'sonnet', source: 'command' })
  // 日付つきの名前 (claude-haiku-4-5-20251001) は日付を落とし、日付のない名前 (claude-haiku-5-5) はそのまま
  await hook('demo.m-undated', { cwd, hook_event_name: 'SessionStart', session_id: 's-demo.m-undated', source: 'startup', model: 'claude-haiku-5-5' })
  await hook('demo.m-dated', { cwd, hook_event_name: 'PostModelSwitch', session_id: 's-demo.m-dated', from_model: 'claude-sonnet-5-5', to_model: 'claude-haiku-4-5-20251001', requested_model: 'claude-haiku-4-5-20251001', source: 'picker' })
  await sleep(1500)
  const modelCards = await evaluate(`[...document.querySelectorAll('#mailboxes .mb')].filter((b) => (b.querySelector('.name') || {}).textContent.startsWith('demo.m-')).map((b) => {
    const line = b.querySelector('.modeleff')
    return { name: b.querySelector('.name').textContent, line: line ? line.textContent : null, title: line ? line.title : null }
  })`)
  const lineOf = (name) => (modelCards.find((c) => c.name === name) || {}).line
  const both = lineOf('demo.m-both') === 'opus-5 · medium'
  const effortOnly = lineOf('demo.m-effort') === 'high'
  const neither = lineOf('demo.m-none') === null && modelCards.some((c) => c.name === 'demo.m-none')
  const modelOnly = lineOf('demo.m-switch') === 'sonnet-5-5'
  const undatedOk = lineOf('demo.m-undated') === 'haiku-5-5'
  const datedOk = lineOf('demo.m-dated') === 'haiku-4-5'
  const tipOk = modelCards.every((c) => !c.line || c.title.includes('Last seen value, not a guarantee of the current setting.'))
  verify('モデルと effort: 両方は「opus-5 · medium」、effort だけは「high」、model だけは「sonnet-5-5」、どちらもなければ何も出さない (C61)', both && effortOnly && modelOnly && neither && tipOk, modelCards)
  verify('モデル名: 日付のない名前は「haiku-5-5」、日付つきの名前は日付を落として「haiku-4-5」 (C61)', undatedOk && datedOk, modelCards)
  const kinds = await evaluate("[...document.querySelectorAll('#list .evt .kind')].map((k) => k.textContent)")
  verify('SessionStart と PostModelSwitch は、Event として取り込まれ、スレッドに出る (C61)', kinds.includes('session start') && kinds.includes('model switch'), kinds)

  // カードの信号 (C71): 信号が変わったときだけ 1.5 秒光る。最初の描画と変わらない描き直しでは光らない。作業中は枠が脈打ち、人の番は脈打たない。
  // 光りは描き直しの前に仕掛けた記録 (30ms ごとに .st-flash を見る) で読む。1.5 秒は場面の読みより短いため
  const SIG_RECORDER = "window.__flashed = []; setInterval(() => { for (const b of document.querySelectorAll('#mailboxes .mb.st-flash')) { const k = b.querySelector('.name').textContent + ' ' + [...b.classList].find((c) => c.startsWith('flash-')); if (!window.__flashed.includes(k)) window.__flashed.push(k) } }, 30)"
  // role を付けない: role:deployer 宛ての依頼 (上の場面) が未読として届いてしまうため
  const sig = await api('POST', '/mailboxes/demo.sig/attach', { client: 'claude-code', cwd, sessionId: 's-sig' })
  await turnEnd('demo.sig', 's-sig')
  await cdp('Page.enable') // addScriptToEvaluateOnNewDocument は Page を有効にしてから
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: SIG_RECORDER })
  await cdp('Page.navigate', { url: `${HUB}/?token=${TOKEN}` })
  await sleep(1500)
  const cardOf = (name) => evaluate(`(() => {
    const b = [...document.querySelectorAll('#mailboxes .mb')].find((x) => (x.querySelector('.name') || {}).textContent === ${JSON.stringify(name)})
    if (!b) return null
    const cs = getComputedStyle(b)
    return { cls: b.className, state: b.querySelector('.state').textContent, shadow: cs.boxShadow, anim: cs.animationName }
  })()`)
  const sigCard = () => cardOf('demo.sig')
  const flashes = () => evaluate('window.__flashed.splice(0)')
  // ヘッドレスの Chrome は環境によって動きを減らす設定になる。脈打ちと光りを確かめる場面は、先に動きを許す
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  const first = await sigCard()
  const firstFlash = await flashes()
  verify('信号: 最初の描画は光らず、Idle には枠も脈打ちもない (C71)', first !== null && first.state.startsWith('Idle') && first.shadow === 'none' && first.anim === 'none' && firstFlash.length === 0, { first, firstFlash })

  // 渡す (shim が受け取る) まで、未読だけ。信号は渡したあとの Working (ackAll で渡したことにする)
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'demo.sig' }, body: 'SIG-1: 作業を頼む' })
  await ackAll(sig.attachmentId)
  await sleep(2500)
  const working = await sigCard()
  const workFlash = await flashes()
  // 脈打っている最中の色は混ざった値なので、色は見ず、脈打つ動きがあることと枠があることを見る
  verify('信号: Idle から Working に変わると作業中の色で 1.5 秒光り、そのあと枠が 2 秒で脈打つ (C71)', working !== null && working.state.startsWith('Working') && workFlash.includes('demo.sig flash-working') && working.anim === 'ring-pulse' && working.shadow !== 'none', { working, workFlash })

  // 依頼に返信してから終える。返信のない依頼を渡されたまま終えると、Idle でなく Stopped になる
  const sigReq = (await api('GET', '/messages?after=0&limit=1000')).messages.findLast((m) => m.body === 'SIG-1: 作業を頼む')
  await ackAll(sig.attachmentId)
  await api('POST', '/messages', { kind: 'reply', replyTo: sigReq.id, body: 'SIG-1: できた' }, { 'x-hub-attachment': sig.attachmentId })
  await turnEnd('demo.sig', 's-sig')
  await sleep(2500)
  const idle = await sigCard()
  const idleFlash = await flashes()
  verify('信号: Working から Idle に変わると緑に 1.5 秒光り、Idle に枠は残らない (C71)', idle !== null && idle.state.startsWith('Idle') && idleFlash.includes('demo.sig flash-idle') && idle.shadow === 'none' && idle.anim === 'none', { idle, idleFlash })

  await evaluate('renderMailboxes(mailboxList)')
  await sleep(300)
  await evaluate('renderMailboxes(mailboxList)')
  await sleep(1000)
  const unchanged = await flashes()
  verify('信号: 変わらない描き直しでは光らない (C71)', unchanged.length === 0, unchanged)

  await hook('demo.sig', { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'tu-sig', session_id: 's-sig' })
  await sleep(2500)
  const you = await sigCard()
  const youFlash = await flashes()
  verify('信号: 人の番 (Needs you) に変わると琥珀に光り、枠は脈打たない太い琥珀 (C71)', you !== null && you.state.startsWith('Needs you') && youFlash.includes('demo.sig flash-you') && you.anim === 'none' && you.shadow.includes('154, 91, 0'), { you, youFlash })

  // 動きを減らす設定: 作業中は脈打たず、枠だけ残す。光りも出さない
  // 質問に答えて (Needs you を解く)、依頼を渡す。動きを減らす設定では、作業中の枠は脈打たず、色の枠のまま残る
  await hook('demo.sig', { hook_event_name: 'PostToolUse', session_id: 's-sig', tool_name: 'AskUserQuestion', tool_use_id: 'tu-sig', tool_input: {}, tool_response: {} })
  await sleep(2500) // Idle に戻る際の光りを済ませてから、動きを減らす設定にする
  await flashes()
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'demo.sig' }, body: 'SIG-2: 動きを減らす設定で頼む' })
  await ackAll(sig.attachmentId)
  await sleep(2500)
  const still = await sigCard()
  const stillFlash = await flashes()
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  verify('動きを減らす設定: 作業中は脈打たず枠だけ残り、光らない (C71)', still !== null && still.state.startsWith('Working') && still.anim === 'none' && still.shadow.includes('47, 95, 208') && stillFlash.length === 0, { still, stillFlash })

  // 未読だけ (C71): エージェントの未読は信号ではない。接続中の Mailbox に通知だけが届いたとき、Working と書くが、枠も脈打ちも光りもない
  await api('POST', '/mailboxes/demo.unr/attach', { client: 'claude-code', cwd, sessionId: 's-unr' })
  await sleep(1000)
  const unrBefore = await cardOf('demo.unr')
  await flashes()
  await api('POST', '/messages', { kind: 'notice', to: { type: 'mailbox', id: 'demo.unr' }, body: 'UNREAD-ONLY: 未読だけ' })
  await sleep(2500)
  const unr = await cardOf('demo.unr')
  const unrFlash = await flashes()
  verify('未読だけ: 接続中の Mailbox に未読だけがあっても、枠・脈打ち・光りは出ない (C71)', unrBefore !== null && unrBefore.state.startsWith('Idle') && unr !== null && unr.state.startsWith('Working') && unr.cls.includes('st-unread') && !unr.cls.includes('st-working') && unr.anim === 'none' && unr.shadow === 'none' && !unrFlash.some((k) => k.startsWith('demo.unr')), { unrBefore, unr, unrFlash })

  // Stopped (C71): 渡した依頼に返信しないままターンを終えた。Needs you と同じ琥珀の太い枠で、脈打たない
  const stpAt = await api('POST', '/mailboxes/demo.stp/attach', { client: 'claude-code', cwd, sessionId: 's-stp' })
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'demo.stp' }, body: 'STOP-1: 返信しない依頼' })
  await ackAll(stpAt.attachmentId)
  await turnEnd('demo.stp', 's-stp')
  await sleep(2500)
  const stp = await cardOf('demo.stp')
  verify('Stopped: Needs you と同じ琥珀の太い枠で、脈打たない (C71)', stp !== null && stp.state.startsWith('Stopped') && stp.cls.includes('st-stopped') && stp.anim === 'none' && stp.shadow.includes('154, 91, 0') && stp.shadow === you.shadow, { stp, you: you.shadow })

  // 時刻の表示 (C31): 今日は時刻だけ、前日は日付つき
  const t = await cdp('Runtime.evaluate', {
    expression: `(() => { const now = Date.now(), old = now - 26 * 3600 * 1000; return { today: time(now), todayPlain: new Date(now).toLocaleTimeString(), old: time(old), oldPlain: new Date(old).toLocaleTimeString() } })()`,
    returnByValue: true,
  })
  const tv = t.result.value
  const timeOk = tv && tv.today === tv.todayPlain && tv.old !== tv.oldPlain && tv.old.includes(tv.oldPlain)
  if (!timeOk) failed++
  console.log(`${timeOk ? 'ok' : 'NG'}  今日でない時刻には日付を付ける (C31)`)
  if (!timeOk) console.log(`      ${JSON.stringify(tv)}`)
} catch (e) {
  failed++
  console.error(`NG  ${e.message}`)
  console.error(hubLog.slice(-2000))
} finally {
  try {
    ws?.close()
  } catch {}
  if (chrome) spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'])
  spawnSync('taskkill', ['/PID', String(hub.pid), '/T', '/F'])
  if (process.platform !== 'win32') {
    chrome?.kill()
    hub.kill()
  }
  await sleep(500)
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  process.exitCode = failed ? 1 : 0
}
