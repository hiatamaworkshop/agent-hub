// カードの状態 (design.md §3.15) を、別のポートの Hub とヘッドレスの Chrome で場面ごとに確かめる。
// API で場面を作り、CDP で DOM を読んで、期待する状態と照らす。UI には単体テストがないので、UI を変えたら流す。
// 使い方: npm run ui:check  (Chrome の場所は CHROME。ポートは既定で空いているものを取って表示する。UI_CHECK_PORT / UI_CHECK_CDP_PORT で固定できる)
import { spawn, spawnSync } from 'node:child_process'
import { connect, createServer } from 'node:net'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const TOKEN = 'ui-check-token-0123456789'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// n ports the system gives out now. All n are held at once, so no two of them are the same; then they are released (C151)
async function freePorts(n) {
  const servers = Array.from({ length: n }, () => createServer())
  try {
    await Promise.all(servers.map((s) => new Promise((ok, fail) => { s.once('error', fail); s.listen(0, '127.0.0.1', ok) })))
    return servers.map((s) => s.address().port)
  } finally {
    await Promise.all(servers.map((s) => new Promise((ok) => s.close(ok))))
  }
}
const pickFree = async (avoid) => {
  for (;;) {
    const [p] = await freePorts(1)
    if (p !== avoid) return p
  }
}
// Does something accept a connection on 127.0.0.1:port within a second? (a port set by hand that answers stops the check, C151)
const answers = (port) =>
  new Promise((resolve) => {
    const s = connect({ host: '127.0.0.1', port })
    s.setTimeout(1000)
    s.once('connect', () => { s.destroy(); resolve(true) })
    s.once('error', () => resolve(false))
    s.once('timeout', () => { s.destroy(); resolve(false) })
  })

// The ports: free ones from the system unless UI_CHECK_PORT / UI_CHECK_CDP_PORT set them (C151)
const setHub = process.env.UI_CHECK_PORT ? Number(process.env.UI_CHECK_PORT) : null
const setCdp = process.env.UI_CHECK_CDP_PORT ? Number(process.env.UI_CHECK_CDP_PORT) : null
for (const [name, p] of [['UI_CHECK_PORT', setHub], ['UI_CHECK_CDP_PORT', setCdp]]) {
  if (p !== null && !(Number.isInteger(p) && p > 0 && p < 65536)) {
    console.error(`NG  ${name} is not a port number: ${process.env[name]}`)
    process.exit(1)
  }
}
if (setHub !== null && setHub === setCdp) {
  console.error(`NG  UI_CHECK_PORT and UI_CHECK_CDP_PORT are both ${setHub}. Give them different ports, or unset one`)
  process.exit(1)
}
let PORT, CDP_PORT
if (setHub === null && setCdp === null) [PORT, CDP_PORT] = await freePorts(2)
else {
  PORT = setHub ?? (await pickFree(setCdp))
  CDP_PORT = setCdp ?? (await pickFree(PORT))
}
const HUB = `http://127.0.0.1:${PORT}`
console.log(`ports: Hub ${PORT} (${setHub === null ? 'free from the system' : 'set by UI_CHECK_PORT'}), Chrome debugging ${CDP_PORT} (${setCdp === null ? 'free from the system' : 'set by UI_CHECK_CDP_PORT'})`)
const work = mkdtempSync(join(tmpdir(), 'agent-hub-ui-check-'))

// 5 日前に出され、まだ返信のない依頼 (C44)。Hub は ts を今の時刻で付けるので、起動の前にログへ直接書いておく
mkdirSync(join(work, 'hub'), { recursive: true })
const OLD_BODY = 'GOAL: 5 日前に出した依頼 (返信待ち)'
writeFileSync(
  join(work, 'hub', 'hub.jsonl'),
  JSON.stringify({ op: 'message', message: { id: 'm_ui_check_old', seq: 1, ts: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(), kind: 'request', from: { type: 'user', id: 'browser', role: null }, to: { type: 'mailbox', id: 'demo.old' }, body: OLD_BODY } }) + '\n',
)

