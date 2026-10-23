// カードの状態 (design.md §3.15) を、別のポートの Hub とヘッドレスの Chrome で場面ごとに確かめる。
// API で場面を作り、CDP で DOM を読んで、期待する状態と照らす。UI には単体テストがないので、UI を変えたら流す。
// 使い方: npm run ui:check  (Chrome の場所は CHROME、ポートは UI_CHECK_PORT / UI_CHECK_CDP_PORT で変えられる)
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
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
