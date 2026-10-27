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

  // 溜まりのバッジの飛び先 (C48)。demo の絞り込みで、隠れた場面・畳んだ範囲の中の場面・You と Stuck? の場面を確かめる
  const verify = (label, ok, detail) => {
    if (!ok) failed++
    console.log(`${ok ? 'ok' : 'NG'}  ${label}`)
    if (!ok) console.log(`      ${JSON.stringify(detail)}`)
  }
  const evaluate = async (expression) => (await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value
  const seqOf = async (body) => (await api('GET', '/messages?after=0&limit=1000')).messages.findLast((m) => m.body === body).seq
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
    const stub = !!document.querySelector('#list .stub')
    if (!hit) return { text, hit: null, stub }
    const list = document.getElementById('list').getBoundingClientRect()
    const r = hit.getBoundingClientRect()
    return { text, hit: hit.classList.contains('evt') ? 'evt' : 'msg', seq: hit.dataset.seq ?? null, shown: r.top >= list.top && r.bottom <= list.bottom, stub }
  })()`)
  // 隠れた Message の seq で jumpTo を呼ぶ。バッジと同じ形の t を渡す (隠れた Message を指すバッジは通常の数え方では出ない)
  const hiddenJump = (seq) => evaluate(`(() => {
    const list = $('list')
    const before = { top: list.scrollTop, folded: folded.length, stub: !!document.querySelector('#list .stub'), boxes: list.querySelectorAll('.msg, .evt').length }
    jumpTo({ count: 1, oldestAt: null, oldestSeq: ${seq}, eventId: null })
    const m = [...seen.values()].find((x) => x.seq === ${seq})
    const target = m && msgBoxes.get(m.id)
    return {
      status: $('status').textContent,
      moved: list.scrollTop !== before.top || folded.length !== before.folded || !!document.querySelector('#list .stub') !== before.stub || list.querySelectorAll('.msg, .evt').length !== before.boxes,
      hit: !!(target && target.classList.contains('hit')),
      stillFolded: folded.some((f) => f.seq === ${seq}),
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
  const inFold = await evaluate(`folded.some((f) => f.seq === ${hiddenOld})`)
  verify('(準備) 隠れた依頼 TARGET: C2 が畳みの中にある', inFold, { hiddenOld })
  const hiddenFolded = await hiddenJump(hiddenOld)
  verify('隠れた依頼が畳みの中にあっても、畳みは開かず、ステータスに隠れていると出す (C48)', hiddenFolded.status.includes('hidden by the project filter') && hiddenFolded.status.includes('All projects') && !hiddenFolded.moved && hiddenFolded.stillFolded, hiddenFolded)

  // 3. 畳みの中の (隠れていない) 依頼: 畳みが開き、表示範囲に入って強調される
  const shownFolded = await evaluate('folded.some((f) => f.seq === 1)')
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
    { head: 'Plan (3) · no ## 予定 in this file', open: null, ids: ['C6', 'C7', 'C8'], rows: [] },
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
