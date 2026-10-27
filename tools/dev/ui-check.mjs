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
    })),
  })`
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true })
  return JSON.parse(r.result.value)
}

let failed = 0
// expect: Mailbox 名 → 状態の行の先頭 (例 'Needs you (request)')。title は タブのタイトルの先頭
async function scene(label, expect, title = 'agent-hub') {
  const s = await screen()
  const problems = []
  for (const [name, state] of Object.entries(expect)) {
    const card = s.cards.find((c) => c.name === name)
    if (!card) problems.push(`${name}: カードがない`)
    else if (!card.state.startsWith(state)) problems.push(`${name}: 「${card.state}」 (期待は「${state}」)`)
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
  await turnEnd('demo.leader', 's-lead')
  await scene('報告が戻り、leader が人に返した', { 'demo.leader': 'Idle', 'demo.deployer': 'Idle' })
  await sections('leader の返事の見出しを節ごとに色分けする (C42)', report, { decide: 2, op: 0, unverified: 1, hd: 5 })

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

  // 溜まりのバッジから最も古いものへ飛ぶ (C44)。古い依頼は止まった Event と違って、畳んだ分の中にあることもある
  await scene('5 日前の返信待ちの依頼が残っている', { 'demo.old': 'Stopped, no reply' }, '2 waiting')
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