// 同じ port に別の Hub が答えているなら、この場面はその Hub の状態を読んでしまう (C142 の見直し)。始める前に止める
// Any listener counts (C151): a port set by hand that answers but is not a Hub would also break the start
if ((await answers(PORT)) || (await fetch(`${HUB}/mailboxes`).then(() => true, () => false))) {
  console.error(`NG  port ${PORT} is already answered by something this check did not start (a Hub, or another process). Stop it (a Hub: node ... src/hub/main.ts) and run again`)
  rmSync(work, { recursive: true, force: true })
  process.exit(1)
}
// A Chrome debugging port set by hand that already answers would be read as this run's page (C151). Stop before Chrome starts.
// A free port from the system is not checked: it was free a moment ago, and it is held by no one else
if (setCdp !== null && (await answers(CDP_PORT))) {
  console.error(`NG  UI_CHECK_CDP_PORT ${CDP_PORT} already answers, so Chrome cannot take its debugging port there. Stop what listens on it, or unset UI_CHECK_CDP_PORT to take a free port`)
  rmSync(work, { recursive: true, force: true })
  process.exit(1)
}
let hubLog = ''
const hubs = [] // この場面で起動した Hub すべて。終わりに止める (起動し直すたびに増える)
const startHub = () => {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/hub/main.ts'], {
    cwd: ROOT,
    // HUB_LOG_FILE (C158): the check's Hub writes its log beside its data in the work folder, not into the real Hub's logs/hub.log
    env: { ...process.env, HUB_DATA_DIR: join(work, 'hub'), HUB_LOG_FILE: join(work, 'hub.log'), HUB_PORT: String(PORT), HUB_TOKEN: TOKEN, HUB_READ_RETENTION_HOURS: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  hubs.push(child)
  child.stdout.on('data', (d) => (hubLog += d))
  child.stderr.on('data', (d) => (hubLog += d))
  return child
}
let hub = startHub()
// 起動し直す (C142): 今の Hub を止め、同じデータで立て直す。止まった Hub の分は Mailbox の接続が消えている
async function restartHub() {
  const old = hub
  const exited = new Promise((r) => old.once('exit', r))
  old.kill()
  await exited
  hub = startHub()
  await until(async () => (await fetch(`${HUB}/mailboxes`, { headers: { authorization: `Bearer ${TOKEN}` } })).ok, 'hub restarted')
}
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

// 地図の You ノード (C127)。地図を出して、人のノードの状態の行と枠を読む。読んだあと、出す前の状態に戻す (本文の場面は一覧を見る)。
// expect: 'Your move' (その行と薄い枠がある) / 'Needs you' (Needs you の行で、Your move はない) / 'none' (状態の行も Your move もない) / 'no move' (Your move はない)
async function mapScene(label, expect) {
  const was = (await cdp('Runtime.evaluate', { expression: "(() => { const was = !$('map').hidden; if (!was) $('mapToggle').click(); return was })()", returnByValue: true })).result.value
  await sleep(1500)
  const expr = `JSON.stringify((() => { const n = document.querySelector('#map .mapnode.human'); const s = n && n.querySelector('.state'); return { cls: n ? n.className : '', state: s ? s.textContent : '' } })())`
  const got = JSON.parse((await cdp('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value)
  if (!was) await cdp('Runtime.evaluate', { expression: "$('mapToggle').click()", returnByValue: true })
  const move = got.cls.includes('st-move')
  const ok =
    expect === 'Your move' ? got.state === 'Your move' && move && !got.cls.includes('st-you')
    : expect === 'Needs you' ? got.state.startsWith('Needs you') && !move
    : expect === 'none' ? got.state === '' && !move
    : !move
  if (!ok) failed++
  console.log(`${ok ? 'ok' : 'NG'}  ${label}`)
  if (!ok) console.log(`      ${JSON.stringify(got)} (期待は ${expect})`)
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
  await mapScene('2 人とも手が空いている: 地図の You は Your move (C127)', 'Your move')

  await api('POST', '/messages', { kind: 'request', to: { type: 'user', id: 'browser' }, body: 'A か B か' }, asLead)
  await turnEnd('demo.leader', 's-lead')
  await scene('leader が Hub で人に尋ねてターンを終えた (C40)', { 'demo.leader': 'Needs you (request)', 'demo.deployer': 'Idle' }, '1 waiting')
  await mapScene('人に尋ねた: 地図は Needs you だけで、Your move は出さない (C127)', 'Needs you')

  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'demo.leader' }, body: 'A で進めて' })
  await scene('人が返信ではなく新しい依頼で答えた (C28 で質問が閉じる)', { 'demo.leader': 'Working' })

  await ackAll(lead.attachmentId)
  const job = await api('POST', '/messages', { kind: 'request', to: { type: 'role', id: 'deployer' }, body: 'GOAL: C1 を実装する' }, asLead)
  await turnEnd('demo.leader', 's-lead')
  await scene('leader が deployer に渡してターンを終えた', { 'demo.leader': 'Waiting on others (deployer)', 'demo.deployer': 'Working' })
  await mapScene('deployer が作業中: 地図に Your move は出さない (C127)', 'none')

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
  await mapScene('作業が終わって Idle に戻った (SSE で再描画): 地図に Your move が出る (C127)', 'Your move')
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
  await mapScene('leader が未接続の reviewer を待つ (C49): 地図は Needs you 1 で、Your move は出さない (C127)', 'Needs you')
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

  // 人からの依頼を渡したまま返信せずにターンを終え、同時に役割 auditor (Mailbox なし) へ依頼を出していた (C109)。
  // 未接続の相手があっても Stopped と出し、その名前を添える。タブ・アイコン・バッジはカードと同じ状態で数える
  const stk = await api('POST', '/mailboxes/stk.leader/attach', { client: 'claude-code', role: 'leader', cwd: othCwd, sessionId: 's-stk' })
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'stk.leader' }, body: 'GOAL: 人からの依頼 (C109 の場面)' })
  await api('POST', `/attachments/${stk.attachmentId}/ack`, { upTo: (await api('GET', '/messages?after=0&limit=1000')).messages.at(-1).seq })
  await api('POST', '/messages', { kind: 'request', to: { type: 'role', id: 'auditor' }, body: 'TARGET: C1 (未接続の役割へ)' }, { 'x-hub-attachment': stk.attachmentId })
  await api('POST', '/events/claude-code', { cwd: othCwd, hook_event_name: 'Stop', session_id: 's-stk' }, { 'x-hub-mailbox': 'stk.leader' })
  await scene('返信のない依頼を渡したままターンを終え、未接続の auditor にも依頼を出していた (C109)', { 'stk.leader': 'Stopped, no reply (auditor not connected)' })
  await mapScene('Stopped のカードがあっても、ほかが Idle なら Your move が出る (C127)', 'Your move')
  const stkScreen = await screen()
  const stkBadgeCheck = JSON.parse((await cdp('Runtime.evaluate', { expression: `JSON.stringify({ states: $('states').textContent, tabStopped, tabWaiting, title: document.title })`, returnByValue: true })).result.value)
  const stoppedCards = stkScreen.cards.filter((c) => c.state.startsWith('Stopped')).length
  const waitingCards = stkScreen.cards.filter((c) => c.state.startsWith('Needs you')).length
  const badgeOk = stkBadgeCheck.tabStopped === stoppedCards && stkBadgeCheck.tabWaiting === waitingCards && stkBadgeCheck.states.includes(`Stopped, no reply ${stoppedCards}`)
  if (!badgeOk) failed++
  console.log(`${badgeOk ? 'ok' : 'NG'}  タブとサイドバーのバッジは、カードの Stopped と Needs you の数と同じ (C109)`)
  if (!badgeOk) console.log(`      ${JSON.stringify({ stkBadgeCheck, stoppedCards, waitingCards })}`)
  await api('DELETE', `/attachments/${stk.attachmentId}`)

  // 同じ場面で、試験をバックグラウンドで流したままターンを終えた。C109 の Stopped にはせず、Working にもせず、C49 の Needs you (未接続の名前) を出す。
  // 数もタブのタイトルと一致する (C109 の例外)
  const bgk = await api('POST', '/mailboxes/bgk.leader/attach', { client: 'claude-code', role: 'leader', cwd: othCwd, sessionId: 's-bgk' })
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'bgk.leader' }, body: 'GOAL: 人からの依頼 (試験を流す場面)' })
  await api('POST', `/attachments/${bgk.attachmentId}/ack`, { upTo: (await api('GET', '/messages?after=0&limit=1000')).messages.at(-1).seq })
  await api('POST', '/messages', { kind: 'request', to: { type: 'role', id: 'auditor' }, body: 'TARGET: C2 (未接続の役割へ、試験を流しながら)' }, { 'x-hub-attachment': bgk.attachmentId })
  await api('POST', '/events/claude-code', { cwd: othCwd, hook_event_name: 'Stop', session_id: 's-bgk', background_tasks: [{ status: 'running', description: 'npm test' }] }, { 'x-hub-mailbox': 'bgk.leader' })
  await scene('試験を流したままターンを終え、返信のない依頼と未接続の auditor がある (C109 の例外。C49 のまま Needs you)', { 'bgk.leader': 'Needs you (auditor not connected)' }, '1 waiting')
  const bgkScreen = await screen()
  const bgkTab = JSON.parse((await cdp('Runtime.evaluate', { expression: `JSON.stringify({ tabWaiting, tabStopped })`, returnByValue: true })).result.value)
  const bgkWaitingCards = bgkScreen.cards.filter((c) => c.state.startsWith('Needs you')).length
  const bgkOk = bgkTab.tabWaiting === bgkWaitingCards && bgkTab.tabStopped === bgkScreen.cards.filter((c) => c.state.startsWith('Stopped')).length
  if (!bgkOk) failed++
  console.log(`${bgkOk ? 'ok' : 'NG'}  試験の場面でも、タブの件数はカードの Needs you・Stopped と同じ (C109 の例外)`)
  if (!bgkOk) console.log(`      ${JSON.stringify({ bgkTab, bgkWaitingCards })}`)
  await api('DELETE', `/attachments/${bgk.attachmentId}`)

  // UI が最初に読むのは最近の Event 200 件だけ。ほかの Mailbox の Event で押し出しても、Hub の lastTurnEnd で Idle のまま (C41)
  for (let i = 0; i < 250; i++) await turnEnd('demo.noise', 's-noise')
  await cdp('Page.navigate', { url: `${HUB}/` })
  await sleep(1000)
  // usage limit で止まった接続中のカードは、Your move を隠す (C127)。Paused は解けるまで待つだけで、人の番ではない。前後を比べる
  const pz = await api('POST', '/mailboxes/pz.worker/attach', { client: 'claude-code', cwd, sessionId: 's-pz' })
  await mapScene('接続中の別のカードが Idle: 地図に Your move が出る (C127)', 'Your move')
  await hook('pz.worker', { hook_event_name: 'StopFailure', session_id: 's-pz', error: 'rate_limit', last_assistant_message: "You've hit your limit" })
  await mapScene('同じカードが usage limit で Paused: 地図に Your move は出ない (C127)', 'none')
  await api('DELETE', `/attachments/${pz.attachmentId}`)
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

  // Health check (C76): Stopped, no reply の Mailbox だけに、いちばん古い返信のない依頼を指す notice を 1 通ずつ送る。依頼は増やさない
  {
    const awaiting = async (name) => (await api('GET', '/mailboxes')).mailboxes.find((m) => m.name === name).backlog.awaitingReply
    const stopped = JSON.parse(await evaluate("JSON.stringify(stoppedMailboxes().map((m) => m.name).sort())"))
    const before = { seq: (await api('GET', '/messages?after=0&limit=1000')).messages.at(-1).seq, dep: await awaiting('demo.deployer') }
    const label = await evaluate("({ text: $('health').textContent, disabled: $('health').disabled, left: $('health').getBoundingClientRect().left > innerWidth / 2 })")
    verify('Health check: ヘッダー右上のボタンに Stopped, no reply の数が出て、1 件以上で押せる (C76)', stopped.length >= 2 && stopped.includes('demo.deployer') && stopped.includes('demo.old') && label.text === `Health check (${stopped.length})` && !label.disabled && label.left, { stopped, label })
    // hub.config.json (C74): ページは /config の値を数としてだけ使い、警告は textContent で出す。api を差し替えて確かめ、戻す
    const cfg = await evaluate(`(async () => {
      const real = api
      api = async () => ({ config: { projects: { olderDays: 7 } }, warnings: ['x <img src=x onerror=alert(1)> bad', 'y'] })
      await loadConfig()
      const shown = { days: hubConfig.projects.olderDays, text: $('cfgWarn').textContent, title: $('cfgWarn').title, imgs: document.querySelectorAll('#cfgWarn img').length }
      api = async () => ({ config: { projects: { olderDays: '7; drop' } }, warnings: [] })
      await loadConfig()
      const bad = { days: hubConfig.projects.olderDays, text: $('cfgWarn').textContent }
      api = real
      await loadConfig()
      return { shown, bad, real: { days: hubConfig.projects.olderDays, text: $('cfgWarn').textContent } }
    })()`)
    verify('設定: ページは /config の値を数として使い、警告は文字列で出す。形の違う値は既定 (C74)', cfg.shown.days === 7 && cfg.shown.text === 'hub.config.json: 2 warnings' && cfg.shown.title.includes('<img') && cfg.shown.imgs === 0 && cfg.bad.days === 30 && cfg.bad.text === '' && cfg.real.days === 30 && cfg.real.text === '', cfg)
    // Hub の上限と保存期間 (C75): GET /config の limits を型と範囲を確かめて使う。api を差し替えて確かめ、戻す
    const lim = await evaluate(`(async () => {
      const real = api
      const withLimits = async (limits) => { api = async () => ({ config: { projects: { olderDays: 30 } }, warnings: [], ...(limits === undefined ? {} : { limits }) }); await loadConfig() }
      const png = (n) => new File([new Uint8Array(n)], 'a.png', { type: 'image/png' })
      const tryAdd = (files) => { attachments = []; $('err').textContent = ''; addFiles(files); const r = { n: attachments.length, err: $('err').textContent }; attachments = []; renderTray(); $('err').textContent = ''; return r }
      // 保存期間の未読だけの mailbox は使わず、渡して 8 時間たち、ターン終了の Event がない Mailbox を作る
      const fake = () => ({ name: 'fake.stale', attachment: { id: 'a' }, backlog: { unread: { count: 0 }, outgoing: { count: 0 }, awaitingReply: { count: 0 }, lastHanded: { ts: new Date(Date.now() - 8 * 3600000).toISOString(), seq: 1 } } })
      const out = {}
      await withLimits({ maxUploadBytes: 1000, maxFilesPerMessage: 1, readRetentionHours: 6 })
      out.set = { limits: hubLimits, big: tryAdd([png(2000)]), two: tryAdd([png(10), png(10)]), ok: tryAdd([png(10)]) }
      out.stale6 = { hours: staleHandedHours(), key: (stateOf(fake()) || {}).key }
      await withLimits({ maxUploadBytes: 1000, maxFilesPerMessage: 1, readRetentionHours: 24 })
      out.stale24 = { hours: staleHandedHours(), key: (stateOf(fake()) || {}).key }
      await withLimits({ maxUploadBytes: 1000, maxFilesPerMessage: 1, readRetentionHours: 0 })
      out.stale0 = staleHandedHours()
      await withLimits({ maxUploadBytes: '1000', maxFilesPerMessage: -1, readRetentionHours: 'x' })
      out.badTypes = { limits: hubLimits, hours: staleHandedHours() }
      await withLimits(undefined)
      out.absent = { limits: hubLimits, big: tryAdd([png(2000)]), five: tryAdd([png(10), png(10), png(10), png(10), png(10)]), hours: staleHandedHours() }
      api = async () => { throw new Error('boom') }
      await loadConfig()
      out.failed = { limits: hubLimits, hours: staleHandedHours() }
      api = real
      await loadConfig()
      out.real = hubLimits
      return out
    })()`)
    const none = { maxUploadBytes: null, maxFilesPerMessage: null, readRetentionHours: null }
    verify('Hub の上限: 画像の事前確認は /config の値を使い、超えれば Hub に送る前に断る (C75)', JSON.stringify(lim.set.limits) === JSON.stringify({ maxUploadBytes: 1000, maxFilesPerMessage: 1, readRetentionHours: 6 }) && lim.set.big.n === 0 && lim.set.big.err.includes('smaller') && lim.set.two.n === 1 && lim.set.two.err === 'At most 1 image per message.' && lim.set.ok.n === 1 && lim.set.ok.err === '', lim.set)
    verify('Hub の上限: 値がない (古い Hub・取得失敗) か型が外れているときは事前確認をせず、Hub のエラーに任せる (C75)', JSON.stringify(lim.absent.limits) === JSON.stringify(none) && lim.absent.big.n === 1 && lim.absent.five.n === 5 && JSON.stringify(lim.badTypes.limits) === JSON.stringify(none) && JSON.stringify(lim.failed.limits) === JSON.stringify(none), lim)
    verify('Hub の上限: 作業中とみなす上限は min(12 時間, 保存期間)。6 時間なら 8 時間前の受け渡しは作業中でない。24 時間なら 12 時間のまま。分からない・0 でも 12 (C75)', lim.stale6.hours === 6 && lim.stale6.key !== 'working' && lim.stale24.hours === 12 && lim.stale24.key === 'working' && lim.stale0 === 12 && lim.badTypes.hours === 12 && lim.absent.hours === 12 && lim.failed.hours === 12, lim)
    verify('Hub の上限: 実際の Hub の /config から、上限 (20 MB・4 枚) と保存期間 (この Hub は HUB_READ_RETENTION_HOURS=0) を受け取る (C75)', lim.real.maxUploadBytes === 20 * 1024 * 1024 && lim.real.maxFilesPerMessage === 4 && lim.real.readRetentionHours === 0, lim.real)
    // N=0: 一覧を空にして描き直し、戻す。押せず、琥珀にしない
    const zero = await evaluate("(() => { const keep = mailboxList; mailboxList = []; renderHealth(); const r = { text: $('health').textContent, disabled: $('health').disabled, color: getComputedStyle($('health')).color, you: getComputedStyle(document.documentElement).getPropertyValue('--st-you').trim() }; mailboxList = keep; renderHealth(); return r })()")
    verify('Health check: 0 件のときは押せず、琥珀にならない (C76)', zero.text === 'Health check (0)' && zero.disabled && zero.color !== 'rgb(154, 91, 0)' && zero.color !== zero.you, zero)
    const hdr = await evaluate("document.querySelector('header').getBoundingClientRect().height")
    verify('ページのヘッダーの高さは 32px 以下 (C76)', hdr <= 32, { hdr })
    // ボタンの色 (N>0): --st-you を読む。タブの絵: Stopped があれば PNG の件数バッジ、作業中だけなら作業中の色の hub、何もなければ idle の hub
    const btn = await evaluate("(() => { const probe = document.createElement('span'); probe.style.color = 'var(--st-you)'; document.body.append(probe); const you = getComputedStyle(probe).color; probe.remove(); return { color: getComputedStyle($('health')).color, you } })()")
    verify('Health check: 1 件以上のとき、ボタンは --st-you の琥珀 (C76)', btn.color === btn.you, btn)
    // 絵は blob: の URL (CSP の img-src 'self' blob: で読める)。href だけでなく、実際に読めることを Image の onload と securitypolicyviolation で確かめる
    await evaluate("window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI.slice(0, 30)))")
    const snap = () => evaluate("(() => { const l = [...document.querySelectorAll('link[rel~=icon]')]; return { n: l.length, href: l[0] && l[0].href, type: l[0] && l[0].type } })()")
    const icon = async (prevHref) => {
      for (let i = 0; i < 30; i++) {
        const r = await snap()
        if (r.href && r.href !== prevHref) return r
        await sleep(100)
      }
      return snap()
    }
    const loads = (href) => evaluate(`new Promise((resolve) => { const im = new Image(); im.onload = () => resolve(true); im.onerror = () => resolve(false); im.src = ${JSON.stringify(href)} })`)
    const live = await icon('')
    verify('タブの絵: Stopped があるとき、hub ではなく PNG の件数バッジ (blob: で、読み込める) (C70)', live.n === 1 && live.href.startsWith('blob:') && live.type === 'image/png' && (await loads(live.href)), { n: live.n, type: live.type, href: (live.href || '').slice(0, 30) })
    // 3 つの枝を、ページの変数を差し替えて 1 つずつ。戻して描き直す
    const branch = async (w, st, un, wk) => {
      const before = (await snap()).href
      await evaluate(`(() => { tabWaiting = ${w}; tabStopped = ${st}; tabUnread = ${un}; tabWorking = ${wk}; showTabUnread() })()`)
      const r = await icon(before)
      return { ...r, loads: await loads(r.href) }
    }
    const workingIcon = await branch(0, 0, 0, true)
    const idleIcon = await branch(0, 0, 0, false)
    const badgeIcon2 = await branch(0, 1, 0, true)
    const violations = await evaluate('window.__csp')
    verify('タブの絵: 作業中だけなら作業中の色の hub (SVG)、何もなければ idle の hub (SVG)、待ちがあれば作業中でも件数バッジ (PNG)。どれも読み込め、CSP に止められない (C70)', workingIcon.type === 'image/svg+xml' && idleIcon.type === 'image/svg+xml' && badgeIcon2.type === 'image/png' && workingIcon.href !== idleIcon.href && workingIcon.n === 1 && idleIcon.n === 1 && badgeIcon2.n === 1 && workingIcon.loads && idleIcon.loads && badgeIcon2.loads && violations.length === 0, { workingIcon: { type: workingIcon.type, loads: workingIcon.loads }, idleIcon: { type: idleIcon.type, loads: idleIcon.loads }, badgeIcon2: { type: badgeIcon2.type, loads: badgeIcon2.loads }, violations })
    await evaluate('renderBacklog(); (() => { const s = stoppedMailboxes().length; tabWaiting = -1; renderBacklog() })()')
    await evaluate("$('health').click()")
    await sleep(1500)
    const after = (await api('GET', `/messages?after=${before.seq}&limit=1000`)).messages
    const notes = after.filter((m) => m.kind === 'notice' && m.body.startsWith('Health check:'))
    const targets = notes.map((m) => m.to.id).sort()
    const named = await Promise.all(notes.map(async (m) => {
      const aw = await api('GET', '/mailboxes').then((r) => r.mailboxes.find((x) => x.name === m.to.id).backlog.awaitingReply)
      const req = (await api('GET', `/messages?after=${aw.oldestSeq - 1}&limit=1`)).messages[0]
      return m.from.type === 'user' && m.from.id === 'browser' && m.body === `Health check: #${aw.oldestSeq} has no reply in the Hub. If you have its result, send it now with post_message (kind=reply, reply_to=${req.id}). If you cannot finish it, reply with one line saying why. Do not re-check or re-run anything for this.`
    }))
    verify('Health check: Stopped, no reply の Mailbox にだけ、user:browser の notice を 1 通ずつ。最も古い依頼の #seq と id を定型文で指す (C76)', JSON.stringify(targets) === JSON.stringify(stopped) && named.every(Boolean), { stopped, targets, named })
    const depAfter = await awaiting('demo.deployer')
    const closes = (await api('GET', '/messages?after=0&limit=1000')).messages.find((m) => m.seq === before.dep.oldestSeq)
    await ackAll(dep.attachmentId)
    await api('POST', '/messages', { kind: 'reply', replyTo: closes.id, body: 'Health check への返信' }, { 'x-hub-attachment': dep.attachmentId })
    const depClosed = await awaiting('demo.deployer')
    verify('Health check: notice は返信待ちを増やさず、元の依頼への返信で通常どおり閉じる (C76)', depAfter.count === before.dep.count && depClosed.count < before.dep.count && depClosed.oldestSeq !== before.dep.oldestSeq, { before: before.dep, depAfter, depClosed })
    await sleep(500)
    const label2 = await evaluate("$('health').textContent")
    verify('Health check: 数は backlog に追従する (C76)', label2 === `Health check (${(await evaluate("stoppedMailboxes().length"))})`, { label2 })
  }
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
  // When the index was sent (C138): the item header, the item dialog and the Draft request show the Hub's updatedAt (GET /indexes)
  const sentIndex = (await api('GET', '/indexes')).indexes.find((x) => x.project === cwd && x.source === 'docs/roadmap.md')
  const sentWant = await evaluate(`indexSentText(${JSON.stringify(sentIndex.updatedAt)})`)
  const sentHeaders = await evaluate(`[...document.querySelectorAll('#items .itemhead')].filter((h) => h.textContent.includes('docs/roadmap.md')).map((h) => (h.querySelector('.sent') || {}).textContent || null)`)
  await evaluate("$('body').value = ''")
  await clickCard('C1')
  await sleep(300)
  const sentModal = await evaluate("($('itemMeta').querySelector('.sent') || {}).textContent || null")
  await evaluate("$('itemDraft').click()")
  await sleep(300)
  const sentDraft = await evaluate("$('body').value")
  const oldDate = await evaluate("indexSentText('2001-02-03T04:05:00.000Z')")
  const noTime = await evaluate("[indexSentText(undefined), indexSentText(null), indexSentText('not a date')].join('|')")
  // The draft's time sits beside its label, not in the text (C159): the text has no time, so it cannot read as part of DONE WHEN
  const sentDraftLabel = await evaluate("($('replyInfo').querySelector('.sent') || {}).textContent || null")
  verify('Index sent time (C138): the Items header, the item modal and the draft\'s request label show the Hub\'s updatedAt as a time (C159: the label, not the text)',
    sentWant.startsWith('index sent ') && sentHeaders.includes(sentWant) && sentModal === sentWant && sentDraftLabel === sentWant && sentDraft.startsWith('GOAL: C1 一つ目') && !sentDraft.includes('index sent'),
    { sentWant, sentHeaders, sentModal, sentDraftLabel, sentDraftTail: sentDraft.slice(-60) })
  verify('Index sent time (C138): another day adds the date; a missing or invalid updatedAt shows nothing and does not throw',
    oldDate.startsWith('index sent ') && oldDate.length > sentWant.length && noTime === '||', { oldDate, noTime })
  await evaluate("$('body').value = ''")

  // C159: the index time is outside the drafted request's text. The page's own display (bodyOf) of the text must show DONE WHEN with
  // only the item's done-when lines, and the time beside the request label: only the time for an index sent today, the date too for another day
  const draftC1 = (updatedAt) => evaluate(`(() => {
    $('body').value = ''
    const ix0 = currentIndex({ project: ${JSON.stringify(cwd)}, source: 'docs/roadmap.md' })
    const ix = ${updatedAt ? `{ ...ix0, updatedAt: ${JSON.stringify(updatedAt)} }` : 'ix0'}
    const item = ix.items.find((x) => x.id === 'C1')
    draftFromItem(ix, item)
    const lines = [...bodyOf($('body').value).querySelectorAll('.ln')].map((s) => s.textContent)
    const at = lines.findIndex((l) => l.startsWith('DONE WHEN'))
    return { text: $('body').value, label: $('replyInfo').textContent, doneLines: lines.slice(at + 1), conds: item.conditionTexts }
  })()`)
  const today = await draftC1(null)
  const todayTime = await evaluate(`(() => { const u = ${JSON.stringify(sentIndex.updatedAt)}; return indexSentText(u) === 'index sent ' + new Date(u).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })()`)
  verify('C159: a draft from an index sent today keeps the time out of DONE WHEN; the label shows only the time',
    !today.text.includes('index sent') && today.doneLines.length === today.conds.length && today.doneLines.every((l, i) => l === `- ${today.conds[i]}`) &&
      today.label.includes(sentWant) && todayTime === true,
    { doneLines: today.doneLines, conds: today.conds, label: today.label, todayTime })
  const older = await draftC1('2001-02-03T04:05:00.000Z')
  const olderWant = await evaluate("indexSentText('2001-02-03T04:05:00.000Z')")
  verify('C159: a draft from an index sent on another day keeps the time out of DONE WHEN; the label shows the date and the time',
    !older.text.includes('index sent') && older.doneLines.length === older.conds.length && older.doneLines.every((l, i) => l === `- ${older.conds[i]}`) &&
      olderWant.length > sentWant.length && older.label.includes(olderWant),
    { doneLines: older.doneLines, label: older.label, olderWant })
  await evaluate("$('body').value = ''")

  // The item modal follows its index (C138): on an index change it shows the new content and time together; a vanished item is said so, with no draft.
  // A separate project keeps the scenes above unchanged; the project filter is restored at the end
  const liveFilterBefore = await evaluate('FILTER.project')
  const liveWork = join(work, 'live')
  const liveItems = (second) => [
    itemOf('C901', second ? 'second wording' : 'first wording', 'decided', { conditionTexts: [second ? 'new line' : 'first line'], conditions: { done: 0, total: 1 }, line: 1 }),
    itemOf('C902', 'second item', 'decided', { conditionTexts: ['other line'], conditions: { done: 0, total: 1 }, line: 2 }),
  ]
  await sendIndex(liveWork, 'docs/live.md', { items: liveItems(false) })
  await sleep(1200)
  await evaluate("chooseProject('')")
  await sleep(300)
  await clickCard('C901')
  await sleep(300)
  const modalBefore = await modalState()
  await sendIndex(liveWork, 'docs/live.md', { items: liveItems(true) })
  await sleep(1500)
  const modalAfter = await modalState()
  const liveIndex = (await api('GET', '/indexes')).indexes.find((x) => x.project === liveWork && x.source === 'docs/live.md')
  const modalSent = await evaluate("($('itemMeta').querySelector('.sent') || {}).textContent || null")
  const liveWant = await evaluate(`indexSentText(${JSON.stringify(liveIndex.updatedAt)})`)
  verify('Index change while the item modal is open: the new content and the new time show together, with no old wording (C138)',
    modalBefore.title === 'C901. first wording' && modalAfter.open && modalAfter.title === 'C901. second wording' &&
      JSON.stringify(modalAfter.conds) === JSON.stringify(['new line']) && modalSent === liveWant,
    { modalBefore, modalAfter, modalSent, liveWant })
  // The item vanishes from the index: the modal says so, and the draft button is hidden
  await sendIndex(liveWork, 'docs/live.md', { items: [liveItems(true)[1]] })
  await sleep(1500)
  const vanished = await evaluate("({ open: $('itemDialog').open, title: $('itemTitle').textContent, draftHidden: $('itemDraft').hidden, meta: $('itemMeta').textContent })")
  verify('An item that vanished from the index while its modal is open: the modal says so and offers no draft (C138)',
    vanished.open && vanished.title.includes('not in the index any more') && vanished.draftHidden === true && vanished.meta.includes('no longer in the index'), vanished)
  await evaluate("$('itemClose').click()")
  // Day change (C138): the "index sent" times are refreshed by the 30 s interval, so the date appears without a reload
  const headerSent = await evaluate("(() => { const n = document.querySelector('#items .itemhead .sent'); return n ? { text: n.textContent, updated: n.dataset.updated } : null })()")
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const sameDayText = await evaluate(`indexSentText(${JSON.stringify(new Date().toISOString())})`)
  const dayChanged = headerSent && await evaluate(`(() => { const n = document.querySelector('#items .itemhead .sent'); n.dataset.updated = ${JSON.stringify(yesterday)}; refreshSentTimes(); const t = n.textContent; n.dataset.updated = ${JSON.stringify(headerSent.updated)}; refreshSentTimes(); return t })()`)
  verify('The header\'s index sent time gets the date when the day changes, without a reload (C138)',
    !!headerSent && dayChanged === (await evaluate(`indexSentText(${JSON.stringify(yesterday)})`)) && dayChanged.length > sameDayText.length,
    { headerSent, dayChanged, sameDayText })
  await evaluate(`chooseProject(${JSON.stringify(liveFilterBefore)})`)

  // 組み込みコマンドで始まる本文は、実行されないと知らせる。似た名前や // の逃がしには出さない (C13)
  const hintOf = (text) => evaluate(`(() => { $('body').value = ${JSON.stringify(text)}; updateHint(); return $('hint').textContent })()`)
  const builtinHint = await hintOf('/clear')
  const compactHint = await hintOf('/compact now')
  const notBuiltin = await hintOf('/clearx')
  const escaped = await hintOf('//clear')
  verify('本文が /clear や /compact で始まると、文字として届き実行されないと出す (C13)',
    builtinHint.includes('/clear is a Claude Code command') && builtinHint.includes('does not run') && compactHint.includes('/compact is a Claude Code command'), { builtinHint, compactHint })
  verify('組み込みでない名前と // の逃がしには出さない (C13)', !notBuiltin.includes('Claude Code command') && escaped === '', { notBuiltin, escaped })
  await evaluate("$('body').value = ''; updateHint()")
  // チェックを送らない古い形の索引は、印を出さない
  await api('PUT', '/indexes', { project: join(work, 'old2'), source: 'docs/x.md', items: [itemOf('C30', '古い形', 'decided', { conditionTexts: ['古い形の一行'], conditions: { done: 0, total: 1 } })] })
  await sleep(1500)
  await clickCard('C30')
  await sleep(300)
  const oldM = await modalState()
  verify('モーダル: チェックを送らない古い形の索引は印を出さない (C54)', JSON.stringify(oldM.conds) === JSON.stringify(['古い形の一行']), oldM)
  await evaluate("$('itemClose').click()")

  // 索引のないプロジェクト (Mailbox だけがある) を選ぶと、Items は docs:index のコマンドを出す。索引が届くと消える (C107)
  const noIdx = join(work, 'noidx')
  const noIdxAttach = await api('POST', '/mailboxes/demo.noidx/attach', { client: 'claude-code', cwd: noIdx, sessionId: 's-noidx' })
  await sleep(1000)
  await evaluate(`chooseProject(projectKey(${JSON.stringify(noIdx)}))`)
  await sleep(500)
  const readEmpty = () => evaluate(`({ head: !$('itemsHead').hidden, codes: [...$('items').querySelectorAll('code')].map((c) => c.textContent), text: $('items').textContent })`)
  const emptyItems = await readEmpty()
  verify('Items: 索引のないプロジェクトを選ぶと、見出しと docs:index のコマンド (--project) を出す (C107)', emptyItems.head && JSON.stringify(emptyItems.codes) === JSON.stringify([`npm run docs:index -- --project ${noIdx}`]) && emptyItems.text.includes('No roadmap index for noidx'), emptyItems)
  verify('Items: 索引のないときのコマンドは --file を付けず、欄に --file を足すよう書かない (.agent-hub.json は docs:index が読む) (C107)', emptyItems.codes.every((c) => !c.includes('--file')) && !emptyItems.text.includes('--file'), emptyItems)
  await sendIndex(noIdx, 'docs/roadmap.md', { items: [itemOf('C1', '一つ目', 'decided')] })
  await sleep(1500)
  const filled = await readEmpty()
  verify('Items: 索引が届くと、索引のないときの欄は消え、項目が出る (C107)', filled.codes.length === 0 && filled.text.includes('一つ目'), filled)
  await api('DELETE', `/indexes?project=${encodeURIComponent(noIdx)}&source=${encodeURIComponent('docs/roadmap.md')}`)
  // 場面の後始末: この Mailbox は後の場面 (サイドバーの数え方など) に響かないよう、切って消す
  await api('DELETE', `/attachments/${noIdxAttach.attachmentId}`)
  await api('DELETE', '/mailboxes/demo.noidx')
  await sleep(1000)
  await evaluate("chooseProject('')")

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
  // 光りが出るのを待ち、光りが終わって枠が止まるまで待つ。固定の待ち時間だと、再描画で光りが掛け直されたとき、光りの途中の枠を読んでしまう
  let youFlash = []
  await until(async () => { youFlash = await flashes(); return youFlash.includes('demo.sig flash-you') }, 'flash shown', 40)
  await until(async () => (await sigCard())?.anim === 'none', 'flash ended', 60)
  const you = await sigCard()
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

  // 地図 (C78、design.md §3.2)。前の場面に響かないよう map.* の Mailbox で作る。
  // 切り替え・列・チップ (1 件ずつ、重なり)・戻り矢印・質問 (動かせない)・展開・Forward to… (下書きだけ、送らない)
  const MAP_STATE = `JSON.stringify((() => {
    const chipsIn = (sel) => [...document.querySelectorAll(sel + ' .mapchip')].map((c) => ({
      label: (c.querySelector('.mapchiplabel') || {}).textContent || '',
      kind: c.classList.contains('event') ? 'event' : 'request',
      draggable: c.draggable,
      select: !!c.querySelector('select.mapfwd'),
      // 開いたチップには印がつき、中身は地図の下の欄 (.mappane、C95)
      open: c.classList.contains('open'),
      expanded: c.classList.contains('open') ? ((document.querySelector('#map .mappanebody') || {}).textContent || '') : '',
    }))
    return {
      on: !document.getElementById('map').hidden,
      listHidden: document.getElementById('list').hidden,
      pressed: document.getElementById('mapToggle').getAttribute('aria-pressed'),
      cols: [...document.querySelectorAll('.mapcol')].map((c) => ({ head: c.querySelector('.mapcolhead').textContent, nodes: [...c.querySelectorAll('.mapnode')].map((n) => n.dataset.name || 'human') })),
      deployer: chipsIn('.mapnode[data-name="map.deployer"]'),
      leader: chipsIn('.mapnode[data-name="map.leader"]'),
      human: chipsIn('.mapnode.human'),
      back: document.querySelectorAll('.mapsvg path.back').length,
    }
  })())`
  const mapState = async () => JSON.parse((await cdp('Runtime.evaluate', { expression: MAP_STATE, returnByValue: true })).result.value)
  const clickIn = (expr) => cdp('Runtime.evaluate', { expression: expr, returnByValue: true })
  const mapCwd = join(work, 'map')
  const mLead = await api('POST', '/mailboxes/map.leader/attach', { client: 'claude-code', role: 'leader', cwd: mapCwd, sessionId: 's-map-lead' })
  const mDep = await api('POST', '/mailboxes/map.deployer/attach', { client: 'claude-code', role: 'deployer', cwd: mapCwd, sessionId: 's-map-dep' })
  const mRev = await api('POST', '/mailboxes/map.reviewer/attach', { client: 'claude-code', role: 'reviewer', cwd: mapCwd, sessionId: 's-map-rev' })
  const asMLead = { 'x-hub-attachment': mLead.attachmentId }
  const asMDep = { 'x-hub-attachment': mDep.attachmentId }
  const asMRev = { 'x-hub-attachment': mRev.attachmentId }
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'map.deployer' }, body: 'GOAL: C1 を実装する', meta: { item: { id: 'C1', project: mapCwd, source: null, promise: null } } }, asMLead)
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'map.deployer' }, body: 'GOAL: 手直しを続ける' }, asMLead)
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'map.deployer' }, body: 'GOAL: もう 1 件' }, asMLead)
  await hook('map.reviewer', { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'tu-map', session_id: 's-map-rev' })
  await sleep(1500)

  await clickIn("document.getElementById('mapToggle').click()")
  await sleep(1500)
  let mv = await mapState()
  verify('地図の切り替え: ヘッダー右の Map で地図に変わり、スレッドは隠れる (C78)', mv.on && mv.listHidden && mv.pressed === 'true', mv)
  verify('地図の列は 人 → leader → ほかの役割 → 役割なし の順。leader は 2 列目、deployer・reviewer は 3 列目 (C78)', JSON.stringify(mv.cols.map((c) => c.head)) === JSON.stringify(['Human', 'leader', 'other roles', 'no role']) && mv.cols[1].nodes.includes('map.leader') && mv.cols[2].nodes.includes('map.deployer') && mv.cols[2].nodes.includes('map.reviewer'), mv.cols)
  verify('開いた request は受け手のノードに 1 件ずつ、同じ受け手の複数は重なって並ぶ (C78)', mv.deployer.length === 3 && mv.deployer.every((c) => c.kind === 'request'), { deployer: mv.deployer, DIAG: mv.DIAG })
  verify('項目のある request はその項目の名で出て、動かせて Forward to… がある (C78)', mv.deployer[0].label.startsWith('C1 ') && mv.deployer[0].draggable && mv.deployer[0].select, mv.deployer[0])
  verify('質問は人のノードにチップで出るが、動かせず Forward to… もない (C78)', mv.human.some((c) => c.kind === 'event' && !c.draggable && !c.select), mv.human)

  await clickIn("[...document.querySelectorAll('.mapnode[data-name=\"map.deployer\"] .mapchip')].find((c) => c.querySelector('.mapchiplabel').textContent.startsWith('C1 ')).click()")
  await sleep(800)
  mv = await mapState()
  verify('チップを押すと Message が thread と同じ行で展開する (C78)', mv.deployer[0].open && mv.deployer[0].expanded.includes('GOAL: C1 を実装する'), mv.deployer[0])

  const fwdBefore = (await api('GET', '/messages?after=0&limit=1000')).messages.at(-1).seq
  const fw = JSON.parse((await clickIn(`JSON.stringify((() => {
    const s = [...document.querySelectorAll('.mapnode[data-name="map.deployer"] select.mapfwd')][1]
    const offered = [...s.options].map((o) => o.value).filter((v) => v !== '')
    s.value = 'map.reviewer'
    s.dispatchEvent(new Event('change'))
    return { to: document.getElementById('to').value, body: document.getElementById('body').value, info: document.getElementById('replyInfo').textContent, offered }
  })())`)).result.value)
  await sleep(800)
  const fwdAfter = (await api('GET', '/messages?after=0&limit=1000')).messages.at(-1).seq
  verify('Forward to… は下書きを作るだけ: 宛先はその Mailbox、添え書きは空、Forwarding と出て、Hub には何も送らない (C78)', fw.to === 'mailbox:map.reviewer' && fw.body === '' && /^Forwarding #\d+ unchanged/.test(fw.info) && fwdAfter === fwdBefore, { fw, fwdBefore, fwdAfter })
  verify('Forward to… の候補は Mailbox の名前だけ (role・topic・人は出ない) (C78)', fw.offered.includes('map.leader') && fw.offered.every((v) => !v.includes(':')), fw.offered)

  await clickIn("document.getElementById('mapToggle').click()")
  await sleep(800)
  mv = await mapState()
  verify('もう一度押すと、スレッドに戻り地図は隠れる (C78)', !mv.on && !mv.listHidden && mv.pressed === 'false', mv)

  // 戻り矢印: deployer の request は、先に出した leader の依頼を閉じる (C28、相手からの後の Message)。だから地図を見る前に出す
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'map.leader' }, body: 'GOAL: 報告を求める' }, asMDep)
  await sleep(1000)
  await clickIn("document.getElementById('mapToggle').click()")
  await sleep(1500)
  mv = await mapState()
  verify('戻り矢印: 役割の並びに逆らう request (deployer → leader) は戻り矢印で描かれる (C78)', mv.back >= 1 && mv.leader.length === 1 && mv.leader[0].label.startsWith('#') && mv.leader[0].kind === 'request', { back: mv.back, leader: mv.leader })

  // 操作の途中の描き直しの延期 (C78): 開いた「Forward to…」とチップのドラッグの間は、SSE の更新で地図の DOM を作り直さず、
  // 終わったとき 1 回だけ、その時点のデータで描く。描き直しの回数は renderMap を包んで数える
  await clickIn('window.__renders = 0; if (!window.__wrapped) { const orig = renderMap; renderMap = function (m) { window.__renders++; return orig(m) }; window.__wrapped = true }')
  const reviewerChips = async () => (await clickIn(`document.querySelectorAll('.mapnode[data-name="map.reviewer"] .mapchip').length`)).result.value
  const parse = (r) => JSON.parse(r.result.value)
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'map.reviewer' }, body: 'GOAL: 延期 A' }, asMLead)
  await sleep(1500)
  const chipsBefore = await reviewerChips()
  // headless では窓が前にないと focus の出来事が届かない。前に出し、フォーカスの擬似を入れてから開いた選択を作る
  await cdp('Page.bringToFront')
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true })
  await clickIn(`(() => { window.__sel = document.querySelector('.mapnode[data-name="map.reviewer"] select.mapfwd'); window.__renders = 0; window.__sel.focus() })()`)
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'map.reviewer' }, body: 'GOAL: 延期 B' }, asMLead)
  await sleep(2000)
  const held = parse(await clickIn(`JSON.stringify({ renders: window.__renders, connected: window.__sel.isConnected, focused: document.activeElement === window.__sel, chips: document.querySelectorAll('.mapnode[data-name="map.reviewer"] .mapchip').length })`))
  verify('Forward to… が開いている間、SSE の更新で地図を描き直さない (開いた選択は残り、数は変わらない) (C78)', held.renders === 0 && held.connected && held.focused && held.chips === chipsBefore, { held, chipsBefore })
  // 閉じる (blur) の中で flushMap が延ばした描き直しを 1 回描く。描き直しと数えるのは flushMap が戻るまで (同期)。
  // そのあとに来る描き直し (SSE の遅れ・タイマー) は数えない (C101)。待たずに、同じ式の中で読む
  const released = parse(await clickIn(`(() => { window.__sel.blur(); return JSON.stringify({ renders: window.__renders, connected: window.__sel.isConnected, chips: document.querySelectorAll('.mapnode[data-name="map.reviewer"] .mapchip').length }) })()`))
  verify('Forward to… を閉じると、延ばした分を今のデータで 1 回だけ描く (C78)', released.renders === 1 && !released.connected && released.chips === chipsBefore + 1, { released, chipsBefore })

  // チップのドラッグ: 途中は描き直さず、dragend (取り消し) で 1 回
  const chipsDrag = await reviewerChips()
  await clickIn(`(() => { window.__chip = document.querySelector('.mapnode[data-name="map.reviewer"] .mapchip'); window.__renders = 0; window.__chip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })) })()`)
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'map.reviewer' }, body: 'GOAL: ドラッグ中 C' }, asMLead)
  await sleep(2000)
  const dragging = parse(await clickIn(`JSON.stringify({ renders: window.__renders, connected: window.__chip.isConnected, chips: document.querySelectorAll('.mapnode[data-name="map.reviewer"] .mapchip').length })`))
  verify('チップのドラッグの途中は、SSE の更新で地図を描き直さず、ドラッグを途切れさせない (C78)', dragging.renders === 0 && dragging.connected && dragging.chips === chipsDrag, { dragging, chipsDrag })
  // dragend の中で flushMap が 1 回描く (同期)。待たずに、同じ式の中で読む (C112、C101 と同じ)
  const ended = parse(await clickIn(`(() => { window.__chip.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: new DataTransfer() })); return JSON.stringify({ renders: window.__renders, connected: window.__chip.isConnected, chips: document.querySelectorAll('.mapnode[data-name="map.reviewer"] .mapchip').length }) })()`))
  verify('ドラッグを取り消す (dragend) と、延ばした分を 1 回だけ描く (C78)', ended.renders === 1 && !ended.connected && ended.chips === chipsDrag + 1, { ended, chipsDrag })

  // ドロップ: 落とすと下書きを作り、そこで 1 回描く。ドロップのあとに届いた分も、その 1 回に含まれる
  const chipsDrop = await reviewerChips()
  await clickIn(`(() => { window.__chip = document.querySelector('.mapnode[data-name="map.reviewer"] .mapchip'); window.__renders = 0; window.__chip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })) })()`)
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'map.reviewer' }, body: 'GOAL: ドロップ中 D' }, asMLead)
  await sleep(1500)
  const dropped = parse(await clickIn(`(() => { const dt = new DataTransfer(); const n = document.querySelector('.mapnode[data-name="map.leader"]'); n.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); n.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); return JSON.stringify({ renders: window.__renders, to: document.getElementById('to').value, info: document.getElementById('replyInfo').textContent, chips: document.querySelectorAll('.mapnode[data-name="map.reviewer"] .mapchip').length, connected: window.__chip.isConnected }) })()`))
  verify('チップを落とすと Forward の下書きができ、途中の描き直しは 1 回にまとまる (送らない) (C78)', dropped.renders === 1 && dropped.to === 'mailbox:map.leader' && /^Forwarding #\d+ unchanged/.test(dropped.info) && dropped.chips === chipsDrop + 1 && !dropped.connected, { dropped, chipsDrop })
  // 人宛ての辺 (C92): 人宛ての request と質問は戻り矢印の点線で描かない。戻り矢印は役割の並びに逆らう deployer → leader の 1 本だけ。
  // 送り手は reviewer: deployer が人に返すと、leader から deployer への依頼が閉じて後の場面の chip が消えるため (C28)
  await api('POST', '/messages', { kind: 'request', to: { type: 'user', id: 'browser' }, body: 'GOAL: 人に報告する' }, asMRev)
  await sleep(1500)
  const arrows = parse(await clickIn(`JSON.stringify({
    backs: document.querySelectorAll('.mapsvg path.back').length,
    evtBack: document.querySelectorAll('.mapsvg path.evt.back').length,
    evt: document.querySelectorAll('.mapsvg path.evt').length,
    humanReq: document.querySelectorAll('.mapnode.human .mapchip.request').length,
  })`))
  verify('人宛ての request と質問の辺は戻り矢印の点線で描かれない。戻り矢印は deployer → leader の 1 本だけ (C92)', arrows.backs === 1 && arrows.evtBack === 0 && arrows.evt >= 1 && arrows.humanReq >= 1, arrows)

  // Forward to… の場面には、deployer が返していない依頼が要る (deployer が leader に返すと、leader からの依頼は閉じる。C28)
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'map.deployer' }, body: 'GOAL: 新しい依頼 (C92)' }, asMLead)
  await sleep(1500)

  // Forward to… (C92): 候補は宛先の一覧 (#to) にある Mailbox だけ。ほかのプロジェクトの Mailbox は出ず、出るものを選べば下書きになる
  const prevProject = await evaluate('FILTER.project')
  await evaluate("chooseProject(projectKey(mailboxList.find((m) => m.name === 'map.leader').project))")
  await sleep(1000)
  const menu = parse(await clickIn(`JSON.stringify((() => {
    const s = document.querySelector('.mapnode[data-name="map.deployer"] select.mapfwd')
    return { offered: [...s.options].map((o) => o.value).filter((v) => v !== ''), to: [...document.getElementById('to').options].map((o) => o.value), other: mailboxList.some((m) => m.name === 'oth.leader') }
  })())`))
  const pickFirst = menu.offered[0]
  const picked = parse(await clickIn(`(() => {
    const s = document.querySelector('.mapnode[data-name="map.deployer"] select.mapfwd')
    s.value = ${JSON.stringify(pickFirst)}
    s.dispatchEvent(new Event('change'))
    return JSON.stringify({ to: document.getElementById('to').value })
  })()`))
  verify('Forward to… は宛先の一覧にある Mailbox だけを出す。ほかのプロジェクトの Mailbox (oth.leader) は出ず、出るものを選べば下書きになる (C92)', menu.other && menu.offered.includes('map.leader') && !menu.offered.includes('oth.leader') && menu.offered.every((v) => menu.to.includes(`mailbox:${v}`)) && picked.to === `mailbox:${pickFirst}`, { menu, pickFirst, picked })
  await evaluate(`chooseProject(${JSON.stringify(prevProject)})`)
  await sleep(1000)

  // 取り直し (C92): 手元にない開いた request の取り直しが通信で失敗しても「消えた」とは言わず、地図を開き直すと取り直す。Hub が一覧に出さないときだけ「消えた」
  const lostSeq = (await api('GET', '/messages?after=0&limit=1000')).messages.find((m) => m.body === 'GOAL: 新しい依頼 (C92)').seq
  await clickIn(`(() => {
    window.__mapFetch = { mode: 'fail', calls: 0, match: '/messages?after=${lostSeq - 1}&limit=1' }
    if (!window.__mapFetchWrapped) {
      const real = window.fetch
      window.fetch = (u, i) => {
        if (String(u) === window.__mapFetch.match) {
          window.__mapFetch.calls++
          if (window.__mapFetch.mode === 'fail') return Promise.reject(new TypeError('Failed to fetch'))
          if (window.__mapFetch.mode === 'gone') return Promise.resolve(new Response(JSON.stringify({ messages: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
        }
        return real(u, i)
      }
      window.__mapFetchWrapped = true
    }
  })()`)
  // 手元の Message を外して、取り直しの場面にする
  const dropLost = () => clickIn(`(() => { for (const [id, m] of seen) if (m.seq === ${lostSeq}) seen.delete(id); mapMsgCache.delete(${lostSeq}); requestMapRender() })()`)
  const lostChip = async () =>
    parse(await clickIn(`JSON.stringify((() => {
      const c = [...document.querySelectorAll('.mapnode[data-name="map.deployer"] .mapchip')].find((x) => (x.querySelector('.mapchiplabel') || {}).textContent === '#${lostSeq}')
      return c ? { note: (c.querySelector('.mapchipnote') || {}).textContent || '', calls: window.__mapFetch.calls } : null
    })())`))
  await dropLost()
  await sleep(1500)
  const failed1 = await lostChip()
  await clickIn('requestMapRender()')
  await sleep(1000)
  const failed2 = await lostChip()
  verify('取り直しが通信で失敗したら「not on the Hub」でなく could not load と出し、描き直しても取り直しを繰り返さない (C92)', failed1 && failed1.note === 'could not load' && failed2 && failed2.note === 'could not load' && failed2.calls === 1, { failed1, failed2 })
  await clickIn('window.__mapFetch.mode = "ok"')
  await clickIn("document.getElementById('mapToggle').click()")
  await sleep(800)
  await clickIn("document.getElementById('mapToggle').click()")
  await sleep(1500)
  const reopened = await lostChip()
  verify('地図を開き直すと取り直す。取れたら注記は消え、chip の Message が手元に入る (C92)', reopened && reopened.note === '' && reopened.calls === 2, reopened)
  await clickIn('window.__mapFetch.mode = "gone"')
  await dropLost()
  await sleep(1500)
  const gone = await lostChip()
  verify('Hub の一覧に無い (消えた) ときだけ「not on the Hub」と出す (C92)', gone && gone.note === 'not on the Hub', gone)
  await clickIn('window.__mapFetch.mode = "ok"')

  // 矢印キー (C92): 「Forward to…」を矢印で動かしても下書きにせず、Enter で選んだ 1 件だけ下書きにする (前の場面で消えた chip の代わりに、新しい依頼で選ぶ)
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'map.deployer' }, body: 'GOAL: 矢印で選ぶ (C92)' }, asMLead)
  await sleep(1500)
  const nav = parse(await clickIn(`(() => {
    const s = document.querySelector('.mapnode[data-name="map.deployer"] select.mapfwd')
    const toBefore = document.getElementById('to').value, infoBefore = document.getElementById('replyInfo').textContent
    s.focus()
    const key = (type, k) => s.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true }))
    const moved = []
    // 閉じた選択で矢印キーを押すと、ブラウザは値を動かして change を出す。それをそのまま再現する
    for (const i of [1, 2]) {
      key('keydown', 'ArrowDown')
      s.selectedIndex = i
      s.dispatchEvent(new Event('change', { bubbles: true }))
      key('keyup', 'ArrowDown')
      moved.push(s.value)
    }
    return JSON.stringify({ toBefore, infoBefore, moved, to: document.getElementById('to').value, info: document.getElementById('replyInfo').textContent })
  })()`))
  const entered = parse(await clickIn(`(() => {
    const s = document.querySelector('.mapnode[data-name="map.deployer"] select.mapfwd')
    s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    s.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    return JSON.stringify({ to: document.getElementById('to').value, info: document.getElementById('replyInfo').textContent })
  })()`))
  await clickIn("document.querySelector('.mapnode[data-name=\"map.deployer\"] select.mapfwd').blur()")
  await sleep(800)
  verify('Forward to… を矢印キーで動かしても下書きは変わらず、Enter で選んだ 1 件だけ下書きになる (C92)', nav.to === nav.toBefore && nav.info === nav.infoBefore && entered.to === `mailbox:${nav.moved[1]}` && /^Forwarding #\d+ unchanged/.test(entered.info), { nav, entered })

  // 開いたチップの中身は地図の下の欄に出る (C95)。チップは広がらず、地図の幅と節の位置は変わらない
  const chipOf = (seq) => `[...document.querySelectorAll('#map .mapchip')].find((x) => (x.querySelector('.mapchiplabel') || {}).textContent === '#${seq}')`
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'map.deployer' }, body: `GOAL: 長い行 (C95)\n${'あ'.repeat(200)}${'x'.repeat(400)}` }, asMLead)
  await sleep(1500)
  const longSeq = (await api('GET', '/messages?after=0&limit=1000')).messages.find((m) => m.body.startsWith('GOAL: 長い行 (C95)')).seq
  const geom = async () =>
    parse(await clickIn(`JSON.stringify({
      canvas: [...document.querySelectorAll('#map .mapcanvas')].map((c) => Math.round(c.getBoundingClientRect().width)),
      nodes: [...document.querySelectorAll('#map .mapnode')].map((n) => { const r = n.getBoundingClientRect(); return [n.dataset.name || 'human', Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }),
    })`))
  const paneState = async () =>
    parse(await clickIn(`JSON.stringify((() => {
      const p = document.querySelector('#map .mappane')
      if (!p) return { count: document.querySelectorAll('#map .mappane').length, open: document.querySelectorAll('#map .mapchip.open').length }
      const b = p.querySelector('.mappanebody')
      return {
        count: document.querySelectorAll('#map .mappane').length,
        open: document.querySelectorAll('#map .mapchip.open').length,
        head: p.querySelector('.mappanehead').textContent,
        body: b ? b.textContent : null,
        paneW: Math.round(p.getBoundingClientRect().width),
        rootW: Math.round(document.getElementById('map').getBoundingClientRect().width),
        maxH: b ? getComputedStyle(b).maxHeight : '',
        scrolls: b ? b.scrollHeight > b.clientHeight : null,
      }
    })())`))

  const g0 = await geom()
  await clickIn(`${chipOf(longSeq)}.click()`)
  await sleep(800)
  const g1 = await geom()
  const p1 = await paneState()
  verify(
    '開いたチップの中身は地図の下の欄に出る。長い行でも地図の幅と節の位置は変わらない (C95)',
    JSON.stringify(g0.canvas) === JSON.stringify(g1.canvas) && JSON.stringify(g0.nodes) === JSON.stringify(g1.nodes) &&
      p1.count === 1 && p1.open === 1 && p1.head.includes(`#${longSeq}`) && p1.body.includes('長い行') && p1.paneW <= p1.rootW + 1 && p1.maxH !== 'none' && p1.scrolls === true,
    { g0, g1, p1 },
  )
  verify('欄には seq・項目・送り手・受け手の名が出る。項目のない request は項目を「—」で示す (C95)', p1.head.includes('seq #') && p1.head.includes('item —') && p1.head.includes('from map.leader') && p1.head.includes('to map.deployer'), p1.head)

  // 一度に 1 件: 別のチップを開くと欄は入れ替わり、印も移る
  const other = parse(await clickIn(`JSON.stringify((() => {
    const c = [...document.querySelectorAll('#map .mapnode[data-name="map.deployer"] .mapchip.request')].find((x) => !x.classList.contains('open') && (x.querySelector('.mapchiplabel') || {}).textContent !== '#${longSeq}')
    if (!c) return null
    const label = c.querySelector('.mapchiplabel').textContent
    c.click()
    return label
  })())`))
  await sleep(800)
  const p2 = await paneState()
  verify('一度に 1 件: 別のチップを開くと欄はそれに替わり、印は 1 つだけ移る (C95)', other !== null && p2.count === 1 && p2.open === 1 && !p2.head.includes(`#${longSeq}`) && p2.head.includes(other.replace(/^.*#/, '#')), { other, p2 })

  // 同じチップをもう一度押すと欄は空になる。× でも空になる
  await clickIn(`[...document.querySelectorAll('#map .mapnode[data-name="map.deployer"] .mapchip')].find((x) => x.classList.contains('open')).click()`)
  await sleep(800)
  const p3 = await paneState()
  await clickIn(`${chipOf(longSeq)}.click()`)
  await sleep(800)
  await clickIn(`document.querySelector('#map .mappane .linkbtn').click()`)
  await sleep(800)
  const p4 = await paneState()
  verify('同じチップをもう一度押すと欄が空になり、× でも空になる。印も外れる (C95)', p3.count === 0 && p3.open === 0 && p4.count === 0 && p4.open === 0, { p3, p4 })

  // 再描画で欄は残る (新しいデータ・C78 の延ばした描き直し)。選択を開いている間の更新は、閉じてから 1 回描き直す
  await clickIn(`${chipOf(longSeq)}.click()`)
  await sleep(800)
  const before = await paneState()
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'map.deployer' }, body: 'GOAL: 再描き (C95)' }, asMLead)
  await sleep(1500)
  const redrawn = await paneState()
  await clickIn(`(() => { window.__c95 = ${chipOf(longSeq)}; window.__c95.querySelector('select').focus() })()`)
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'map.deployer' }, body: 'GOAL: 選択中の更新 (C95)' }, asMLead)
  await sleep(1500)
  const heldPane = await paneState()
  await clickIn('window.__c95.querySelector("select").blur()')
  await sleep(800)
  const afterBlur = await paneState()
  verify(
    '再描画 (新しいデータと、開いた選択を閉じたあとの 1 回の描き直し) でも欄と印は残る (C95)',
    before.count === 1 && redrawn.count === 1 && redrawn.open === 1 && redrawn.head.includes(`#${longSeq}`) && redrawn.body.includes('長い行') && heldPane.count === 1 && afterBlur.count === 1 && afterBlur.open === 1 && afterBlur.head.includes(`#${longSeq}`),
    { before, redrawn, heldPane, afterBlur },
  )

  // 欄の中身の位置 (C98): 同じチップが開いたままなら、新しいデータと延ばした描き直しの前後で位置を保つ。別のチップを開くと上から
  const bodyTop = async () => parse(await clickIn(`JSON.stringify((() => { const p = document.querySelector('#map .mappane'); const b = p && p.querySelector('.mappanebody'); return b ? { top: b.scrollTop, max: b.scrollHeight - b.clientHeight, key: p.dataset.key } : null })())`))
  await clickIn(`(() => { document.querySelector('#map .mappane .mappanebody').scrollTop = 30 })()`)
  const k0 = await bodyTop()
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'map.deployer' }, body: 'GOAL: 位置 新しいデータ (C98)' }, asMLead)
  await sleep(1500)
  const k1 = await bodyTop()
  await clickIn(`document.querySelector('#map .mapnode[data-name="map.deployer"] select.mapfwd').focus()`)
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'map.deployer' }, body: 'GOAL: 位置 延ばした描き直し (C98)' }, asMLead)
  await sleep(1500)
  await clickIn(`document.querySelector('#map .mapnode[data-name="map.deployer"] select.mapfwd').blur()`)
  await sleep(800)
  const k2 = await bodyTop()
  verify('開いたままのチップの欄は、新しいデータと延ばした描き直しの後も同じ位置で残る (C98)', k0.top > 0 && k1.top === k0.top && k2.top === k0.top && k1.key === k0.key && k2.key === k0.key && k2.max > 0, { k0, k1, k2 })

  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'map.deployer' }, body: `GOAL: 長い行 B (C98)\n${'い'.repeat(200)}${'y'.repeat(400)}` }, asMLead)
  await sleep(1500)
  const bSeq = (await api('GET', '/messages?after=0&limit=1000')).messages.find((m) => m.body.startsWith('GOAL: 長い行 B (C98)')).seq
  await clickIn(`${chipOf(bSeq)}.click()`)
  await sleep(800)
  await clickIn(`(() => { document.querySelector('#map .mappane .mappanebody').scrollTop = 30 })()`)
  const b0 = await bodyTop()
  await clickIn(`${chipOf(longSeq)}.click()`)
  await sleep(800)
  const a1 = await bodyTop()
  verify('別のチップを開くと欄は上から始まる。前に開いた欄の位置は持ち越さない (C98)', b0.top > 0 && a1.top === 0 && a1.max > 0 && a1.key !== b0.key, { b0, a1 })

  // 辺が閉じたら、欄がそう言う (消えて黙ることはしない)。送り手は deployer: 返信で leader からの依頼が閉じる (C28)
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'map.leader' }, body: 'GOAL: 閉じさせる (C95)' }, asMDep)
  await sleep(1500)
  const closed = await paneState()
  const closedNote = (await clickIn(`(document.querySelector('#map .mappanenote') || {}).textContent || ''`)).result.value
  verify('依頼が閉じて地図から出たら、欄はそう言う。chip は消え (印もない)、欄は残る (C95)', closed.count === 1 && closed.open === 0 && closed.head.includes(`#${longSeq}`) && closedNote.startsWith('Closed:'), { closed, closedNote })
  await clickIn(`document.querySelector('#map .mappane .linkbtn').click()`)
  await sleep(800)

  // Hub にない・取れなかった Message の注記も欄に出る (C92 の文言のまま)。同じ呼び方で、消えた依頼を開く
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'map.deployer' }, body: 'GOAL: 消えた依頼 (C95)' }, asMLead)
  await sleep(1500)
  const goneSeq = (await api('GET', '/messages?after=0&limit=1000')).messages.find((m) => m.body.startsWith('GOAL: 消えた依頼 (C95)')).seq
  await clickIn(`window.__mapFetch.match = '/messages?after=${goneSeq - 1}&limit=1'; window.__mapFetch.mode = 'gone'; for (const [id, m] of seen) if (m.seq === ${goneSeq}) seen.delete(id); mapMsgCache.delete(${goneSeq}); ${chipOf(goneSeq)}.click()`)
  await sleep(1500)
  const gonePane = await paneState()
  await clickIn('window.__mapFetch.mode = "ok"')
  verify('Hub にもうない Message は、欄に「no longer on the Hub」と出る (C92 の注記と同じ文言) (C95)', gonePane.count === 1 && gonePane.body.includes('This Message is no longer on the Hub.'), gonePane)

  // 配色 (C93): 選んだ配色と OS の設定の組を確かめる。OS の設定は Emulation で変え、選んだ配色は localStorage に覚える
  const setOs = (dark) => cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] })
  const goPage = async () => {
    await cdp('Page.navigate', { url: `${HUB}/?token=${TOKEN}` })
    await sleep(1500)
  }
  const themeOf = async () =>
    JSON.parse(
      await evaluate(`JSON.stringify({
        theme: document.documentElement.dataset.theme,
        label: (document.querySelector('#settings [data-choice][aria-pressed="true"]') || {}).textContent || '',
        open: $('settingsToggle').getAttribute('aria-expanded'),
        bg: getComputedStyle(document.body).backgroundColor,
        you: getComputedStyle(document.documentElement).getPropertyValue('--st-you').trim(),
        stored: (() => { try { return localStorage.getItem('agent-hub.theme') } catch (e) { return 'ERR' } })(),
      })`),
    )
  // 設定パネルで配色を選ぶ (C94)。パネルが閉じていれば歯車で開く
  const pressTheme = async (choice) => {
    await evaluate(`(() => { if ($('settings').hidden) $('settingsToggle').click(); document.querySelector('#settings [data-choice="${choice}"]').click() })()`)
    await sleep(300)
    return themeOf()
  }
  const waitTheme = async (want) => {
    for (let i = 0; i < 30; i++) {
      if ((await themeOf()).theme === want) return true
      await sleep(100)
    }
    return false
  }
  const DARK_BG = 'rgb(22, 22, 21)'
  const LIGHT_BG = 'rgb(247, 247, 245)'
  // タブの件数バッジの左の内側の画素 (--st-you の色)。絵が描き直されるまで待つ
  const badgePixel = () =>
    evaluate(`(async () => {
      const im = new Image()
      await new Promise((resolve, reject) => { im.onload = resolve; im.onerror = reject; im.src = document.querySelector('link[rel~=icon]').href })
      const c = document.createElement('canvas')
      c.width = c.height = 32
      const g = c.getContext('2d')
      g.drawImage(im, 0, 0)
      return [...g.getImageData(6, 16, 1, 1).data.slice(0, 3)].join(',')
    })()`)
  const badgeIs = async (rgb) => {
    for (let i = 0; i < 30; i++) {
      try {
        if ((await badgePixel()) === rgb) return true
      } catch {}
      await sleep(100)
    }
    return false
  }
  const LIGHT_YOU = '154,91,0' // --st-you の昼 (#9a5b00)
  const DARK_YOU = '240,176,80' // --st-you の夜 (#f0b050)

  await evaluate("try { localStorage.removeItem('agent-hub.theme') } catch (e) {}")
  await setOs(true)
  await goPage()
  const t0 = await themeOf()
  const seq = [await pressTheme('light'), await pressTheme('dark'), await pressTheme('follow')]
  const labels = [t0, ...seq].map((t) => t.label)
  verify(
    '配色 (設定パネル): 初めは Follow the OS (OS が夜なら夜の色)。Light、Dark、Follow the OS と選ぶと、そのたびに今の選びが変わる (C93, C94)',
    JSON.stringify(labels) === JSON.stringify(['Follow the OS', 'Light', 'Dark', 'Follow the OS']) && t0.theme === 'dark' && t0.bg === DARK_BG && t0.open === 'false',
    { labels, open: t0.open },
  )
  verify(
    '配色: 夜の OS で昼を選ぶと昼の色 (背景と --st-you とも。夜の定義は使わない) (C93)',
    seq[0].theme === 'light' && seq[0].bg === LIGHT_BG && seq[0].you === '#9a5b00',
    seq[0],
  )

  // 選んだ配色は読み直しても残る。昼の OS で夜を選んでも夜の色 (昼と夜の両方の定義が要る)
  await pressTheme('light')
  await goPage()
  const reLight = await themeOf()
  verify('配色: light を選んだまま読み直すと、ボタンも配色も light のまま (localStorage に残る) (C93)', reLight.label === 'Light' && reLight.theme === 'light' && reLight.stored === 'light', reLight)
  await pressTheme('dark')
  await setOs(false)
  await goPage()
  const dark = await themeOf()
  verify(
    '配色: 昼の OS で夜を選ぶと夜の色 (背景と --st-you とも)。読み直しても残る (C93)',
    dark.label === 'Dark' && dark.theme === 'dark' && dark.bg === DARK_BG && dark.you === '#f0b050' && dark.stored === 'dark',
    dark,
  )

  // follow は OS の変更に、開いたまま従う
  await pressTheme('follow') // dark → follow (OS は昼なので昼の色)
  const followLight = await themeOf()
  await setOs(true)
  const liveDark = await waitTheme('dark')
  await setOs(false)
  const liveLight = await waitTheme('light')
  verify(
    '配色: follow は、開いたままの OS の変更に従う (昼 → 夜 → 昼) (C93)',
    followLight.label === 'Follow the OS' && followLight.theme === 'light' && liveDark && liveLight,
    { followLight, liveDark, liveLight },
  )

  // タブの絵は配色に従う (C70)。件数バッジ (人の番を 1 件) の色を画素で読む。OS は夜にして、follow と light を比べる
  await setOs(true)
  await evaluate('tabWaiting = 1; tabStopped = 0; tabUnread = 0; tabWorking = false; showTabUnread()')
  const iconFollow = await badgeIs(DARK_YOU)
  await pressTheme('light') // follow → light (OS は夜)
  const iconLight = await badgeIs(LIGHT_YOU)
  await pressTheme('dark') // light → dark
  const iconDark = await badgeIs(DARK_YOU)
  verify('タブの絵: 件数バッジの色は配色に従う (follow は OS の夜の色、light は昼の色で夜の OS でも、dark は夜の色) (C70, C93)', iconFollow && iconLight && iconDark, { iconFollow, iconLight, iconDark })

  // localStorage が使えないとき: 読み書きは try で囲まれ、OS の設定に従い、押しても壊れない
  const blocked = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked') } })" })
  await setOs(true)
  await goPage()
  const noStore = await themeOf()
  const noStorePressed = await pressTheme('light')
  const cards = await evaluate("document.querySelectorAll('#mailboxes .mb').length")
  await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: blocked.identifier })
  verify(
    '配色: localStorage が使えないときは OS の設定に従い、押しても描画が壊れない (C93)',
    noStore.stored === 'ERR' && noStore.theme === 'dark' && noStore.label === 'Follow the OS' && noStorePressed.theme === 'light' && noStorePressed.label === 'Light' && cards > 0,
    { noStore, noStorePressed, cards },
  )

  // ヘッダー (C94): 右は Health check・Map / Messages・歯車の 3 つだけで、Theme ボタンはない。ラベルが変わっても位置は動かない
  await goPage()
  const header = async () => JSON.parse(await evaluate(`JSON.stringify({
    ids: [...document.querySelectorAll('header > button')].map((b) => b.id),
    themeGone: document.getElementById('themeToggle') === null,
    labels: ['health', 'mapToggle', 'settingsToggle', 'conn'].map((id) => document.getElementById(id).textContent),
    boxes: ['health', 'mapToggle', 'settingsToggle'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return [r.left, r.right] }),
  })`))
  const headerBefore = await header()
  // 読むのは書いた直後 (描き直しで Health check の数が戻る前に)
  await evaluate("$('health').textContent = 'Health check (123)'; $('conn').textContent = 'Reconnecting… (a longer connection message)'")
  const headerAfter = await header()
  await evaluate("$('mapToggle').click()")
  const headerMap = await header()
  await evaluate("$('mapToggle').click()")
  const sameAs = (a) => headerBefore.boxes.every((b, i) => Math.abs(b[0] - a.boxes[i][0]) < 0.5 && Math.abs(b[1] - a.boxes[i][1]) < 0.5)
  const sameBoxes = sameAs(headerAfter) && sameAs(headerMap)
  verify(
    'ヘッダーの右は Health check・Map / Messages・歯車の 3 つだけで、Theme ボタンはない (C94)',
    JSON.stringify(headerBefore.ids) === JSON.stringify(['health', 'mapToggle', 'settingsToggle']) && headerBefore.themeGone,
    headerBefore,
  )
  verify(
    'ラベルが変わっても (Health check の数、Map ↔ Messages、接続の表示) ヘッダーの右の 3 つは同じ位置に留まる (C94)',
    sameBoxes && headerAfter.labels[0] === 'Health check (123)' && headerMap.labels[1] === 'Messages' && headerAfter.labels[3].startsWith('Reconnecting'),
    { before: headerBefore.boxes, after: headerAfter.boxes, map: headerMap.boxes, labels: headerAfter.labels },
  )

  // 設定パネル (C94): 歯車で開く。もう一度押す・Escape・外を押すと閉じる (Escape のあとは歯車へ戻る)。パネルの中で選んでも閉じない
  await goPage()
  const panel = async () => JSON.parse(await evaluate(`JSON.stringify({ expanded: $('settingsToggle').getAttribute('aria-expanded'), hidden: $('settings').hidden, focus: document.activeElement && document.activeElement.id })`))
  const pn0 = await panel()
  await evaluate("$('settingsToggle').click()")
  await sleep(100)
  const pn1 = await panel()
  // 開いたパネルが画面の中にあり、欄の下 (ヘッダーの下) に見えている。中心の点は、パネルかその中の物が取る (C94 の確認)
  const pn1box = JSON.parse(await evaluate(`JSON.stringify((() => {
    const s = $('settings')
    const r = s.getBoundingClientRect()
    const headerBottom = document.querySelector('header').getBoundingClientRect().bottom
    const mid = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, headerBottom, vh: innerHeight, vw: innerWidth, hit: !!mid && (mid === s || s.contains(mid)) }
  })())`))
  verify(
    '設定パネル: 開くと、ヘッダーの下・画面の中に見えている (切れていない。中心の点はパネルが取る) (C94)',
    pn1box.top >= pn1box.headerBottom && pn1box.bottom <= pn1box.vh && pn1box.left >= 0 && pn1box.right <= pn1box.vw && pn1box.hit,
    pn1box,
  )
  await evaluate("$('settingsToggle').click()")
  await sleep(100)
  const pn2 = await panel()
  await evaluate("$('settingsToggle').click()")
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
  await sleep(100)
  const pn3 = await panel()
  await evaluate("$('settingsToggle').click()")
  await evaluate("document.querySelector('header h1').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))")
  await sleep(100)
  const pn4 = await panel()
  await evaluate("$('settingsToggle').click(); document.querySelector('#settings [data-choice=\"light\"]').click()")
  await sleep(200)
  const pn5 = await panel()
  const choiceSaved = await evaluate("localStorage.getItem('agent-hub.theme')").catch(() => null)
  await evaluate("$('settingsToggle').click()")
  verify(
    '設定パネル: 歯車で開き、もう一度押すと閉じる。開いた印 (aria-expanded) を持つ。閉じている間は隠れている (C94)',
    pn0.expanded === 'false' && pn0.hidden === true && pn1.expanded === 'true' && pn1.hidden === false && pn2.expanded === 'false' && pn2.hidden === true,
    { pn0, pn1, pn2 },
  )
  verify(
    '設定パネル: Escape で閉じて、フォーカスは歯車に戻る。外を押しても閉じる。中で配色を選んでも閉じず、選んだ配色は残る (C94)',
    pn3.expanded === 'false' && pn3.hidden === true && pn3.focus === 'settingsToggle' && pn4.expanded === 'false' && pn4.hidden === true && pn5.expanded === 'true' && pn5.hidden === false && choiceSaved === 'light',
    { pn3, pn4, pn5, choiceSaved },
  )

  // 役割宛ての送信の確認 (C104): 役割の受け手が 2 つ以上のプロジェクトにいるなら、送る前に尋ねる。取り消すと何も送らず本文・宛先を残す。
  // 1 つのプロジェクトだけなら尋ねずに送る。window.confirm は置き換えて、聞かれた文と答えを記録する (ダイアログは開かない)
  const pb = join(work, 'pb')
  await api('POST', '/mailboxes/pb.deployer/attach', { client: 'claude-code', role: 'deployer', cwd: pb, sessionId: 's-pb-dep' })
  // reviewer の受け手を demo のものだけにする: demo 以外の reviewer を切ってから消す (1 プロジェクトの場面。ほかの場面は済んでいる)
  for (const m of (await api('GET', '/mailboxes')).mailboxes) {
    if (m.role !== 'reviewer' || !m.project || m.project === join(work, 'demo')) continue
    if (m.attachment) await api('DELETE', `/attachments/${m.attachment.attachmentId}`)
    await api('DELETE', `/mailboxes/${m.name}`)
  }
  await goPage()
  const stubConfirm = (answer) =>
    evaluate(`(() => { window.__asked = []; window.__answer = ${answer}; window.confirm = (m) => { window.__asked.push(m); return window.__answer }; return true })()`)
  const compose = (to, body) => evaluate(`(() => { chooseTo(${JSON.stringify(to)}); $('body').value = ${JSON.stringify(body)}; return $('to').value })()`)
  const submit = () => evaluate("(async () => { $('form').requestSubmit(); await new Promise((r) => setTimeout(r, 800)); return true })()")
  const countMessages = async () => (await api('GET', '/messages?after=0&limit=1000')).messages.length
  const lastMessage = async () => (await api('GET', '/messages?after=0&limit=1000')).messages.at(-1)
  const receivers = (await api('GET', '/mailboxes')).mailboxes.filter((m) => m.role === 'deployer' && m.project)
  // 数えるのと同じ比べ方 (区切り・末尾の区切り・ドライブ文字の大文字小文字) で、プロジェクトの数を数える
  const projectCount = (list) => new Set(list.map((m) => m.project.replace(/[\\/]+/g, '/').replace(/(.)\/$/, '$1').replace(/^[a-z]:/i, (d) => d.toLowerCase()))).size
  const fromJson = (text) => JSON.parse(text)

  await stubConfirm(false)
  const beforeCancel = await countMessages()
  await compose('role:deployer', 'C104 check: cancel')
  await submit()
  const cancelled = fromJson(await evaluate("JSON.stringify({ asked: window.__asked, body: $('body').value, to: $('to').value })"))
  const afterCancel = await countMessages()
  verify(
    '役割宛てが 2 つ以上のプロジェクトに届くとき、送る前に Mailbox とプロジェクトの数を尋ね、取り消すと何も送らず本文と宛先を残す (C104)',
    projectCount(receivers) >= 2 &&
      cancelled.asked.length === 1 &&
      cancelled.asked[0].includes(`${receivers.length} Mailboxes in ${projectCount(receivers)} projects`) &&
      afterCancel === beforeCancel &&
      cancelled.body === 'C104 check: cancel' &&
      cancelled.to === 'role:deployer',
    { asked: cancelled.asked, beforeCancel, afterCancel, body: cancelled.body, to: cancelled.to, receivers: receivers.length },
  )

  await stubConfirm(true)
  const beforeSend = await countMessages()
  await submit()
  const confirmed = fromJson(await evaluate("JSON.stringify({ asked: window.__asked, body: $('body').value })"))
  const afterSend = await countMessages()
  const sent = await lastMessage()
  verify(
    '同じ宛先で確認に「送る」と送られる。プロジェクトを絞らない役割宛てのまま届き、本文は空になる (C104)',
    confirmed.asked.length === 1 && afterSend === beforeSend + 1 && sent.body === 'C104 check: cancel' && sent.to.type === 'role' && sent.to.id === 'deployer' && sent.to.project === undefined && confirmed.body === '',
    { asked: confirmed.asked.length, beforeSend, afterSend, to: sent.to, body: confirmed.body },
  )

  await stubConfirm(false)
  const beforeSolo = await countMessages()
  // reviewer の受け手は demo の 1 つだけ (上で oth.reviewer を消した)。すべてのプロジェクトで、尋ねずに送る
  const reviewers = (await api('GET', '/mailboxes')).mailboxes.filter((m) => m.role === 'reviewer' && m.project)
  await compose('role:reviewer', 'C104 check: one project')
  await submit()
  const solo = fromJson(await evaluate("JSON.stringify({ asked: window.__asked })"))
  const afterSolo = await countMessages()
  const soloSent = await lastMessage()
  verify(
    '1 つのプロジェクトだけに届く役割宛てでは尋ねずに送る (C104)',
    projectCount(reviewers) === 1 && solo.asked.length === 0 && afterSolo === beforeSolo + 1 && soloSent.body === 'C104 check: one project' && soloSent.to.id === 'reviewer',
    { asked: solo.asked.length, projects: projectCount(reviewers), beforeSolo, afterSolo, to: soloSent.to },
  )

  {
  // C106: バッジ・状態の数・地図の Needs you を押すと飛ぶ。飛び先は数えたものの最も古いもの (押した印の数え方と同じ)。
  // 押しても送らず、既読にせず、状態も変えない。jo の質問を先に出し、jb の質問はそのあと (全プロジェクトの最も古いのは jo か demo の依頼)
  const jbCwd = join(work, 'jb')
  const joCwd = join(work, 'jo')
  const joLead = await api('POST', '/mailboxes/jo.leader/attach', { client: 'claude-code', role: 'leader', cwd: joCwd, sessionId: 's-jo' })
  await hook('jo.leader', { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'tu-jo', session_id: 's-jo', cwd: joCwd })
  const jbLead = await api('POST', '/mailboxes/jb.leader/attach', { client: 'claude-code', role: 'leader', cwd: jbCwd, sessionId: 's-jb-lead' })
  const jbDep = await api('POST', '/mailboxes/jb.deployer/attach', { client: 'claude-code', role: 'deployer', cwd: jbCwd, sessionId: 's-jb-dep' })
  await hook('jb.leader', { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'tu-jb', session_id: 's-jb-lead', cwd: jbCwd })
  // deployer は依頼を渡された (返信なし): Working。leader には未読の依頼 (JB-UNREAD) を置く
  const awaitMsg = await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'jb.deployer' }, body: 'JB-AWAIT: 渡して返信を待つ依頼' })
  await api('POST', `/attachments/${jbDep.attachmentId}/ack`, { upTo: awaitMsg.seq })
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'jb.leader' }, body: 'JB-UNREAD: 未読の依頼' })
  await sleep(1500)
  const jbKey = await evaluate("[...projects.values()].find((p) => p.label === 'jb').key")
  await evaluate(`chooseProject(${JSON.stringify(jbKey)})`)
  await sleep(500)

  // 押す。結果は押した印の見た目 (カーソル・title)、押した後に強調されたもの、表示 (Map か Messages)、ステータス
  const press = (sel) => evaluate(`(async () => {
    // 描き直しが済むまで待つ: カードとチップが 300 ms 変わらないこと。SSE の取り直しで押す前後に描き直されると、押した先が外れて強調が消える (C142 の調べ)
    const quiet = () => [...document.querySelectorAll('#mailboxes .mb, #map .mapnode, #states .stc')]
    let snap = quiet()
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 300))
      const now = quiet()
      if (now.length === snap.length && now.every((n, j) => n === snap[j])) break
      snap = now
    }
    const el = document.querySelector(${JSON.stringify(sel)})
    if (!el) return null
    const cursor = getComputedStyle(el).cursor
    const title = el.title
    document.querySelectorAll('.hit').forEach((e) => e.classList.remove('hit'))
    const before = [...document.querySelectorAll('#mailboxes .mb, #map .mapnode')]
    el.click()
    await new Promise((r) => setTimeout(r, 400))
    const replaced = before.filter((n) => !n.isConnected).length // 押した後に描き直されて外れたカードの数 (C142 の調べ)
    const hits = [...document.querySelectorAll('.hit')].map((h) => ({
      kind: h.classList.contains('msg') ? 'msg' : h.classList.contains('evt') ? 'evt' : h.classList.contains('mb') ? 'mb' : 'mapnode',
      seq: h.dataset.seq ?? null,
      who: (h.querySelector('.chip, .name') || {}).textContent || null,
    }))
    return { cursor, title, status: $('status').textContent, hits, replaced, map: !$('map').hidden }
  })()`)
  const unreadOf = async (name) => (await api('GET', '/mailboxes')).mailboxes.find((m) => m.name === name).unread
  const snapBefore = { msgs: await countMessages(), unread: await unreadOf('jb.leader') }

  const back = await press('#backlog .bl[data-layer="agent"]')
  verify('#backlog の Agent バッジ: 押すと、表示中のカードが数えた最も古いもの (JB-AWAIT) へ飛んで強調され、指の形の印で title がある (C106)',
    back && back.cursor === 'pointer' && back.title.includes('Click') && back.hits.length === 1 && back.hits[0].seq === String(awaitMsg.seq), back)
  const you = await press('#states .stc.st-you')
  verify('Needs you バッジ: 押すと、この状態に入れた最も古い Event (jb.leader の質問) へ飛んで強調される (C106)',
    you && you.cursor === 'pointer' && you.hits.length === 1 && you.hits[0].kind === 'evt' && you.hits[0].who === 'jb.leader', you)
  const working = await press('#states .stc.st-working')
  verify('Working バッジ: 押すと、その状態の最初のカード (サイドバー) が強調される。メッセージ欄は動かさない (C106)',
    working && working.cursor === 'pointer' && working.hits.length === 1 && working.hits[0].kind === 'mb' && working.hits[0].who === 'jb.deployer',
    { working, cardsNow: await evaluate("[...document.querySelectorAll('#mailboxes .mb')].map((b) => [(b.querySelector('.name') || {}).textContent, (b.querySelector('.state') || {}).textContent, b.className])"), chips: await evaluate("[...document.querySelectorAll('#states .stc')].map((c) => c.className + ' ' + c.textContent)") })
  const snapAfter = { msgs: await countMessages(), unread: await unreadOf('jb.leader') }
  verify('押しても何も送らず、既読にせず、状態も変えない (C106)', snapAfter.msgs === snapBefore.msgs && snapAfter.unread === snapBefore.unread, { snapBefore, snapAfter })

  // C145: a redraw within the 3 seconds of a state-chip press rebuilds the cards; the card of the same Mailbox is marked again until
  // the original end time (not restarted). This scene does NOT use press (no settle wait): it clicks the chip, waits 1.8 s, and then
  // causes an SSE-driven redraw itself (a new Mailbox attaches, so the page rebuilds the cards)
  const c145Name = await evaluate(`(() => {
    const card = document.querySelector('#mailboxes .mb.st-working')
    if (!card || !document.querySelector('#states .stc.st-working')) return null
    window.__c145 = { name: (card.querySelector('.name') || {}).textContent, old: card }
    document.querySelectorAll('.hit').forEach((e) => e.classList.remove('hit'))
    return window.__c145.name
  })()`)
  if (c145Name) {
    const pressAt = Date.now()
    await evaluate("document.querySelector('#states .stc.st-working').click()")
    await sleep(1800)
    const bystander = 'c145.bystander'
    await api('POST', `/mailboxes/${bystander}/attach`, { client: 'claude-code', role: 'leader', cwd, sessionId: 's-c145' })
    // Poll in the page: the rebuilt card of that Mailbox, marked, and when the mark goes
    const rebuilt = await evaluate(`(async () => {
      const name = window.__c145.name
      const cardNow = () => [...document.querySelectorAll('#mailboxes .mb')].find((n) => (n.querySelector('.name') || {}).textContent === name) || null
      let card = null
      for (let i = 0; i < 40 && !(card && card !== window.__c145.old && card.classList.contains('hit')); i++) {
        await new Promise((r) => setTimeout(r, 50))
        card = cardNow()
      }
      return { replaced: !window.__c145.old.isConnected, marked: !!(card && card.classList.contains('hit')), name }
    })()`)
    const removedAt = await evaluate(`(async () => {
      const name = window.__c145.name
      const cardNow = () => [...document.querySelectorAll('#mailboxes .mb')].find((n) => (n.querySelector('.name') || {}).textContent === name) || null
      const t0 = Date.now()
      while (Date.now() - t0 < 4000) {
        const c = cardNow()
        if (!c || !c.classList.contains('hit')) return Date.now()
        await new Promise((r) => setTimeout(r, 25))
      }
      return null
    })()`)
    const elapsed = removedAt === null ? null : removedAt - pressAt
    verify('C145: a redraw 1.8 s after a state-chip press rebuilds the card; the rebuilt card is still marked, and the mark ends at the original 3 s, not later (C145)',
      rebuilt.replaced && rebuilt.marked && elapsed !== null && elapsed >= 2800 && elapsed <= 3700,
      { c145Name, rebuilt, elapsedMs: elapsed })
    await api('DELETE', `/attachments/${(await api('GET', '/mailboxes')).mailboxes.find((m) => m.name === bystander).attachment.attachmentId}`)
    await api('DELETE', `/mailboxes/${bystander}`)
    await sleep(800)
  } else {
    verify('C145: a working card is on the page for the redraw check', false, { c145Name })
  }

  // 地図: Needs you のラベルは Messages に切り替えてから飛ぶ。Working は地図の上で強調する
  await evaluate("$('mapToggle').click()")
  await sleep(400)
  const cardYou = await press('.mapnode[data-name="jb.leader"] .state')
  verify('地図の Needs you ラベル (カード): 押すと Messages に切り替わり、そのカードの質問 (Event) へ飛んで強調される (C106)',
    cardYou && cardYou.cursor === 'pointer' && !cardYou.map && cardYou.hits.length === 1 && cardYou.hits[0].kind === 'evt' && cardYou.hits[0].who === 'jb.leader', cardYou)
  await evaluate("$('mapToggle').click()")
  await sleep(400)
  const mapWorking = await press('#states .stc.st-working')
  verify('地図の上で Working バッジを押すと、地図のノードを強調し、地図のまま (C106)',
    mapWorking && mapWorking.map && mapWorking.hits.length === 1 && mapWorking.hits[0].kind === 'mapnode' && mapWorking.hits[0].who === 'jb.deployer', mapWorking)
  // 人のノードの Needs you N は全プロジェクトの数。最も古いのは jb の外 (demo か jo) にあり、絞り込みで隠れている → 飛ばず、そう言う
  const hiddenHuman = await press('.mapnode.human .state')
  verify('地図の人の Needs you: 最も古いものが絞り込みで隠れていれば、飛ばずに隠れていると言い、地図のまま (C106)',
    hiddenHuman && hiddenHuman.map && hiddenHuman.status.includes('hidden by the project filter') && hiddenHuman.hits.length === 0, hiddenHuman)
  // 地図のまま絞り込みを外す (Map view は続く)
  await evaluate("chooseProject('')")
  await sleep(400)
  const allHuman = await press('.mapnode.human .state')
  verify('地図の人の Needs you: 絞り込みを外すと最も古いものへ飛び、Messages に切り替わって強調される (C106)',
    allHuman && !allHuman.map && allHuman.hits.length === 1 && allHuman.hits[0].who === 'jo.leader', allHuman)

  // C106 (2): 残りの押せる印を、実際のバッジで押す。Stopped (返信待ちの最も古い依頼)、Waiting on others と Paused (最初のカード。サイドバーと地図)、
  // Kind で隠れた飛び先 (状態は変えない)、最新 200 件より古い Event (手元にない)。押すたびに、印・送らない・既読にしない・状態を変えないを見る
  {
  const press2 = (sel) => evaluate(`(async () => {
    // 描き直しが済むまで待つ: カードとチップが 300 ms 変わらないこと。SSE の取り直しで押す前後に描き直されると、押した先が外れて強調が消える (C142 の調べ)
    const quiet = () => [...document.querySelectorAll('#mailboxes .mb, #map .mapnode, #states .stc')]
    let snap = quiet()
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 300))
      const now = quiet()
      if (now.length === snap.length && now.every((n, j) => n === snap[j])) break
      snap = now
    }
    const el = document.querySelector(${JSON.stringify(sel)})
    if (!el) return null
    const cursor = getComputedStyle(el).cursor
    const title = el.title
    document.querySelectorAll('.hit').forEach((e) => e.classList.remove('hit'))
    const before = [...document.querySelectorAll('#mailboxes .mb, #map .mapnode')]
    el.click()
    await new Promise((r) => setTimeout(r, 400))
    const replaced = before.filter((n) => !n.isConnected).length // 押した後に描き直されて外れたカードの数 (C142 の調べ)
    const hits = [...document.querySelectorAll('.hit')].map((h) => ({
      kind: h.classList.contains('msg') ? 'msg' : h.classList.contains('evt') ? 'evt' : h.classList.contains('mb') ? 'mb' : 'mapnode',
      seq: h.dataset.seq ?? null,
      who: (h.querySelector('.chip, .name') || {}).textContent || null,
    }))
    return { cursor, title, status: $('status').textContent, hits, replaced, map: !$('map').hidden, states: $('states').textContent }
  })()`)
  const unread2 = async (name) => (await api('GET', '/mailboxes')).mailboxes.find((m) => m.name === name).unread
  // 止まった依頼 (jb.deployer は JB-AWAIT を渡したままターンを終えた)。委ねる側 (jb.waiter) は jb.filler に依頼を出して終える
  await api('POST', '/mailboxes/jb.filler/attach', { client: 'claude-code', cwd: jbCwd, sessionId: 's-jb-fill' })
  await hook('jb.deployer', { hook_event_name: 'Stop', session_id: 's-jb-dep', cwd: jbCwd })
  const waiter = await api('POST', '/mailboxes/jb.waiter/attach', { client: 'claude-code', cwd: jbCwd, sessionId: 's-jb-wait' })
  await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'jb.filler' }, body: 'JB-WAIT: 待っている依頼' }, { 'x-hub-attachment': waiter.attachmentId })
  await hook('jb.waiter', { hook_event_name: 'Stop', session_id: 's-jb-wait', cwd: jbCwd })
  const paused = await api('POST', '/mailboxes/jb.paused/attach', { client: 'claude-code', cwd: jbCwd, sessionId: 's-jb-pz' })
  await hook('jb.paused', { hook_event_name: 'StopFailure', session_id: 's-jb-pz', cwd: jbCwd, error: 'rate_limit', last_assistant_message: "You've hit your limit" })
  await sleep(1500)
  // 前のブロックは All projects で終わるので、ここで jb に絞り直す (demo の止まった依頼が先に来ないように)
  await evaluate(`chooseProject(${JSON.stringify(jbKey)})`)
  const cards2 = (await screen()).cards
  const stateOfCard = (name) => (cards2.find((c) => c.name === name) || {}).state || ''
  verify('(準備) jb.deployer は Stopped、jb.waiter は Waiting on others、jb.paused は Paused (C106)',
    stateOfCard('jb.deployer').startsWith('Stopped') && stateOfCard('jb.waiter').startsWith('Waiting on others') && stateOfCard('jb.paused').startsWith('Paused'), cards2)
  // Stuck?: 接続のない Mailbox (jb.gone) に届いた未読。そのバッジは、その依頼へ飛ぶ
  const gone = await api('POST', '/mailboxes/jb.gone/attach', { client: 'claude-code', cwd: jbCwd, sessionId: 's-jb-gone' })
  await api('DELETE', `/attachments/${gone.attachmentId}`)
  const goneMsg = await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'jb.gone' }, body: 'JB-GONE: 未接続の Mailbox に届いた未読' })
  await sleep(1500)
  const snap2Before = { msgs: await countMessages(), unread: await unread2('jb.leader') }

  const stoppedP = await press2('#states .stc.st-stopped')
  verify('Stopped バッジ: 押すと、返信待ちの最も古い依頼 (JB-AWAIT) へ飛んで強調される (C106)',
    stoppedP && stoppedP.cursor === 'pointer' && stoppedP.title.includes('Click') && stoppedP.hits.length === 1 && stoppedP.hits[0].kind === 'msg' && stoppedP.hits[0].seq === String(awaitMsg.seq), stoppedP)
  const waitingP = await press2('#states .stc.st-delegated')
  verify('Waiting on others バッジ: 押すと、その状態の最初のカード (サイドバー) が強調される (C106)',
    waitingP && waitingP.cursor === 'pointer' && waitingP.hits.length === 1 && waitingP.hits[0].kind === 'mb' && waitingP.hits[0].who === 'jb.waiter', waitingP)
  const pausedP = await press2('#states .stc.st-paused')
  verify('Paused バッジ: 押すと、その状態の最初のカード (サイドバー) が強調される (C106)',
    pausedP && pausedP.cursor === 'pointer' && pausedP.hits.length === 1 && pausedP.hits[0].kind === 'mb' && pausedP.hits[0].who === 'jb.paused', pausedP)
  await evaluate("$('mapToggle').click()")
  await sleep(400)
  const mapWaiting = await press2('#states .stc.st-delegated')
  verify('地図の上で Waiting on others バッジを押すと、地図のノードを強調し、地図のまま (C106)',
    mapWaiting && mapWaiting.map && mapWaiting.hits.length === 1 && mapWaiting.hits[0].kind === 'mapnode' && mapWaiting.hits[0].who === 'jb.waiter', mapWaiting)
  const mapPaused = await press2('#states .stc.st-paused')
  verify('地図の上で Paused バッジを押すと、地図のノードを強調し、地図のまま (C106)',
    mapPaused && mapPaused.map && mapPaused.hits.length === 1 && mapPaused.hits[0].kind === 'mapnode' && mapPaused.hits[0].who === 'jb.paused', mapPaused)
  await evaluate("$('mapToggle').click()")
  await sleep(400)

  // C145 (2): a second press. Another card's chip leaves only the new card marked; the same chip pressed again marks its card until
  // 3 s after the second press (the first press's timer must not end it early). Direct clicks, no settle wait, no redraw in between
  const marksNow = () => evaluate("[...document.querySelectorAll('#mailboxes .mb.hit')].map((b) => (b.querySelector('.name') || {}).textContent)")
  await evaluate("document.querySelectorAll('.mb.hit, .mapnode.hit').forEach((n) => n.classList.remove('hit'))")
  await evaluate("document.querySelector('#states .stc.st-paused').click()")
  await sleep(700)
  const marksAfterPaused = await marksNow()
  await evaluate("document.querySelector('#states .stc.st-delegated').click()")
  await sleep(300)
  const marksAfterOther = await marksNow()
  verify('C145: a second press on another card leaves only the new card marked (C145)',
    JSON.stringify(marksAfterPaused) === JSON.stringify(['jb.paused']) && JSON.stringify(marksAfterOther) === JSON.stringify(['jb.waiter']),
    { marksAfterPaused, marksAfterOther })
  await sleep(1700) // the first press was about 2 s ago; the same chip is pressed again
  const secondAt = Date.now()
  await evaluate("document.querySelector('#states .stc.st-delegated').click()")
  await sleep(2300) // 2.3 s after the second press: still marked
  const stillMarked = (await marksNow()).includes('jb.waiter')
  const goneAt = await evaluate(`(async () => {
    const cardNow = () => [...document.querySelectorAll('#mailboxes .mb')].find((n) => (n.querySelector('.name') || {}).textContent === 'jb.waiter') || null
    const t0 = Date.now()
    while (Date.now() - t0 < 4000) {
      const c = cardNow()
      if (!c || !c.classList.contains('hit')) return Date.now()
      await new Promise((r) => setTimeout(r, 25))
    }
    return null
  })()`)
  const lifeMs = goneAt === null ? null : goneAt - secondAt
  verify('C145: the same chip pressed twice: the mark lasts 3 s from the second press, not from the first (C145)',
    stillMarked && lifeMs !== null && lifeMs >= 2600 && lifeMs <= 3700, { stillMarked, lifeMs })
  // #backlog の Stuck?: 接続のない jb.gone の未読 (JB-GONE) を数える。押すとそこへ飛ぶ
  const stuckP = await press2('#backlog .bl[data-layer="stuck"]')
  verify('#backlog の Stuck? バッジ: 押すと、接続のない Mailbox の最も古い未読 (JB-GONE) へ飛んで強調される (C106)',
    stuckP && stuckP.cursor === 'pointer' && stuckP.hits.length === 1 && stuckP.hits[0].kind === 'msg' && stuckP.hits[0].seq === String(goneMsg.seq), stuckP)

  // Kind で隠れた飛び先: #backlog の Agent と #states の Stopped は、押すと隠れていると言う。どちらも状態は変わらない
  const statesBefore = await evaluate('$("states").textContent')
  await evaluate("toggleIn(FILTER.kinds, 'request', true)")
  await sleep(300)
  const kindAgent = await press2('#backlog .bl[data-layer="agent"]')
  verify('#backlog の Agent バッジ: 飛び先が Kind の絞り込みで隠れていれば、飛ばずに隠れていると言い、状態は変わらない (C48、C106)',
    kindAgent && kindAgent.cursor === 'pointer' && kindAgent.hits.length === 0 && kindAgent.status.includes('hidden by the Kind filter') && kindAgent.states === statesBefore, kindAgent)
  const kindStopped = await press2('#states .stc.st-stopped')
  verify('#states の Stopped バッジ: 飛び先が Kind で隠れていれば、飛ばずに隠れていると言い、状態は変わらない (C48、C106)',
    kindStopped && kindStopped.hits.length === 0 && kindStopped.status.includes('hidden by the Kind filter') && kindStopped.states === statesBefore, kindStopped)
  await evaluate("toggleIn(FILTER.kinds, 'request', false)")
  await sleep(300)

  // 手元にない飛び先: 最新 200 件より古い Event (jb.leader の質問) は、ページが読んでいない。Hub の数えるもの (You) はそれを指す。
  // 後から 205 件の Event を積んで押し出し、ページを読み直してから You バッジを押す
  for (let i = 0; i < 205; i++) await hook('jb.filler', { hook_event_name: 'Stop', session_id: 's-jb-fill', cwd: jbCwd })
  await cdp('Page.navigate', { url: `${HUB}/?token=${TOKEN}` })
  await sleep(2000)
  await evaluate(`chooseProject(${JSON.stringify(jbKey)})`)
  await sleep(800)
  const notLoadedP = await press2('#backlog .bl[data-layer="you"]')
  verify('#backlog の You バッジ: 飛び先の Event が手元にないと、押すと not loaded と言い、何も動かさない (C106)',
    notLoadedP && notLoadedP.cursor === 'pointer' && notLoadedP.hits.length === 0 && notLoadedP.status.includes('That event is not loaded'), notLoadedP)
  const snap2After = { msgs: await countMessages(), unread: await unread2('jb.leader') }
  verify('押しても何も送らず、既読にせず、状態も変えない (C106)', snap2After.msgs === snap2Before.msgs && snap2After.unread === snap2Before.unread, { snap2Before, snap2After })
  }
  }
  // Hub が止まって起動し直した場面 (C142)。渡した依頼に返信がないまま Hub が止まり、起動し直した後も返事もターン終了も届いていない
  {
    // 同じ project (demo) に置く。ページは選んだ project のカードだけを出すため。タブのタイトルの件数は全 project の数なので、場面の前後の差で確かめる
    const waitingOf = (t) => Number((/^(\d+) waiting/.exec(t) || [0, 0])[1])
    const rstCwd = join(work, 'demo')
    const rstAt = await api('POST', '/mailboxes/rst.deployer/attach', { client: 'claude-code', role: 'deployer', cwd: rstCwd, sessionId: 's-rst' })
    const rstReq = await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'rst.deployer' }, body: 'GOAL: 返信のない依頼 (C142 の場面)' })
    await api('POST', `/attachments/${rstAt.attachmentId}/ack`, { upTo: rstReq.seq })
    // 前の場面の絞り込み (Mailbox・Kind・project) で隠れないよう、Reset と同じ既定に戻す (C59)
    await cdp('Runtime.evaluate', { expression: 'resetFilters()', returnByValue: true })
    await sleep(500)
    await scene('返信のない依頼を渡した (Hub が止まる前。作業中)', { 'rst.deployer': 'Working' }, '')
    const waitingBase = waitingOf((await screen()).title)

    await restartHub()
    const rstAgain = await api('POST', '/mailboxes/rst.deployer/attach', { client: 'claude-code', role: 'deployer', cwd: rstCwd, sessionId: 's-rst' })
    await until(async () => (await evaluate("$('conn').className")) === 'ok', 'page connected', 80)
    await scene('Hub が起動し直した後も、返信のない依頼が残っている (Stopped で、再起動を理由に添える。C142)', { 'rst.deployer': 'Stopped, no reply (Hub restarted after the hand-over)' }, '')
    const shownNow = { tab: await evaluate('tabStopped'), cards: await evaluate('teamModel().human.stopped'), title: (await screen()).title }
    verify('Hub が起動し直した後: タブの Stopped はカードの Stopped の数と同じで、タイトルの件数は変わらない (C109)', shownNow.tab === shownNow.cards && shownNow.cards >= 1 && waitingOf(shownNow.title) === waitingBase, { waitingBase, shownNow })

    // Health check (C76) は、その Mailbox に、いちばん古い返信のない依頼 (この依頼) を指す cue を 1 通送る。新しい種類の cue は足さない
    const stoppedNow = JSON.parse(await evaluate("JSON.stringify(stoppedMailboxes().map((m) => [m.name, m.awaitingSeq]))"))
    const cueAfter = (await api('GET', '/messages?after=0&limit=1000')).messages.at(-1).seq
    const healthBefore = await evaluate("({ text: $('health').textContent, disabled: $('health').disabled })")
    await cdp('Runtime.evaluate', { expression: "$('health').click()", returnByValue: true })
    await sleep(1500)
    const cue = (await api('GET', `/messages?after=${cueAfter}&limit=100`)).messages.find((m) => m.kind === 'notice' && m.to.id === 'rst.deployer')
    verify(
      'Health check: 起動し直した後も、その Mailbox を数えて、返信のない依頼を指す cue を送る (C76, C142)',
      stoppedNow.some(([n, s]) => n === 'rst.deployer' && s === rstReq.seq) && healthBefore.text === `Health check (${stoppedNow.length})` && !healthBefore.disabled && !!cue && cue.body.includes(`#${rstReq.seq}`),
      { stoppedNow, healthBefore, cue: cue && cue.body },
    )

    // 起動の後に渡し直すと、その受け渡しで作業中に戻る (C142)
    const rstNew = await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'rst.deployer' }, body: 'GOAL: 起動の後に渡した依頼 (C142 の場面)' })
    await api('POST', `/attachments/${rstAgain.attachmentId}/ack`, { upTo: rstNew.seq })
    await scene('起動の後に渡し直した (作業中に戻る。C142)', { 'rst.deployer': 'Working' }, '')
    verify('起動の後に渡し直した: タブの件数は元に戻る (Working は数えない)', waitingOf((await screen()).title) === waitingBase, { waitingBase })

    // 起動の後にターンが終わると、再起動の理由は出ず、ふつうの Stopped になる (C142)
    await api('POST', '/events/claude-code', { cwd: rstCwd, hook_event_name: 'Stop', session_id: 's-rst' }, { 'x-hub-mailbox': 'rst.deployer' })
    await scene('起動の後にターンが終わり、返信はない (Stopped。再起動の理由は出ない。C142)', { 'rst.deployer': 'Stopped, no reply' }, '')
    const shownEnd = { tab: await evaluate('tabStopped'), cards: await evaluate('teamModel().human.stopped'), title: (await screen()).title }
    verify('ターン終了で Stopped に戻る: タブの Stopped はカードの Stopped の数と同じで、タイトルの件数は変わらない', shownEnd.tab === shownEnd.cards && shownEnd.cards >= 1 && waitingOf(shownEnd.title) === waitingBase, { waitingBase, shownEnd })
    const restartShown = (await screen()).cards.find((c) => c.name === 'rst.deployer').state.includes('Hub restarted')
    verify('ターンの終わりを読んだあと、「Hub restarted」は出ない (C142)', !restartShown, { restartShown })
  }
  // 再起動の見直し (C142): 再起動の前に、(1) 作業を渡して終えた leader と、(2) 返事なしでターンを終えた deployer を作る。
  // 再起動の後も、(1) は委任中 (Waiting on others) のままで Health check に数えない。(2) は既定の Stopped で、再起動の理由は出ない
  {
    const dCwd = join(work, 'demo')
    const dl = await api('POST', '/mailboxes/dlg.leader/attach', { client: 'claude-code', role: 'leader', cwd: dCwd, sessionId: 's-dlg-l' })
    const dd = await api('POST', '/mailboxes/dlg.deployer/attach', { client: 'claude-code', role: 'deployer', cwd: dCwd, sessionId: 's-dlg-d' })
    const tn = await api('POST', '/mailboxes/tn.deployer/attach', { client: 'claude-code', role: 'deployer', cwd: dCwd, sessionId: 's-tn' })
    const dlgReq = await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'dlg.leader' }, body: 'GOAL: 委任する依頼 (C142 の見直し)' })
    await api('POST', `/attachments/${dl.attachmentId}/ack`, { upTo: dlgReq.seq })
    // leader が deployer に作業を渡し、ターンを終える (終えたのは渡したあと)
    const handOff = await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'dlg.deployer' }, body: 'GOAL: leader が渡した作業 (C142 の見直し)' }, { 'x-hub-attachment': dl.attachmentId })
    await api('POST', `/attachments/${dd.attachmentId}/ack`, { upTo: handOff.seq })
    const tnReq = await api('POST', '/messages', { kind: 'request', to: { type: 'mailbox', id: 'tn.deployer' }, body: 'GOAL: 返事なしで終える依頼 (C142 の見直し)' })
    await api('POST', `/attachments/${tn.attachmentId}/ack`, { upTo: tnReq.seq })
    await api('POST', '/events/claude-code', { cwd: dCwd, hook_event_name: 'Stop', session_id: 's-dlg-l' }, { 'x-hub-mailbox': 'dlg.leader' })
    await api('POST', '/events/claude-code', { cwd: dCwd, hook_event_name: 'Stop', session_id: 's-tn' }, { 'x-hub-mailbox': 'tn.deployer' })
    await scene('再起動の前: 作業を渡して終えた leader は委任中、返事なしで終えた deployer は Stopped', { 'dlg.leader': 'Waiting on others (dlg.deployer)', 'dlg.deployer': 'Working', 'tn.deployer': 'Stopped, no reply' }, '')

    await restartHub()
    await api('POST', '/mailboxes/dlg.leader/attach', { client: 'claude-code', role: 'leader', cwd: dCwd, sessionId: 's-dlg-l' })
    await api('POST', '/mailboxes/dlg.deployer/attach', { client: 'claude-code', role: 'deployer', cwd: dCwd, sessionId: 's-dlg-d' })
    await api('POST', '/mailboxes/tn.deployer/attach', { client: 'claude-code', role: 'deployer', cwd: dCwd, sessionId: 's-tn' })
    await until(async () => (await evaluate("$('conn').className")) === 'ok', 'page connected', 80)
    await scene('再起動の後も、委任中の leader は Waiting on others のまま (C142 の見直し)', { 'dlg.leader': 'Waiting on others (dlg.deployer)' }, '')
    await scene('再起動の後、渡した作業が返っていない deployer は、再起動を理由に Stopped (C142)', { 'dlg.deployer': 'Stopped, no reply (Hub restarted after the hand-over)' }, '')
    await scene('返事なしで終えた deployer は、既定の Stopped。再起動の理由は出ない (C142 の見直し)', { 'tn.deployer': 'Stopped, no reply' }, '')
    const cardsNow = (await screen()).cards
    const tnText = (cardsNow.find((c) => c.name === 'tn.deployer') || {}).state || ''
    verify('tn.deployer の状態に「Hub restarted」は出ない (C142 の見直し)', tnText.length > 0 && !tnText.includes('Hub restarted'), { tnText })
    // Health check は、再起動の理由で止まった deployer だけを数え、委任中の leader は数えない (cue を送るのも同じ一覧)
    const stoppedAfter = JSON.parse(await evaluate("JSON.stringify(stoppedMailboxes().map((m) => m.name))"))
    verify(
      'Health check: 委任中の leader は数えず cue も送らない。返っていない deployer は数える (C142 の見直し)',
      !stoppedAfter.includes('dlg.leader') && stoppedAfter.includes('dlg.deployer') && stoppedAfter.includes('tn.deployer'),
      { stoppedAfter },
    )
  }
  // 接続しているセッションがひとつもない: Your move は出さない (C127)。すべて切り離してから地図を見る
  for (const mb of (await api('GET', '/mailboxes')).mailboxes) if (mb.attachment) await api('DELETE', `/attachments/${mb.attachment.attachmentId}`)
  await mapScene('接続しているセッションがない: Your move は出さない (C127)', 'no move')
} catch (e) {
  failed++
  console.error(`NG  ${e.message}`)
  console.error(hubLog.slice(-2000))
} finally {
  try {
    ws?.close()
  } catch {}
  if (chrome) spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'])
  for (const h of hubs) spawnSync('taskkill', ['/PID', String(h.pid), '/T', '/F'])
  if (process.platform !== 'win32') {
    chrome?.kill()
    hub.kill()
  }
  await sleep(500)
  // A failed run keeps the work folder (the check Hub's data and hub.log, C158) and says where it is. A passing run removes it
  if (failed) console.error(`the work folder is kept for the failed check: ${work} (its Hub's log is hub.log there)`)
  else rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  process.exitCode = failed ? 1 : 0
}
