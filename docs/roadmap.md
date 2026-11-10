# Roadmap

Each phase puts weight on "ending in a working state". Move on after the acceptance criteria are met.

Open items are written as `### C<n>. Title` sections under "Items" at the end (design.md §3.15). Do not keep a separate bulleted "someday" list. Nothing follows the title (no status or date). A request names the ID instead of copying the item; the one who works on it reads the latest from the ledger.
- Right after the heading, write only an exceptional status, on one unindented line: `Status: proposed | held(<condition to resume>) | blocked(after C<n>)`. Without the line, the item is decided (may be started). An item the user has not decided is `proposed`: a writer's (AI's) idea is not filed as decided.
- A decided item has `#### Done when` (a list of checkboxes). A request's `DONE WHEN` is copied from it.
  - Each line can be checked within the item alone; conditions common to all work (tests pass, docs updated) are still written per item. Lines come from the current decision only; rejected ideas and history go in the body.
  - An item is about one request in size; split it when its tests span two independent features. Working promises (commits wait for the word, do not touch data, stop at what is undecided) live in the project's CLAUDE.md, not in each item.
- Numbers are not reused. The close waits for the review (C102): after the review and its fixes, a closing request deletes the section, marks the phase line `[x] C<n> …`, writes the record of what was checked below it, removes the item from `## Plan`, and removes `blocked(after C<n>)` lines that waited for that item (status is progress, not a promise; the one closing may fix them). Where closed lines live is up to the project (under a phase, a list at the end, and so on). In a ledger without phase lines (for example `## 予定` / `## Plan` with a closed list), a close removes the line from the plan and never checks it there, and writes the closed line in that closed list (C141). The deployer does not close an item in its first run, because the reviewer reads the section. With no reviewer connected, the leader sends no closing request after its own check: its report says the item had no review, and the close waits for the user's word (C133).
- Progress is shown by checking off done-when conditions and adding the facts checked to the section's body. **Changing the wording of done-when conditions is changing the promise**, so it is not done within a request. Approved wording is written by the planning session, not by the deployer; the leader returns it in the report.
- **Who files items** (design.md §3.15, C96): new `### C<n>.` sections, changed done-when wording and rejections (`[-]`) are written only in the planning session (the human's session with Claude where the project is discussed; not a Hub role). The deployer, the leader and the reviewer do not write them, even when a request asks; they answer by naming the planning session. The deployer writes progress only, with the change.
- When rejected, delete the section and leave `[-] C<n> Title (rejected YYYY-MM-DD, one-line reason)` under a phase or "Known issues". If the reason is long, write it in design.md §9 and point to it (design.md §3.16).
- The plan list: the ledger has one `## Plan`, listing the items without a status line and the `blocked(after C<n>)` items in the order they will be taken up, as `- [ ] C<n>`. No titles: a title after `C<n>` on a plan line is a warning in `docs:check` (the line is still read as `C<n>`; the title belongs in the item's section). These two kinds are always listed, and nothing else. Blocked items go after the item they wait for. Reordering is a human's decision (design.md §3.15).
- How states are split: each of the four tiers corresponds to one state. `proposed` is only "awaiting a human's decision". `blocked(after C<n>)` is only for decided items (with done-when conditions) waiting on another item, with `C<n>` in the reason. An undecided item waiting on another is `held(after C<n>)`. Something waiting on an outside event (an update to the official docs, the next time a usage limit is hit and so on) is `held(<condition to resume>)` even if decided, and the reason is not omitted. Something accepted but not to be worked on is not held but rejected, `[-]`.
- A closed line (`[x] C<n>` / `[-] C<n>`) has the date it was closed (`YYYY-MM-DD`) at the head of the parentheses at the end of the line (e.g. `(2026-10-27, requested by the user)`; for a rejection `(rejected 2026-10-27, reason)`). A date inside the title does not count. The trailing group is ASCII ` (YYYY-MM-DD, …)`; any parentheses inside it are full-width (`（…）`), since the checker reads only an ASCII group with no ASCII parentheses inside (C141). `docs:check` names the fix when a closed line lacks the date or ends in a full-width `）`.
- When asked about the plan, first check for breakage with `npm run -s docs:check`, then answer from the JSON of `npm run -s docs:check -- docs/roadmap.md --index` and the dates on closed lines. Do not read the whole ledger and reclassify it (the four-tier answer is in the skill `roadmap-items`).
- The Japanese vocabulary (`状態: 提案 | 保留(…) | ブロック(C<n> の後)`, `#### 完了条件`, `## 予定`, `(却下 YYYY-MM-DD、…)`) is read the same way by the checker and the index (the mapping table is in design.md §3.15). The closed records below, from before 2026-10-29, are in Japanese.
- Older items and closed records may follow earlier rules; how to read them is in [conventions-log.md](conventions-log.md). A change to these rules adds a line there in the same commit (design.md §3.12).
- Breakage of the rules is checked with `npm run docs:check` (`src/shared/roadmap.ts`). On this repository's own roadmap it also checks the other documents (the list is in design.md §3.12; `src/docs-check/repo.ts`, C9). When you change this file, run `npm run docs:check`.
- These rules are the one home for every project's ledger, whatever its language. The global skill `roadmap-items` (`~/.claude/skills/roadmap-items/`) says when to read them, where a ledger goes and how to answer about the plan, and points here (C128). The checker is `src/shared/roadmap.ts`.

## Plan

In the order they will be taken up. Only items without a status line and blocked items are listed (titles come from the index). Reordering is a human's decision.

- [ ] C156
- [ ] C151
- [ ] C149
- [ ] C147
- [ ] C148
- [ ] C150

(Items with a status line are listed under "Items".)

## P0: One round trip in one session (done 2026-10-16)

**Goal**: a message written in the browser reaches a Claude session, Claude replies with `post_message`, and the reply shows in the browser.

- [x] Channels の仕様を公式資料で確認し、結果を design.md §6.1 に追記
- [x] hook・MCP の仕様を公式資料で確認し、design.md §6.1b に追記
- [x] design.md §6.2 の Channels・hook 関連をプローブ (`tools/probe/`) で実機確認し、結果を §6.1c に記録
- [x] プロジェクト雛形 (package.json, tsconfig。作業順は plan-p0.md。2026-11-08 に削除し、git の履歴にある)
- [x] Hub: 認証付き HTTP (Bearer + ブラウザ向け cookie)、`/messages`、`/stream` (SSE)、JSONL 追記ログ
- [x] Hub: Message の `kind` (`request` / `reply` / `notice`) の検証と、`from` の Hub 側付与
- [x] Hub: Mailbox の最小実装 (attach で作成、購読、cursor)。リースと takeover は P2
- [x] shim: channel MCP サーバー。`HUB_MAILBOX` で attach、Hub SSE 受信、`notifications/claude/channel` で push、`subscribe` / `post_message`
- [x] UI: 1 枚の HTML。メッセージ一覧 (ライブ、`kind` の表示)、送信フォーム (`kind` の選択、既定 `request`)
- [x] 起動手順を README に追記

**Acceptance criteria**
1. The Hub starts, and Claude Code can be started with the channel enabled (`--dangerously-load-development-channels`).
2. The shim attaches to the Mailbox `HUB_MAILBOX` (the folder name if not given).
3. The agent calls `subscribe("user.message")`.
4. Sending to `user.message` from the browser enters Claude's conversation as `<channel source="agent-hub">`.
5. When Claude replies with `post_message` (`kind: reply`), it shows in the browser with its `kind`.
6. API calls without the token are 401. It cannot be reached from anywhere but 127.0.0.1.
7. Opening the browser with the `?token=` URL printed at startup authenticates by cookie, and afterwards no token remains in the URL.

**Results** (2026-10-16, Claude Code 2.1.301 / Haiku 5.5 / Windows 11)
- 1〜5, 7: 実セッションとブラウザで確認。`mailbox:agent-hub` 宛て (直接) と、`subscribe("user.message")` 後の `topic:user.message` 宛て (購読) の両方が届き、
  Claude が `post_message` (`to` 省略) で返した reply が `user:browser` 宛てとして UI に出た。
  購読していない `topic:agent-hub` 宛てと `user:agent-hub` 宛ては届かなかった (仕様どおり)。
- 6: 実起動した Hub に curl でトークンなしの 401 を確認。netstat で `127.0.0.1:<port>` のみで待ち受けていることを確認。

**Planned adjustments** (found in P0's real use; done in parallel with P1)
- [x] 誰にも届かない送信に気づけない: `topic:agent-hub` (購読者なし) と `user:agent-hub` (`mailbox` のつもりで種類を誤選択) が受理され、無反応だった。
  - [x] UI の宛先を「種類 + 名前」の 2 入力から、ドロップダウン 1 本にする。選択肢は `/mailboxes` から作る (Mailbox / role / 購読中のトピック / `user:browser`)。購読者のいないトピック用に「トピックを手入力」だけ残す。種類と名前の食い違いを構造的になくす
  - [x] `POST /messages` の応答に配信先 Mailbox の一覧を含め、0 件なら UI に「届く Mailbox がない」と警告する (手入力のトピック向け)
  - [x] `user` 宛ての名前を `browser` / `cli` に限る (protocol.md も更新)
- [x] 溜まった一覧を整理できない: UI に Compact (Keep latest n、既定 10) を追加。古い分は表示から外して 1 本のスタブにまとめ、Expand で戻す。表示だけで Hub・未読・配信には影響しない
- [x] カスタムコマンド: 本文の `/name` を Send で定義済みの text に置換して送る。設定は `HUB_DATA_DIR/settings.json` に永続化し、UI の Commands から編集する (置換は UI、Hub は読み書きのみ)
- [x] 画像の添付: 貼り付け・ドラッグ・Attach で本文に画像を付けて送る。Hub が長辺 1568px に正規化して `HUB_DATA_DIR/files/` に保存し、メッセージの `meta.files` は id だけを持つ。shim の取得と `path` の付与は下の項目で行う
- [x] 画像を agent に渡す (shim): `meta.files` の画像を配信の直前に取得し、`path` (保存先のローカルパス) か `error` (`expired` / `fetch_failed`) を足す。`Read` で開ける。保存先は起動時に 24 時間で掃除し、start-agent.ps1 は `--add-dir` で読めるようにする
- [x] 未接続の古い Mailbox に依頼が溜まる: UI の Delete (接続していないカードだけ) と `DELETE /mailboxes/:name` で消せるようにする。接続中は 409。自動の掃除は未決 (design.md §9-3)
- [x] `kind` の選択をトグルボタンにし、一覧のバッジと見た目を揃える。色は付けず、選んだものだけ塗る (送り手の色とまぎれないため。design.md §3.2)

## P1: Detecting breaks and questions (done 2026-10-17)

**Goal**: the moment an agent stops or asks a question shows in the browser.

- [x] 着手前に、配送を公式 cross-session messaging に移すかを決める → **Channels のまま**。投函の形式が公開されたら見直す (design.md §9-5)
- [x] 着手前に、公式 Agent View (design.md §8.1) と重なる部分を削る → 状態一覧・ターミナルからの返信・エージェント間のアイドル通知は借りる。
  作るのは「ブラウザで見て、ブラウザから返す」部分だけ。`report_event` と重複除去は後回し (design.md §3.4 の「P1 で作る範囲」)
- [x] Event をトピックとして他の Mailbox にも配信するか → **UI に出すだけ** (design.md §9-2)
- [x] HTTP hook の設定例: `Stop` / `Notification` / `PreToolUse(AskUserQuestion)` / `PostToolUse(AskUserQuestion)` → `POST /events` (`tools/hooks/settings.json`。`Authorization` と `X-Hub-Mailbox` をヘッダーで渡す)
- [x] Hub: `/events` の取り込みを、クライアントごとの変換 (まず Claude Code の hook 用、`src/hub/events.ts`) で共通の `kind` に揃える。`payload` は元の JSON のまま (design.md §3.7)
  - [x] `permission_prompt` は `permission` にし、質問の表示で出た分 (直前が回答前の `question`) は落とす。ほかの Notification は `notification`
  - [x] 変更の事実 (`git diff --name-only`、HEAD) を hook から足せる形にしておく。`Stop` の command hook (`tools/hooks/post-event.mjs`) が `agent_hub_git` を足し、Hub が `changes` に載せる (design.md §3.11 の未決 1 は hook に決定、2026-10-17)
- [x] Hub: `sessionId` → Mailbox の解決 (shim の申告 → `X-Hub-Mailbox` → cwd。後の 2 つで解決したら session を覚える)
- [x] イベント ID: 上流に一意の値がある `question` / `question.answered` だけ `tool_use_id` から決定的に作り、重複を落とす。`Stop` / `Notification` は採番 (protocol.md §2 Event)
- [x] UI: 「質問待ち」「許可待ち」「ターン終了」をスレッドに区別して出し、Mailbox のカードに最後の Event を出す。時刻と該当内容。状態の推定はしない
- [x] 検知イベントから、ブラウザ上で返信メッセージを作る導線 (Event の Reply → その Mailbox 宛ての request)
- [x] 受け入れ条件を実セッションで確かめる (2026-10-17、leader / deployer の 2 セッション。許可待ちは `auto` モードでは出ないので、deployer を既定のモードにして確かめた)

**Acceptance criteria**
1. When Claude calls `AskUserQuestion`, the question shows in the UI under that Mailbox.
2. Turn ends and permission waits are shown distinctly.
3. A reply from the UI reaches that session. Questions are answered in the terminal, and the UI's reply arrives after that (a channel notification is not an answer; design.md §6.1c).

## P2: Several sessions, replacement, message passing

**Goal**: several agents exchange messages based on subscriptions, losing nothing across replacements and restarts.

- [x] 複数 Mailbox の同時接続、Mailbox 一覧と接続状態・role・購読・未読数の UI 表示
  - 確かめた (2026-10-17): leader と deployer が同時に接続 (`GET /mailboxes` で両方 attachment 非 null)。ack で未読が減ること (Hub が `mailbox.acked` を流し、リロードも polling もなし)、古い Hub の応答 (`effectiveSubscriptions` / `unread` なし) でもカードが出ること、`Subscribed:` の表示は、headless Chrome で別の Hub (ポート 7795、データは一時フォルダ) に対して確かめた
- [x] role: `roles.json` の読み込み、attach 時の role 指定 (`HUB_ROLE`)、既定購読との和で実効購読を計算、`to: role` 宛ての配信、`description` の `instructions` への差し込み
  - [x] 読み込みと起動時の検証 (形が違えば起動しない)、`unknown_role` (400)、`roleDescription`、既定購読との和、`to: role` 宛て、`unsubscribe` で既定が残ること。テスト `src/hub/roles.test.ts` (2026-10-17)。ファイルがなければ P0 と同じ
  - [x] `description` の shim への差し込み: initialize より前に attach して取る (上限 3 秒)。テスト `src/shim/role-instructions.test.ts` で、実際に spawn した shim の instructions を読んで確かめた (2026-10-17)
  - [x] 実セッションで確かめる: `HUB_ROLE=<定義済みの role>` の Claude Code が説明どおりに振る舞い、既定購読のトピックと `to: role` 宛てを受け取ること (受け入れ条件 6)。2026-10-17、leader / deployer / reviewer の 3 セッションで確認 (design.md §6.2-5)
  - `roles.json` の形は、後でメッセージの形の宣言 (送ってよい相手と kind、必須見出し) を足せるようにしておく (design.md §3.11)。未知の項目は保持する (2026-10-17)
- [x] Attachment のリースと heartbeat、detached 状態
  - stream を開いている間はリースを保ち、stream のないクライアントは `POST /attachments/:id/heartbeat` で延ばす。shim は heartbeat を送らない (design.md §3.3)。テスト `src/hub/mailbox.test.ts` の「リースと detached」(2026-10-17)
  - detached の理由 (`closed` / `disconnected` / `lease_expired`) を `GET /mailboxes` の `detached` と UI のカードに出す。headless Chrome で別の Hub (ポート 7795) に対して、`session ended` と、stream を開かずに 2 分置いた Attachment の `lease expired` が出ることを確かめた
- [x] takeover と `terminated(superseded)` (design.md §9-1 で排他・新しい方が勝つに決定、2026-10-17)
  - 旧 stream に `terminated(superseded)`、後継が購読と未読を引き継ぐこと、`GET /mailboxes` の `takeover` をテスト `src/hub/mailbox.test.ts` の「takeover と detach」「リースと detached」で確かめた
  - 別の Hub (ポート 7795) に実際の shim を 2 つ同じ Mailbox で起動し、A が `terminated: superseded` になって `post_message` がエラーを返すこと、トピック宛てが B だけに届くこと、UI のカードに `took over <時刻>` が出ること (headless Chrome) を確かめた。Claude Code の実セッションで交代 (受け入れ条件 3) を確かめた (design.md §6.1j)
  - 実セッションで、切り離された A の Stop hook の Event がカードの `Last event` を上書きしていた。Event に `superseded` を付け、UI はカードに使わず `superseded session` と添える
- [x] attach の `maxAgeMs` / `truncated` と、省略通知 (既定 7 日 / 50 件。design.md §9-4 で決定、2026-10-17)
  - 件数の上限 `maxUnread` も足した。超えた古い未読は放棄済みとして cursor を進め、ログには残す。テスト `src/hub/mailbox.test.ts` の「流し込み量の制御」
  - shim は未読より先に省略件数を channel 通知 1 件 (`from: "hub"`) で伝える。テスト `src/shim/shim.test.ts` の「attach で古い未読が省かれたとき」
- [x] 無編集転送 (`/messages/:id/forward`) と UI ボタン (2026-10-17)
  - 手本は Relay の画面 (README「発想の元」)。向き付きの組 (A → B) ごとに未送の件数を出し、N 件をまとめて選んで運ぶ
  - 人間の添え書き (例「この方針をレビューして」) は本文と分けて持ち、本文は無編集のまま運ぶ
  - 本文・kind・replyTo・meta を写し、本文の書き手を `forwardedSender` (channel では `forwarded_sender`) に分けた。添え書きは別のメッセージとして先に送る (protocol.md §2)。テスト `src/hub/app.test.ts` の「POST /messages/:id/forward」と `src/shared/shared.test.ts`
  - 別の Hub (ポート 7795) と headless Chrome で、deployer の 2 件を選んで添え書き付きで leader へ送り、添え書き → 転送 2 件の順に記録され、本文 (`</channel>` を含む) が元と一致し、leader の未読が 3 増えること、Relay に `deployer → leader · up to date`、deployer の新着で `1 new` が出て押すとその 1 件が選ばれること、Reply で選択が外れることを確かめた (受け入れ条件 5)
  - 実セッションで、受け手のエージェントが `forwarded_sender` を書き手として読むかは未確認 (C3)
- [x] `inbox()` による polling 経路 (Claude Code 以外向け。`events/poll` 互換の応答)。全クライアント共通の「中身を渡す」経路になる (design.md §3.9。2026-10-17)
  - Hub の `GET /mailboxes/:name/inbox` は読むだけで、既読にするのは ack。shim の `inbox` ツールが取得 → 画像の `path` → ack → 文面の順に行う (protocol.md §3、§5)。テスト `src/hub/app.test.ts` の「GET /mailboxes/:name/inbox」、`src/shim/shim.test.ts` の「inbox ツール (fetchInbox)」と「channel で届いて ack された分は inbox に出ない」
  - 本文を包む書式 (`<hub-message>`) と注意書きの構造をテストで固定した (`src/shared/shared.test.ts` の `toInboxText`、protocol.md §6.2)。配送を公式に移す場合 (§9-5) も同じ書式で送り手の属性を分ける (design.md §8.3-3、§8.4)
  - 実セッションで、Claude Code 以外のクライアント (Codex など) が `inbox` を呼び、注意書きどおりに本文をデータとして扱うかは未確認 (C3)
- [x] 配送の状態を、確かめられる範囲で名付ける。「Hub が渡した」「クライアントが表示した」と「エージェントが受領を返した」を分け、「モデルが読んだ」とは主張しない (design.md §8.4。2026-10-18)
  - queued / handed / received の 3 つにした (protocol.md §4)。「クライアントが表示した」は Channels では確かめられない (§6.1k) ので名付けない。cursor は handed で進め、受領の確認は別のウォーターマーク `received` に持つ (design.md §3.7 の決定)
  - received になるのは `inbox` で返した分と、`replyTo` で返信した Message まで。UI のカードに `N handed, unconfirmed` を出し、`inbox` の `unconfirmed: true` で取り直せる
  - テスト `src/hub/store.test.ts` の「受領の確認 (received)」、`src/hub/mailbox.test.ts` の「受領の確認 (received / unconfirmed)」、`src/shim/shim.test.ts` の「inbox ツール (fetchInbox)」
  - 別の Hub (ポート 7795) と headless Chrome で、handed の 2 件がカードに `2 handed, unconfirmed` と出て、`received` 付きの ack の後に `mailbox.acked` で消えることを確かめた
- [x] 他のプロジェクトで使う: エージェントはプロジェクトのルートで起動する (design.md §3.3。2026-10-18)
  - `HUB_ROLE` だけのときの Mailbox 名の既定を `<フォルダ名>.<role>` にした (別のプロジェクトの同じ role が同じ Mailbox で takeover しないため)。`role:` 宛ての絞り込みは下の項目で決めた (design.md §9-7)
  - Mailbox に `project` (attach の `cwd`) を記録し、UI のカードに出す。前回と違うフォルダからの attach は `projectChanged` で警告する (拒まない)。テスト `src/hub/mailbox.test.ts` の「project (attach の cwd)」、`src/hub/store.test.ts` の「復元」、`src/shim/shim.test.ts` の `defaultMailboxName` / `normalizeProjectPath`
  - `start-agent.ps1` / `start-team.ps1` に `-Project` を足した。そのフォルダで起動し、shim は絶対パスで指し、同じ規則の Mailbox 名を `HUB_MAILBOX` で渡す。hook の設定がなければ警告する
  - 別の Hub (ポート 7795) と headless Chrome で、カードに `Project: <フォルダ名>` と、違うフォルダからの attach の警告が出ることを確かめた。PowerShell 5.1 / 7 で名前の規則が shim と一致することを確かめた
  - 2026-10-18 に vcp で leader / deployer を起動し、`vcp.leader` / `vcp.deployer` が vcp の project で attach することを確かめた (hook は vcp の `.claude/settings.local.json` に写した)
- [x] `role:` 宛てをプロジェクトに絞り、UI をプロジェクトで絞り込む (design.md §3.2、§9-7 の決定。2026-10-18)
  - Address に `project` (role 宛てだけ) を足した。エージェントの `role:` 宛ては Hub が送り手の project で絞り、ブラウザはプロジェクトを選んでいるときだけ付ける
  - UI: サイドバーの `All projects` / プロジェクトの選択で、カード・Message・Event・宛先の候補を絞る。All projects ではカードをプロジェクトごとにまとめる。ほかのプロジェクトの質問待ち・許可待ちの数を出す。古い Hub が project を落としたら警告する
  - テスト `src/hub/mailbox.test.ts` の「role 宛てのプロジェクトの範囲」。別の Hub (ポート 7795) と headless Chrome で、絞り込み・`role:deployer @ vcp` での送信 (保存された `to.project`)・ほかのプロジェクトの待ちの数・Compact の後に All へ戻したときの時刻の順を確かめた
- [x] Message の保存期間と手で消す操作 (design.md §3.14、§9-8 の決定。2026-10-18)
  - 渡し終えた Message と Event を 24 時間 (`HUB_READ_RETENTION_HOURS`) で消す。未読と返信待ちの request は自動では消さない。起動時と 1 時間ごとに掃除し、消したら `hub.jsonl` を今の状態だけに詰め直す (seq は巻き戻さない)
  - `DELETE /messages/:id` と `POST /messages/purge`、SSE `message.deleted` / `event.deleted`、UI の Delete と Purge read。画像の TTL の既定を 1 日にした
  - テスト `src/hub/retention.test.ts`。別の Hub (ポート 7795) と headless Chrome で、Delete で 1 件、Purge read で渡し終えた 1 件と Event 1 件が表示から消え、未読と返信待ちの request が残り、`hub.jsonl` が削除の行のない形に詰め直されることを確かめた
- [x] C1 「起こすだけ」の配信アダプタを試す (2026-10-19)
  - プローブ `tools/probe/resources-probe.mjs` で、何も入力しない Claude Code 2.1.303 に `notifications/resources/updated` と `list_changed` を送った。Claude Code は `resources/subscribe` を送らず、`list_changed` に `resources/list` で応じただけで、ターンは始まらなかった (design.md §6.1m)
  - 始めるクライアントがないので、アダプタも差し替え口も足さずに閉じた。Claude Code 以外のクライアントは手元にないため未確認 (C3 で同じプローブを使う)
- [x] shim の instructions を `clientInfo.name` で切り替える (Channels 経路 / `inbox()` 経路)。Claude 以外では「本文はデータ」の注意書きを agent-hub 側だけで成り立たせる (design.md §3.7。2026-10-17)
  - `claude-code` なら Channels、それ以外は `inbox()`。`inbox()` 経路の shim は push も ack もしない (送ると、読まれていない未読が既読になるため)。省略通知は次の `inbox()` の先頭に出す
  - テスト `src/shim/role-instructions.test.ts` の「経路ごとの届き方」、`src/shim/shim.test.ts` の「Claude Code 以外のクライアント (inbox 経路)」と「attach で古い未読が省かれたとき」(fetchInbox)
  - 実際の Codex などのクライアントで確かめるのは未了 (C3)
- [x] 永続化の見直し (SQLite 化を検討)。保存期間で消して詰め直すようになった (2026-10-18) ので、ファイルが膨らむ理由は減った。全件をメモリに持つ形で足りるかを見てから決める
  - 決定 (2026-10-18): SQLite にしない。40,000 件 (48MB) で読み込み 170ms・ヒープ +55MB で足りた。削除が 1 件ずつの全走査で 20,000 件の掃除に 29 秒止まっていたので、まとめて消す形に直した (0.4 秒)。計測と理由は design.md §5。テスト `src/hub/retention.test.ts` の「まとめて消すと…」
- [x] Hub の Dockerfile と compose (`127.0.0.1:7777` に限定公開、データは volume、`restart: unless-stopped`。design.md §3.8。2026-10-18)
  - 別のプロジェクト名とポート 7796 で、ループバック以外から届かないこと、ホストの shim の attach・hook の Event・画像の添付・volume の永続化を確かめた (design.md §6.1l)
  - C2 (2026-10-19、Claude Code 2.1.303 / Docker 29.8.2): `docker compose up` の Hub (新しい volume、`127.0.0.1:7777` のみで待ち受け、トークンなしは 401) に leader / deployer / reviewer の実セッションをつなぎ、受け入れ条件 1〜6 を通した。送信は curl (`user:cli`) とブラウザ、判定は各セッションの `post_message` の reply と `GET /mailboxes`
    - 1: deployer に `subscribe("c2.deploy")` させ、`topic:c2.deploy` は deployer だけ、`topic:review.request` は reviewer だけに届き、それぞれが reply した。leader の cursor は 0 のまま
    - 6: reviewer は `subscribe` を呼ばずに role の既定購読 (`review.request`) と `role:reviewer` 宛てを受け取り、deployer には届かなかった
    - 2 / 4: 未読の上限を一時的に 3 にした override (`HUB_UNREAD_MAX=3`) で起動し、deployer を `/exit` した間に 5 通送り、同じ Mailbox で起動し直すと新しい 3 通が届き、省いた 2 件は通知 1 件で伝わった (reply に `omitted=2`)。cursor と received が最後まで進んだ
    - 3: reviewer に `c2.review` を購読させた後、開いたまま 2 つ目の reviewer を起動すると、`GET /mailboxes` に `takeover` (前の Attachment) が記録され、新しいセッションに `topic:c2.review` と `role:reviewer` 宛てが届いた。切り離された側の `post_message` は superseded のエラーを返し、Hub に記録されなかった
    - 5: ブラウザで deployer の reply 2 件を添え書き付きで leader へ Forward し、添え書き → 転送 2 件の順に記録され、本文・kind・`replyTo` が元と一致し、`forwardedSender` に deployer が入った。leader は 2 件の書き手を `mailbox:agent-hub.deployer (role: deployer)` と答えた (C3 の材料)
- [x] C2 compose の Hub に対して、実セッションで受け入れ条件 1〜6 を通す (2026-10-19。記録は上の Dockerfile の項目)
- [ ] C3 Check real clients other than Claude Code, and how receivers read
- [ ] C4 Connecting the storage of what was learned at breaks to engram (optional)
- [x] C7 項目の索引と規則の検査 (2026-10-19、design.md §3.15)
  - `src/shared/roadmap.ts` の `parseRoadmap` が項目 (ID・題・状態・完了条件の進み具合・行) と、節の外の `[ ] C<n>` / `[x] C<n>` を取り出す。Node の API に依存しないので、ブラウザでも使える (C8)
  - `checkRoadmap` は、見出しの形、ID の重複、状態の語彙と位置、ブロックの理由、決定の項目の `#### 完了条件`、`[ ] C<n>` の指す節の有無、節が残っている `[x] C<n>` を error にし、完了条件が全部埋まった項目を warning にする
  - `npm run docs:check` で回し、error があれば exit 1。`-- --index` で索引を JSON で出す。テスト `src/shared/roadmap.test.ts` (このファイル自身が規則どおりであることも含む)。項目の ID・状態・見出しを崩したコピーで exit 1 と行番号つきの指摘を確かめた
- [x] C6 溜まりのバッジ (2026-10-19、design.md §3.15 の「実装」)
  - Hub は `GET /mailboxes` に `backlog` (未読・返信待ちの request・確認待ちを重ならない形で、件数と最も古い ts) を足した。テスト `src/hub/mailbox.test.ts` の「溜まりの材料 (backlog)」
  - UI はカードとサイドバーに `You` / `Agent` / `Stuck?` の件数と最も古いものの経過時間を出し、経過時間で色を変える (30 秒ごとに塗り直す)。タブのタイトルに `N waiting`、favicon に人が動く番の件数を出す
  - 別の Hub (ポート 7795) と headless Chrome で、2 つのプロジェクトの 4 つの Mailbox の層の振り分けとサイドバーの合計、プロジェクトを選ぶとサイドバーが絞られタイトルは全体のままなこと、返信で `Agent`・回答で `You` とタイトルの waiting が消えること、経過時間を 15 分前 / 3 時間前にしたときの色、`backlog` (と `unread` / `unconfirmed`) を外した古い Hub の応答で件数だけが出てページのエラーがないことを確かめた
- [x] C8 項目のカードと依頼の下書き (2026-10-19、design.md §3.15 の未決 2・3 の決定)
  - 索引: `npm run docs:index` が `parseRoadmap` の結果を `PUT /indexes` で送り、Hub は `indexes.json` に写しとして持つ。`parseRoadmap` に完了条件の文言 (`conditionTexts`) と約束の指紋 (`promise`) を足した。テスト `src/hub/indexes.test.ts`、`src/shared/roadmap.test.ts` の「完了条件の文言と約束の指紋」
  - UI: サイドバーの Items に 1 行のカード (ID・題・状態・進み具合・requested / reported)。押すと `GOAL` / `DONE WHEN` の下書きになり、送る request の `meta.item` に項目と送った時点の約束を付ける (Unlink で外せる)。完了条件の文言が変わると、カードに `-` / `+` の差分を出す
  - 別の Hub (ポート 7795) と headless Chrome で、一時フォルダのプロジェクトの roadmap を送ってカードが出ること、プロジェクトの絞り込み、下書きの本文と送った `meta.item`、`requested` → 返信で `reported`、チェックを付けて送り直しても差分が出ず文言を変えると出ること、Unlink で `meta.item` なしになること、`/indexes` が 404 の古い Hub で欄が出ずエラーもないことを確かめた
- [x] C26 登録した roadmap のプロジェクトを、エージェントがつながる前から使えるようにする (2026-10-20、design.md §3.15 の「プロジェクトは値」)
  - 別の Hub (ポート 7795) で新規プロジェクトを通すと、`docs:index` で登録しても UI のプロジェクトの一覧に出ず、Mailbox がないので `role:` 宛てを選べず、登録を外す手段もなかった
  - UI のプロジェクトの一覧を Mailbox と索引の project の和にした。前回の選択は両方の一覧が届いてから戻す。Mailbox のないプロジェクトには起動の仕方 (`start-agent.ps1 -Project`) を出す
  - Hub に `GET /roles` (roles.json の role) を足し、プロジェクトを選んでいれば Mailbox がなくても `role:<r> @ <project>` を候補にする (All projects では足さない。`/roles` が 404 の古い Hub では今までどおり)。`DELETE /indexes` と SSE `index.deleted`、Items の Remove を足した (protocol.md §3、§7)
  - テスト `src/hub/roles.test.ts` の「GET /roles」、`src/hub/indexes.test.ts` の「DELETE /indexes」、`src/hub/mailbox.test.ts` の「Mailbox のまだないプロジェクトの role 宛て」
  - 別の Hub (ポート 7795) と headless Chrome で、2 つの一時フォルダの roadmap を送るだけで一覧に出ること、選ぶと Items と宛先が絞られ `role:deployer @ newproj` などを選べること、項目のカードから送った request の `to.project` と `meta.item`、読み込み直しても Mailbox のないプロジェクトの選択が戻ること、後で attach した `newproj.deployer` の未読が 1 になること、`/roles` を 404 にすると role の候補が出ないこと、Remove で Mailbox のない other が一覧から消えて All projects に戻り、Mailbox のある newproj は残ることを確かめた
- [x] C44 溜まりのバッジから、その Message へ飛べるようにする (2026-10-27、ユーザーの依頼)
  - `GET /mailboxes` の `backlog` の溜まり (`unread`・`awaitingReply`・`unconfirmed`・`outgoing`、`outgoing.to` の宛先ごとも) に `oldestSeq` を足した (protocol.md §3)。カードの `You` / `Agent` / `Stuck?` を押すと、数えた中で最も古い Message (質問・許可待ちは Event) へ飛び、しばらく強調する (design.md §3.15)
  - テスト `src/hub/store.test.ts` の「oldestSeq は溜まりの最も古い Message の seq で…」、`src/hub/mailbox.test.ts` の「返信待ちが 2 件あるとき oldestSeq は…」と「古い方の依頼だけが閉じるとき (C44)」(返信で閉じる場合と、後の依頼で閉じる場合の両方)、既存の backlog の試験を `oldestSeq` 込みに直した。`npm test` は 316 件すべて通る
  - 別の Hub (ポート 7793) と headless Chrome の `npm run ui:check` に、5 日前の返信待ちの依頼を持つ `demo.old` の `Agent 1 · 5d` を押すと、その依頼が見えて強調される場面を足し、通した
  - 2026-10-27 にユーザーが承認した (leader に届いていなかっただけ): (1) `oldestSeq` を `outgoing.to` の宛先ごとにも残す (2) 完了条件の「種類の絞り込み」は、UI に種類の絞り込みがないのでプロジェクトの絞り込みとして扱う
  - 未確認: 絞り込みで隠れた場合・畳んだ範囲の中・You バッジ (質問・許可待ちの Event、人宛ての request)・Stuck? バッジは ui:check で流していない (C48)。C48 で確かめた (2026-10-27)
- [x] C45 reviewer の作法を決め、レビューを対象と問いで依頼できるようにする (2026-10-27、ユーザーの依頼)
  - `tools/dev/roles/reviewer.md` (依頼は対象と問い、何を読むかは reviewer が決める、返事は FINDINGS と PROPOSED CONDITIONS)、`leader.md` (reviewer への依頼、完了条件の提案は人が承認するまで変えない)、design.md §3.12 の表の reviewer 行
  - `start-agent.ps1 -Role reviewer` の dry run で、reviewer.md が system prompt に入ることを確かめた
  - 実チームで確かめた (design.md §6.1u): TARGET と QUESTION だけで依頼した reviewer が、依頼に書かれていない正本を自分で読んで照らした。起票したばかりの C48 の完了条件を、訂正案 → 人の承認 → 直す、の一周で通した

- [x] C48 C44 で未確認だった溜まりのバッジの 3 場面を ui:check に足す (2026-10-27、leader の依頼。完了条件は 2026-10-27 に承認された文言のまま)
  - `jumpTo` (public/index.html) は、畳みを開く前に今の絞り込みで隠れているかを見る。隠れていれば、畳んだ範囲の中にあっても開かず、ステータスに隠れていると (All projects で出せると) 出してスレッドは動かさない
  - `npm run ui:check` に場面を 6 つ足した: 隠れた依頼 (畳みの外・畳みの中)、畳みの中の隠れていない依頼 (畳みが開き、表示範囲に入って強調される)、You (人宛ての request が古い場合・質問の Event が古い場合)、Stuck? (未接続の Mailbox の未読)。すべて通る
  - 畳みの中で隠れた場面は、修正前の `jumpTo` (HEAD の public/index.html) に差し替えると NG になることを確かめた (畳みが開いて失敗)
  - 隠れた Message を指すバッジは、今の数え方 (`messageInProject`) では見当たらなかった。隠れた場面は、バッジと同じ形の t を `jumpTo` に直接渡して確かめた
  - `npm test` 318 件すべて通る
- [x] C51 予定の一覧を台帳の共通の作法にし、予定の答え方を決める (2026-10-27、ユーザーが決定。design.md §3.15)
  - 冒頭の規則に 3 点を書いた (`## 予定` の一覧、状態の分け方、閉じた行の日付) と、予定の答え方を書いた。skill `roadmap-items` に予定の一覧と 4 段の答え方を書き、CLAUDE.md の地図の roadmap.md の行から指した
  - `parseRoadmap` が `plan` (予定の並び。見出しがなければ null) と `closed` (ID・`x` か `-`・日付) を返す。`checkRoadmap` が次を error にする: 項目があるのに `## 予定` がない、決定の項目が予定にない、予定に提案・保留や節のない ID がある、理由のない保留、日付のない閉じた行
  - 試験 `src/shared/roadmap.test.ts` で各場面を確かめた。`npm test` 326 件すべて通る。`npm run docs:check` は 0 errors
  - agent-hub の roadmap を規則に合わせた: `## 予定` を置き、C35・C46・C47 を `保留(…)` にした。閉じた行は全部日付を持っていたので足していない
  - 完了条件の「C38 を `ブロック(次の usage limit に当たるまで)`」は、2026-10-27 のユーザーの決定で `保留(次の usage limit に当たるまで)` に変えた (外の出来事を待つため)。C19・C20 も同じ理由で保留にした
  - 予定は C52 だけになった。ブロックは他の項目を待つときだけ (理由に `C<n>`) と決まったため、C19・C20・C38 は予定から外れた (ユーザーの決定、2026-10-27)
- [x] C53 C51 の作法のレビュー指摘を直す (2026-10-27、reviewer の指摘 Message #204、ユーザーが決定。design.md §3.15)
  - 古い語彙 (design.md §3.15 の「状態は見出しの直後の 1 行」、CLAUDE.md の「ドキュメントの更新」、`roadmap.ts` のエラー文) を `提案 | 保留(再開の条件) | ブロック(C<n> の後)` に揃えた。roadmap 冒頭に、決まっていない項目の `保留(C<n> の後)` と、閉じた日は行末の括弧の先頭、を足した
  - skill `roadmap-items` を §3.15 に合わせた (予定の例は待つ項目が先、ブロックは決定の項目だけ、閉じた日の位置、答え方の細部、description に「予定・計画を聞かれたとき」)
  - `checkRoadmap` が次を error にする: ブロックが待つ項目より前に並ぶ、予定に同じ ID が 2 度ある、予定に `[ ]` でない行がある、`## 予定` が 2 つ以上ある、ブロックの待つ項目が閉じている、完了条件のないブロック。`parseRoadmap` の閉じた日は行末の括弧の先頭から読み、なければ error
  - 試験 `src/shared/roadmap.test.ts` で各場面と、題の中に日付がある閉じた行 (C25 の形) を確かめた。`npm test` 334 件すべて通る。`npm run docs:check` は 0 errors
  - C5 を却下 `[-]` にした (受け入れて手を付けない)。C3 の理由を再開の条件の形に直した。閉じた行の日付を行末の括弧の先頭に揃えた (C6・C7・C8・C26・C41)
  - C52 の完了条件の「予定のない索引では今の並びのまま出す」を、2026-10-27 にユーザーが承認して直した (約束の変更)
- [x] C52 Items を予定の 4 段で出し、索引を自動で送る (2026-10-27、ユーザーの依頼。完了条件の文言は承認された 2026-10-27 の版。C52 の「予定のない索引」の 1 行は 2026-10-27 にユーザーが承認して直した)
  - `docs:index` が `plan` (予定の並び) と `closed` (閉じた行) を送り (`src/docs-check/push-index.ts`)、Hub が索引に持って `GET /indexes` で返す (`src/hub/indexes.ts`)。送らない古い形は plan が null、closed が空。protocol.md §3 を合わせた
  - UI の Items を 4 段で出す (public/index.html の `tiersOf`): Plan (plan の並び。ブロックは `waits C<n>`)、Awaiting a decision (提案)、Parked (保留。既定で畳む)、Recently closed (日付の新しい 5 件。同じ日は行の順)。plan のない索引は、決定とブロックを番号順に Plan へ
  - 試験: `src/hub/indexes.test.ts` の「予定 (plan) と閉じた行 (closed) を持ち」「予定と閉じた行の形が違えば 400」。`npm run ui:check` の 2 場面 (4 段の並び・畳み・5 件の順、古い形の番号順) を通した
  - post-commit hook (`tools/hooks/post-commit-index.sh`) を、別のフォルダの作業ツリー (scratch の git リポジトリ。この repo の .git/hooks には入れていない) で git commit して確かめた: Hub が受けるとき plan と closed を含む PUT を 1 回送りコミットは成功 / Hub が 401 を返すとき・Hub が止まっているとき (届かない) はコミットは成功し、警告 1 行 / 台帳以外だけを変えたコミットでは送らない / `AGENT_HUB_DIR` がなければ何もせず成功
  - README に入れ方 (コピー、`AGENT_HUB_DIR` の書き換え、トークン) と、Items の 4 段を書いた。design.md §3.15 の未決 2 に決定 (post-commit を選ぶ理由) を書いた
  - `npm test` 336 件すべて通る。`npm run ui:check` は 40 件すべて ok。`npm run docs:check` は 0 errors
- [x] C54 項目をモーダルで開いて中身を見られるようにし、サイドバーの幅を変えられるようにする (2026-10-27、ユーザーの依頼。完了条件の文言は承認された 2026-10-27 の版)
  - `parseRoadmap` が完了条件の 1 行ずつのチェック (`conditionChecks`) を返し、`docs:index` が送り、Hub が索引に持つ (`src/hub/indexes.ts`)。送らない古い形も受ける。約束の指紋はチェックで変わらないまま (テスト `src/shared/roadmap.test.ts`、`src/hub/indexes.test.ts`)。protocol.md §3 を合わせた
  - Items のカードを押すと中身のモーダル (`openItemDialog`) が開く: 題・状態と理由・完了条件の 1 行ずつ ([x] / [ ]。古い索引は印なし)・依頼中 / 報告済・約束の差分。本文は出さない。Esc と閉じるボタンで閉じる。「Draft request」はカードの押し方と同じ下書き (`draftFromItem`)、「Open in editor」は `vscode://file/<project>/<source>:<line>` (パスは / に揃え、段ごとに符号化)
  - サイドバーの幅はつまみ (マウスと ← → キー) で変えられ、200〜520px に収める。幅は `agent-hub.sidebar` に覚える。読み書きは try/catch で囲み、保存値が数でなければ、範囲外なら既定の 260px
  - `npm run ui:check` の場面を足して通した (52 ok): モーダルの中身、Esc と閉じるボタン、下書き、チェックを送らない古い索引、リンクの形、サイドバーの幅 (広げる・上限・下限・読み直し・壊れた保存値・範囲外)
  - README の Items の使い方を、モーダルと 2 つのボタンに合わせた。`npm test` 337 件すべて通る。`npm run docs:check` は 0 errors (予定が空でも通る)
  - Hub のコードを変えた (索引のチェックの形)。compose の Hub は作り直しが要る

**Acceptance criteria**
1. Two Mailboxes subscribe to different topics and each receives only its own subscriptions.
2. Messages that arrived while a session was closed are resent to the next session that attaches to the same Mailbox (duplicates can be removed by id).
3. **Replacement**: when session A of Mailbox `reviewer` is `/clear`ed or ended and a new session B attaches to `reviewer`, B takes over the subscriptions and unread messages. If A is still connected, A is cut off, and the UI shows it.
4. Unread messages older than `maxAgeMs` are not handed over, and the agent is told the number omitted in one notice.
5. From the browser, one Mailbox's output can be forwarded unedited to another Mailbox.
6. **role**: a session started with `HUB_ROLE=reviewer` receives the role's default subscriptions and messages to `to: role:reviewer` without calling `subscribe`. The `deployer` Mailbox does not receive them.
7. 1-6 hold with the Hub started in compose too, and port 7777 cannot be reached from anywhere but the host.

## Known issues and deferred

- [x] **shim の seq 巻き戻し**: Hub の `data/` を消して再起動すると seq が 1 から振り直され、shim が前の Hub で覚えた seq を stream の `after` に使うため、attach 時の未読を黙って捨てていた。attach のたびに `after` を Hub の `cursor` から数え直すようにした (ack 漏れの再送は id で除去)
- [x] **未読の算出が全件走査**: `unread()` と `listMessages()` が毎回ログ全体を見ていた。ログは seq の昇順なので、二分探索で `cursor` (または `after`) の位置から見るようにした。長く ack しない Mailbox はその未読分だけ走査する
- [x] **detached の旧 shim が後継から Mailbox を取り返しうる**: A の stream が切れて猶予 (15 秒) を過ぎ `disconnected` になった間に B が attach すると、戻ってきた A の shim は stream の 404 で attach し直し、「新しい方が勝つ」で B を切り離す。A は superseded ではないので attach し直しを止める仕組みがない。ループバックで 15 秒以上戻れないのは稀なので後回し。対策の候補は、後継のいる Mailbox への attach で、前の Attachment ID を示した attach し直しを拒む、など (design.md §3.3 の takeover。2026-10-17 のレビューで発見)。2026-10-18 にその案で対応した (attach の `previous` と 409 `successor_attached`。テスト `src/hub/mailbox.test.ts` の「切断中の後継 (previous)」、`src/shim/shim.test.ts` の「HubClient: 切断中に後継が attach したとき」)。Hub の再起動と重なった場合は見分けられない
- [-] C5 **channel なしで起動した Claude Code の通知を ack してしまう** (却下 2026-10-27、受け入れて手を付けない。起動手順で channel を付ける前提)
  - `clientInfo.name` は `claude-code` のままなので Channels 経路になり、Claude Code が通知を捨てても shim は ack する (未読が既読になる)。2026-10-18 に、通知が黙って捨てられること、initialize・環境変数・要求の並びに channel の有無の違いがなく shim から見分けられないことを確かめた (design.md §6.1k)。配送の状態を分けた (2026-10-18) ので、捨てられた分は handed のまま UI に unconfirmed として出て、`inbox` の `unconfirmed: true` で取り直せる。自動では取り戻さない (design.md §3.7)。
- [x] C21 **切り離されたセッションが、新しい方を閉じれば戻ると誤って案内した** (2026-10-19)
  - C2 の takeover で、superseded のエラーを受けた reviewer がそう案内した。実際には切り離された shim は attach し直さない
  - 文面を `SUPERSEDED_NOTE` (`src/shim/main.ts`) の 1 か所に置き、`whoami` 以外のエラーと `whoami` の `note` に使う。再接続しないこと (新しい方を閉じても戻らない) と、使い続けるなら起動し直すこと (今つながっている方が切り離される) を書いた (protocol.md §5)。テスト `src/shim/shim.test.ts` の takeover の項
  - compose の Hub (7777) で reviewer を 2 つ起動し、切り離された側に `user:browser` 宛ての notice を頼むと、「自動では再接続しない、新しい方を閉じても戻らない」と答え、今つながっている方から送るか起動し直すかの 2 つを案内した
- [x] C25 **C6〜C8 のレビュー (2026-10-19、`eb11699~1..HEAD`) で出た小さな誤りを直す** (2026-10-20)
  - 字下げした `状態:` の行を決定と取り違えていた。状態として読み、`docs:check` は字下げを error にする。テスト `src/shared/roadmap.test.ts` の「字下げした状態の行」
  - `IndexStore.put` が書く前にメモリを更新していた。書けてから更新する。テスト `src/hub/indexes.test.ts` の「ファイルに書けなければ」
  - UI の `loadIndexes` が一時的な失敗でカードを全部消していた。404 以外では前の索引を残す。別の Hub (ポート 7795) と headless Chrome で、CDP で `/indexes` に 500 を返させてもカード 19 枚が残ってエラーが出ること、404 では欄が消えることを確かめた
  - `docs:check` が `process.exit` で止まり、パイプで出力が欠けうる。`exitCode` を置いて自然に終わる。`--index` をパイプで読んで JSON として解釈できること、error のある roadmap で exit 1 になることを確かめた
  - `GET /mailboxes` が Mailbox ごとにログ全体を走査していた。Store が返信待ちの request を別に持ち、`summary` が received より後と返信待ちだけを見て未読数・確認待ち数・backlog を 1 度に数える。テスト `src/hub/store.test.ts` の「溜まりの材料 (summary)」で、全件を走査した値との一致を確かめた
  - 配送の細部 (トピック・role 宛ての request で 1 人の返信が全員分の返信待ちを消す、接続のない Mailbox の返信待ちを `Agent` に数える) は直していない (design.md §3.16 で軽く扱うとしたもの)
- [x] **attach の `client` が常に `claude-code`**: shim は initialize より前に attach する (role の説明を取るため) ので、`inbox` 経路のクライアントでも `client: "claude-code"` で記録される。UI と `GET /mailboxes` の表示だけの問題。直すなら initialize の後に Attachment の `client` を更新する口を足す。2026-10-18 に対応: shim が initialize の後に `PATCH /attachments/:id` で `clientInfo.name` を送り、UI は `attachment.updated` で取り直す。テスト `src/hub/app.test.ts` の「PATCH /attachments/:id」、`src/shim/shim.test.ts` の「Claude Code 以外のクライアント (inbox 経路)」
- [x] **start-agent.ps1 が role の打ち間違いを起動時に止めない**: ValidateSet を外したので、`roles.json` にない role でも起動する。Hub は 400 `unknown_role` を返し、shim は attach を再試行し続ける。エラーは shim のログと `whoami` にしか出ない。`roles.json` に role があるかを起動前に確かめ、なければ claude を起動せず止めるようにした (2026-10-17 のレビューで発見。まとめて起動する `start-team.ps1` は 2026-10-18 に対応済み、`start-agent.ps1` は 2026-10-18 に対応)
- [x] C36 **project のない role 宛ての古い依頼が、新しいプロジェクトの Mailbox に流れる** (2026-10-22)
  - cite-bridge の deployer が最初の attach で、10-17 の vcp の P1 試験の request (#122、`role:deployer`、project なし) を受け取って実行した (design.md §6.1p)
  - `project` のない role 宛ては、送った時点でその role を持っていた Mailbox だけに届ける (protocol.md §2)。テスト `src/hub/store.test.ts` の「作成前の直接宛て・project つきの role 宛ては未読になるが…」
  - 今のログの写しを新しい Hub (ポート 7791) で読み、cite-bridge.deployer の返信待ちが今の依頼 1 件だけになる (前は 10-17 の分を含む 2 件・5d) ことを確かめた
- [x] C37 **カードに状態を出し、誰が動いているかを枠で示す** (2026-10-22、ユーザーの依頼)
  - Needs you / Working / Stopped, no reply / Waiting on others / Idle / Offline を、`backlog` の `lastHanded`・`outgoing` と hook の Event から UI が導く (design.md §3.15「カードの状態」、protocol.md §3)。サイドバーの上に状態ごとの数
  - テスト `src/hub/mailbox.test.ts` の「自分が出して返信のない request を outgoing に数え…」と、`store.test.ts` の summary の全件走査との一致
  - 写しのログで、cite-bridge の leader に outgoing 1、deployer に返信待ち 1 と lastHanded が出ることを確かめた。ブラウザでの見た目は、Hub を起動し直した後に確かめる
- [x] C34 返信なしでターンが終わった Mailbox を UI で目立たせる (2026-10-22、C37 の Stopped, no reply として入れた。C28 の誤った返信待ちが残る間は誤って出る)
- [x] C28 **返信のない request を、相手からの後の Message で閉じる** (2026-10-23、ユーザーが決定)
  - 返信待ちが `replyTo` の返信でしか解けず、読んで動いた request が残っていた。まとめた返信 (vcp の C147、design.md §6.1n)、前日の分 (C142、§6.1o)、人が質問に新しい依頼で答えた・続けて出した依頼の後の方にだけ返信した (cite-bridge の #196〜#200。カードが `Waiting on others (browser)` と Stopped に残る)
  - request R は、R の受け手から R の送り手への後の request か reply で閉じる。notice・無編集転送・R の送り手自身の Message では閉じない。閉じたことはログの順から導き、詰め直しでは `replied` の行に書く。送った Mailbox に渡してあった分は、その seq まで受領の確認にする (protocol.md §2・§4)。`backlog.outgoing.to` を足し、UI の Waiting on others の宛先に使う (人宛ては `you`)。1 つの相手に並行して出した依頼は早く閉じる (design.md §3.15)
  - テスト `src/hub/mailbox.test.ts` の「相手からの後の Message で request を閉じる」(#196〜#200 の形、まとめた返信と role 宛て、notice・転送・同じ向き、渡す前)、`store.test.ts` の「再起動と詰め直しの後も閉じたまま」。人から人宛ての request が人の後の Message で閉じるのを `retention.test.ts` が見つけ、送り手自身の Message を除いた。全体で 304 件が通る
  - 今のログの写しを #200 までで切って別のポート (7792) の Hub で読み、cite-bridge.leader の返信待ちが 0 (#196 は #197 で閉じる)、outgoing が `role:deployer` 宛ての 1 件だけ (#197 は #198 で閉じる) になることを確かめた。#202 まで含む写し (7791) でも #197 は閉じ、今動いている Hub (前のコード) では outgoing に残っている
  - 報告に受領の確認が付かない形は C39 に分けた
  - 起動し直した Hub (2026-10-23 00:43 JST) で、leader の outgoing が 0 になった (#197 が閉じた)。leader が #203「commit and push」に返信 (#204) した後、ブラウザで 2 つのカードが Idle (枠の強調なし) で、溜まりのバッジもないことを見た (#201 の `Stuck?` は #204 の返信で確認になった)。Working と Waiting on others の見た目は、C40 の確かめ (ヘッドレスの Chrome) で見た
- [x] C39 **受領の確認を、送り手のやりとりの 1 つの規則にまとめる** (2026-10-23、ユーザーが決定。経路を 1 つにまとめる指摘つき)
  - やりとりの Message (request か reply。notice と無編集転送を除く) の判定を Store の `isExchange` の 1 か所に置いた。C28 の閉じる規則と受領の確認は、どちらもこの判定を使う。やりとりの Message を送ると、送り手に渡してあった分 (`cursor` まで) をすべて確認にする。`replyTo` と C28 の個別の確認は消した
  - 確認を進める経路は、やりとりの Message (`Store.appendMessage`)・`inbox` の ack・attach の放棄の 3 つ。Hub は 3 つとも `acking` を通して `mailbox.acked` を流す (protocol.md §4)
  - テスト `src/hub/mailbox.test.ts` の「request か reply を送ると、そのとき渡してあった分まで受領の確認になる」(notice では進まない、渡す前は未読のまま) と「報告 (reply) を受けた leader が次の依頼を送ると、報告が受領の確認になる」。返信で notice まで確認になるので、溜まりの材料の試験の期待を直した。全体で 306 件が通る
  - 限界: channel なしで起動したセッションがやりとりの Message を送ると、捨てられた分も確認になる (design.md §3.7、C5)
- [x] C40 **エージェントが Hub で人に出した request を、Needs you に出す** (2026-10-23、ユーザーが決定)
  - `backlog.outgoing.to` が宛先ごとに件数と最も古い ts を返す (protocol.md §3)。テスト `src/hub/mailbox.test.ts` の「人宛ての request を宛先ごとに数える」
  - UI の人が動く番を `humanTurnOf` の 1 つにまとめた (前は同じ式が 3 か所にあった)。材料は hook の質問・許可待ちと `outgoing.to` の人宛て。カードの状態 (Needs you)・溜まりのバッジ (You)・タブのタイトルと favicon・ほかのプロジェクトの待ちの数がそれを使う。Waiting on others の宛先から人宛てを除いた
  - 別のポート (7793) の Hub とヘッドレスの Chrome で、API で場面を作ってカードの DOM を読んだ。leader が人に尋ねてターンを終えると `Needs you (request)` (`st-you`)、タブは `1 waiting · agent-hub`、バッジは `You 1`。人が新しい依頼で答えると Working (質問は C28 で閉じる)。leader が deployer に渡すと leader は `Waiting on others (deployer)`、deployer は Working。報告が戻って leader が返すと、2 人とも Idle でバッジもない
  - design.md の判定順 (Stopped → Waiting on others、Offline が最後) がコード (Offline が先頭、Waiting on others → Stopped) と違っていた。コードの順が正しい (返事を待つ間は止まっていない) ので、文書を直した (§3.15)
- [x] C41 **C36〜C40 のレビュー (`7bb1a8d..3aa8c83`) で見つけた弱いところを直す** (2026-10-23、ユーザーの依頼)
  - `GET /mailboxes` のたびに、`lastHanded` を求めるためログを後ろから走査していた (何も受け取っていない Mailbox ではログ全体)。summary の「ログ全体は走査しない」に反していた。前に求めた cursor より後だけを見直す形にした。覚えた Message が消えたときと、宛先の判定が変わる記録 (role・project・購読) の後は求め直す。テスト `src/hub/store.test.ts` の「最後に渡した Message は、cursor が進んだ分だけ見直しても全件の走査と同じ」
  - 詰め直したファイルを読むと、閉じる request (C28) を今の Mailbox の role や project で導き直し、動いていたときには閉じなかった request まで閉じえた。詰め直しの先頭の `seq` の行に `answered` を付け、その分は導き直さない。テスト「詰め直したファイルでは閉じた request を導き直さず…」(直しを外すとこの試験だけが落ちることを確かめた)
  - UI の最新の Event とターン終了が、最初に読む最近の 200 件の窓に頼っていた。Hub が Mailbox ごとの最新の Event とターン終了を持ち、`backlog.lastEvent` / `lastTurnEnd` で返す (superseded を除く。消したら残りから求め直す)。UI は手元のものと新しい方を使い、Event が消えたら一覧を取り直す。テスト「Mailbox ごとの最新の Event とターン終了を返し…」
  - 起動し直した後も、前のセッションのターミナルの質問・許可待ちが Needs you に残った (新しいセッションが最初のターンを終えるまで)。今の接続より前に別のセッションが出した分は、人が動く番に数えない。session_id の違いだけで外すと、`/clear` で session_id が変わった後の本物の質問まで落としうるので、接続の時刻と合わせて見る (`/clear` の挙動は未検証。design.md §6.2-7)
  - Hub の `acking` が送り手の Mailbox を必ず求めていたので、Mailbox が見つからないと送信が 404 で落ちえた。見つからなければ知らせだけを省く
  - この確かめを `npm run ui:check` (`tools/dev/ui-check.mjs`) にした。場面を作り、カードの状態とタブのタイトルを期待と照らして、外れたら exit 1。直す前の UI では下の (5)(6) が外れて exit 1 になることを確かめた。CLAUDE.md に、UI を変えたら流すことを書いた
  - 別のポートの Hub とヘッドレスの Chrome で、C40 の 4 つの場面に 2 つを足して DOM を読んだ。(5) ほかの Mailbox の Event 250 件で leader のターン終了を窓から押し出して読み直すと、直す前の UI では 2 人とも `Working?`、直した UI では `Idle`。(6) leader がターミナルで質問すると `Needs you (question)`、別のセッションが attach すると `Idle`、その後に session_id の違う質問が出ると `Needs you (question)`。全体の試験は 309 件が通る
- [x] C42 **返事の型で判断と作業を分け、UI で見出しを色分けする** (2026-10-23、ユーザーの依頼)
  - leader の `要対応` に作業の確認と判断が混ざり、`commit and push` だけの返事で判断まで既定に落ちた (cite-bridge の C4・C6)。leader → user を `結果` / `確認` / `未確認` / `要判断` / `要操作` にし、要判断には番号と「答えがないときの既定」を付ける。答えのないまま次の指示が来たら、既定を採ったことを項目の記録に書く (`tools/dev/roles/leader.md`)
  - UI は本文の行頭の見出しを太字にし、要判断の節を琥珀の地色と左の線、要操作の見出しを琥珀、未確認と `NOT VERIFIED` を赤で出す (`bodyOf`)。中身が「なし」の節は目立たせない。本文は変えない。前の型の `要対応` も要判断と同じに出す (design.md §3.15)
  - `npm run ui:check` に、型どおりの返事で要判断 2 行・未確認 1 行・見出し 5 つが色分けされる場面を足した (10 場面すべて合格)。ライトとダークのスクリーンショットで、要判断の地色と見出しの色が読めることを見た
  - leader.md は起動時に `--append-system-prompt-file` で読むので、動いているセッションには次の起動から効く
- [x] C31 カードの `Last event` に日付がない (2026-10-24、ユーザーが決定)
  - `public/index.html` の `time()` を、今日なら時刻だけ・今日でなければ日付つきにした。カードの Last event・Message・Detached などが同じ関数を通る。`npm run ui:check` に前日 (26 時間前) の時刻に日付が付く場面を足した (11 場面すべて合格)
- [x] C29 起動スクリプトで権限モードを渡す (2026-10-26、ユーザーが決定。role ごとの既定は持たせない)
  - `start-agent.ps1` / `start-team.ps1` に `-PermissionMode` を足した。指定したときだけ `claude --permission-mode <値>` を渡し、省略時は何も渡さない (`start-team.ps1` は各タブの `start-agent.ps1` へ引き継ぐ)。`claude` を引数を表示する代役に差し替えて、指定あり (`--permission-mode default` が入る) と省略 (入らない) の両方を確かめ、`--add-dir` が最後のままなことも見た。README に使い方と、手で `manual` にする方法との関係を書いた
- [x] C33 起動し直した直後に、start-team が前の接続を「attach した」と読む (2026-10-26、ユーザーが決定)
  - `start-team.ps1` が起動前の Attachment の `attachmentId` を覚え、別の id が現れてから「attach した」と出す。上限までに現れなければ失敗の警告を出し、最後に終了コード 1 で終わる。実機で確かめた: 前のセッションを模した Attachment (heartbeat でリースを保った) を残して `-Force -AttachTimeout 20` で起動すると、このとき NVM4306 で claude が起動しなかった本物の失敗と重なり、21 秒待って「失敗」と出て終了コード 1 になった (旧実装なら残った Attachment を見て即座に「attach した」と出る場面)。NVM を直した後の起動では、7 秒で新しい `attachmentId` (client `claude-code`) が現れ「attach した」と出て終了コード 0 になった。README の起動の手順も直した
- [x] C30 許可した後に、許可待ちが解けたことが分からない (2026-10-26、ユーザーが決定)
  - `PostToolUse` / `PostToolUseFailure` を全ツールで登録し、同じ session の直前の Event が `permission` のときだけ `permission.resolved` として記録する (payload から `tool_response` と `tool_input` を落とす)。ほかは記録しない。UI は `approved` と出し、Needs you を解く。`npm run ui:check` に、許可を求める → 許可してツールが動く (Working) → もう一度求めて拒否する (Needs you のまま) の場面を足した (全場面が合格。全体の試験は 312 件が通る)
  - 実機 (compose の Hub、`-PermissionMode default` の reviewer、2.1.310): 1 回目を許可すると `permission` → 44 秒後に `permission.resolved` (`tool_name: Bash`)、2 回目を拒否すると 3 分以上何も届かず Needs you のまま (`idle_prompt` も来ない)。負荷は記録しない場合で中央値 3.6 ms・p95 5.3 ms (20 KB の payload)。1 MB を超える入力は 413 で hook のエラーになるだけ。許可待ちの間に並列の別のツールが先に終わると誤って解く穴が残る (design.md §6.1s)
- [x] C32 Hub の外で始まったターンで、返信を忘れる (2026-10-26)
  - deployer がバックグラウンドの試験を待ってターンを終え、完了通知で始まったターンで結果をターミナルに書くだけで leader に返さなかった (design.md §6.1o)。2026-10-21 に安い方の案で決め、`tools/dev/roles/deployer.md` に、どのターンで終わっても reply で返すこと (ターミナルに書くだけでは届かない) を書いた。Hub の側で止まりを目立たせる案は C34 に分けた
  - vcp の C150 の通し (compose の Hub、deployer は haiku・auto、2.1.310) で、deployer が全体の試験をバックグラウンドで流してターンを終え、約 4 分後の完了通知のターンで催促なしに reply を送った (design.md §6.1t)。そのとき `Stop` の `background_tasks` に走っている処理が載っていたので、カードの判定に使う案を C43 に分けた
- [x] C49 誰も接続していない宛先への依頼に、送ったエージェントも人も気づかない (2026-10-27、ユーザーが決定)
  - leader が起動していない reviewer に request を 2 件送り、返事を待ってターンを終え、人は止まった理由が分からなかった (#157・#160)。`POST /messages` と forward の応答に `unattached` (配信先のうち今接続していない Mailbox) を足し、shim の `post_message` は配信先が全部未接続なら `unattached` と `warning` を返す。leader.md に、その `warning` が返ったら待ってターンを終えず、`要操作` で相手の role の起動を頼むことを書いた
  - Hub は `backlog.outgoing.to` の宛先ごとに `recipients` を返し、UI は待っている相手がどれも接続していなければ `Waiting on others` の代わりに `Needs you (<Mailbox> not connected)` を出す。`humanTurnOf` には入れないので、You バッジには数えない (未読は相手のカードの Stuck? に出るため)。タブのタイトルと favicon には 1 件として数える (2026-10-27 に「カードだけに出す」と決めた点を、タブと favicon には数える形に変えた。ユーザーの決定、2026-10-27)。ほかのプロジェクトの待ちの数 (`N waiting in other projects`) も、タブと同じ `tabWaitingOf` で数える (同じくユーザーの決定、2026-10-27)
  - Hub の試験 (未接続の配信先が `unattached` に出る。forward も)、shim の試験 (全部未接続なら `warning`) を足し、全体の 318 件が通る。`npm run ui:check` に、leader が未接続の reviewer を待つ (`Needs you (demo.reviewer not connected)`) → reviewer が attach する (`Waiting on others (reviewer)`) → 返す (`Idle`) の場面を足し、全場面が合格。待っている間はタブのタイトルが `1 waiting` で始まることも確かめる。別のプロジェクトの leader が未接続の reviewer を待つ場面も足し、demo を選ぶと `1 waiting in other projects` が出ることを確かめる
- [x] C55 起動スクリプトが UI の URL をいつも出す (2026-10-28、ユーザーが決定)
  - `start-team.ps1` が最後に `.env` のトークンで `GET /mailboxes` を試し、通れば `UI: http://127.0.0.1:<port>/?token=…`、401 ならトークンが合わないこと (compose なら `docker compose logs hub`)、届かなければそう出す。compose の Hub (7777、起動済み) と、スクリプトが直接起動した Hub (7795、別のデータフォルダ) の両方で URL が出て、7795 の URL は 200 で UI の HTML を返した。間違ったトークンでは URL の代わりに警告が出た。README の起動の手順に、URL が出る場所を書いた
- [x] C56 claude が起動前に止まったことを、起動スクリプトがすぐ知らせる (2026-10-28、ユーザーが決定)
  - `start-team.ps1` が role の前に `claude --version` を流し、失敗なら出力の先頭を出してどの role も起動せず終了コード 1。`start-agent.ps1` は `claude` (と起動前の throw) で終わると、終了コード・経過秒・理由 (失敗なら `claude --version` の出力) を OS の一時フォルダの `agent-hub-start/<Mailbox>.json` に書く。`start-team.ps1` は起動前にそれを消し、attach を待つ間に現れたら待たずに失敗とする。`claude` を NVM4306 の文を出して失敗する代役に差し替えて確かめた: 代役が `--version` でも失敗すると起動前に止まり、`--version` だけ通すと 3 秒で「attach する前に claude が終わった (終了コード 5)。理由: NVM4306 …」と出て終了コード 1 (前は 60 秒待った)。タブの代わりに別ウィンドウ (wt なし) の経路で確かめた
- [x] C57 プロジェクトの hook の設定が無くなったことに気づく (2026-10-28、ユーザーが決定。一本化とカードに出す案は採らない)
  - 検査を `tools/dev/team-checks.ps1` の `Get-HookWarning` にまとめ、`start-team.ps1` は起動前に流して `--- まとめ ---` に出す。`settings.local.json` がなければ `tools/hooks/settings.json` を写す 1 行、あるのに Hub の hook がなければ上書きせず手で足すよう出す。`start-agent.ps1` の警告も同じ文。hook のある cite-bridge では出ず、ないフォルダ・空の `settings.local.json` のフォルダでそれぞれの文が出ることを確かめた
- [x] C58 起動するプロジェクトの checkout が古いとき警告する (2026-10-28、ユーザーが決定。警告だけで止めない。`docs:index` には足さない)
  - `Get-CheckoutWarnings` が `git fetch` (`GIT_TERMINAL_PROMPT=0`・`GCM_INTERACTIVE=never`・ssh は BatchMode、15 秒まで。時間切れは子の git-remote-https ごと `taskkill /T`) の後、detached HEAD (origin の既定のブランチとの差も)・upstream より遅れている・upstream が無い、を警告する。git のリポジトリでなければ黙る。`start-agent.ps1` は単独で起動したときだけ同じ検査をする (`start-team.ps1` は `-FromTeam` を渡す)。cite-bridge と agent-hub (private の origin) で入力待ちなしに 1.8 秒で通り、3 つ遅れた clone・detached の clone (2 つ遅れ)・upstream のないブランチ・届かない origin・応答しない origin (3 秒で時間切れ) のそれぞれで警告の文を確かめた。pwsh 7.6 と Windows PowerShell 5.1 の両方で同じ結果
- [x] C43 バックグラウンドの処理を待つターンの終わりを、Stopped と出さない (2026-10-28、ユーザーが決定。上限は 60 分、Stopped の代わりにだけ使う)
  - Hub は `backlog.lastTurnEnd.running` (`Stop` の `background_tasks` のうち `status: "running"` の件数と最初の処理の `description`) を返す。UI は返信のない依頼を抱えたカードで、最後の `turn.end` に走っている処理があり、その終了から 60 分以内なら Working と出し、要旨の行に `background: <description>` を出す。過ぎたら 30 秒ごとの見直しで Stopped に戻す (終わらない処理を立てたままのターンを Working に残さないため)
  - Hub の試験 (終わった処理は数えない、空になれば `running` を省く) を足し、全体の 337 件が通る。`npm run ui:check` に、試験をバックグラウンドで流して終えたターン (`Working`・`background: npm test`) → そのターン終了を Event の窓から押し出して読み直す (Hub の値で Working のまま) → UI の時計を 61 分進めると Stopped → 処理が終わったターンで返さない (`Stopped, no reply`) の場面を足し、全場面が合格。実機の Claude Code のターンでは見ていない (次にバックグラウンドの試験を待つ通しで確かめる)
- [x] C59 スレッドの絞り込みを 1 つのモジュールにまとめ、Compact も軸の 1 つにする (2026-10-29、leader の依頼)
  - 絞り込みを `FILTER`・`AXES`・`hiddenBy` の 1 つのモジュールにし、Project・Mailbox (複数選択)・Kind (Message の `kind` と Event の種類)・Noise (既定は `notification`)・Recent (Compact の印) の 5 軸を、述語の積で決める。Compact は DOM から外さず `data-compacted` の印を付け、同じ述語で隠す。stub は消し、`Filter ▾`・チップ (× で 1 つ外す)・`Reset`・隠れた件数と畳んだ件数 (と Expand) をスレッド操作バーの 1 か所に出す。軸ごとの保存は localStorage (`agent-hub.filter.*`)、読むときに決まっていない種類と今ない Mailbox を黙って落とす
  - 作法は design.md §3.2 に書いた。待ち (質問・許可待ち・人宛ての request・usage limit の通知) は、プロジェクトを除く軸の組み合わせでは隠れず、畳まれもしない。プロジェクトは従来どおり (他プロジェクトの待ちは隠し、`N waiting in other projects` に数える)。完了条件の「どの組み合わせでも」をプロジェクトに及ぼすかは design.md §9-10 で人の判断を待つ
  - 挙動の変更 2 点 (完了条件の「挙動を変えない」の範囲外として報告): Compact は待ちを畳まなくなった (待ちは隠さない作法を Recent にも及ぼしたため)。Noise の既定は on (保存がなければ通知を隠す。leader の決定、2026-10-29、863538b の後で変更)
  - 試験: `npm test` 337 件が通る。`npm run ui:check` は 72 件が合格。C59 で足したのは Noise (通知だけ隠れ、待ちは残る)、Mailbox (選んだものと待ちのカード。人宛て request と質問は残る)、Kind (× で外れる。隠れた返信のバッジは `hidden by the Kind filter` と出し、開かない)、全軸を掛けても待ちは隠れない、Compact の件数と Expand、Reset、保存の読み直しの場面
- [x] C61 カードにエージェントのモデルと effort を表示する (2026-10-29、leader の依頼)
  - 実機 (2026-10-29、チーム起動後に Hub の `GET /events` で見た): SessionStart (command hook) は leader・reviewer が `claude-sonnet-5-5`、deployer が `claude-haiku-5-5`。PostModelSwitch は http hook で届き、`/model` のピッカーで `claude-sonnet-5-5` → `claude-haiku-4-5-20251001` を記録した。effort は `turn.end` の `effort.level` (`medium`) で届いた。payload の形は design.md §6.1v。
  - 公式 hooks ページは全体を読み、effort の変更を知らせる hook がないことを §6.1v に書いた。
  - レビュー #273 の指摘を扱った: 「最後に見えた」値の既知の限界 (model は起動と切り替えの Event だけ) を §6.1v と §3.2 に書き、tooltip に足した。SessionStart の http が届かなかった件は公式の記述どおりと書き、実機の切り分けは未了と明記した。日付つきのモデル名の表示は合成の hook の POST で確かめたと分けた。README に SessionStart の script パスの注意を足した。
  - 試験: `npm test` 342 件が通る。`npm run ui:check` は 77 件が合格 (日付なし・日付つきのモデル名の場面を含む)。`npm run docs:check` はエラーなし。
  - 残り (記録のみ、§6.1v の NOT VERIFIED): effort を変えたあと、カードが次の Stop まで古い値を出すこと。`PostModelSwitch` の source が picker 以外の実ペイロード。
- [x] C63 GitHub で公開する前の下ごしらえ (2026-10-29、ユーザーの依頼。public にする操作は人が行う、告知はしない)
  - `LICENSE` (MIT、Copyright 2026 Hiatama Workshop) を置き、`package.json` の `license` を `MIT` にした。`"private": true` は npm への誤公開を防ぐもので、GitHub の公開とは別なので残した
  - 履歴の走査 (全 157 コミット、`git log --all`): 一度でも足されたファイルのうち `.env*`・`data/`・`logs/`・`roles.json`・`*.sqlite`・`*.log`・`*.jsonl` は `.env.example` だけ。今の `.env` の `HUB_TOKEN` の値は pickaxe (`-S`) と全リビジョンの `git grep` で 0 件。`token`/`Bearer`/`secret` に続く 16 文字以上の値と既知の鍵の形式 (`sk-ant-`・`ghp_`・`github_pat_`・`AKIA`・`tvly-`・`xox[bp]-`) を追加の行から探し、出たのは試験用の `test-token-0123456789` だけ
  - 個人のパスは `docs/plan-p0.md` の 1 か所で、`<agent-hub の絶対パス>` に置き換えた (試験の `/home/x/…` などは架空)。CLAUDE.md の「private リポジトリ」の書き方を外した
  - ほかのプロジェクト名 (vcp・cite-bridge・cairn・engram・dcp) は文書・試験・起動スクリプトに約 170 か所あり、一覧で報告した。それらも公開する前提なので、名前も過去の履歴もそのまま残す (ユーザーが決定、2026-10-29)
  - `npm test` 342 件と `npm run docs:check` が通る
- [x] C64 台帳と返事の型を、英語の語彙でも読めるようにする (2026-10-29、ユーザーの依頼)
  - 台帳の英語の語: `Status: proposed | held(…) | blocked(after C<n>)`・`#### Done when`・`## Plan`・`(rejected YYYY-MM-DD, …)`。返事の型の見出し: `RESULT`・`VERIFIED`・`NOT VERIFIED`・`NEEDS DECISION`・`NEEDS ACTION`・`SKIPPED` (deployer・reviewer の大文字の型に揃えた)。対応表と「見出しは英語で固定し、訳さない」は design.md §3.15。roadmap.md 冒頭にも英語の語を書いた
  - `src/shared/roadmap.ts` は行ごとに両方の語を読み、索引は同じ形。英語の状態の語は小文字だけで、`Status: Proposed` などは error。試験に英語の台帳 3 場面 (日本語の見本を訳した台帳が同じ索引になる、`after C<n>` と `rejected` とブロックの順、崩れと混在) を足した。手元の英語の台帳で `docs:check` と `--index` も流し、状態・理由・進み・予定・閉じた日を読めた
  - UI の `bodyOf` に英語の見出しを足した (日本語の見出しも残す)。Items の予定のない索引の注記を `no ## Plan (## 予定) in this file` にした。`npm run ui:check` に英語の見出しの返事 2 場面を足した
  - グローバルの skill `roadmap-items` (`~/.claude/skills/roadmap-items/SKILL.md`、リポジトリの外) に英語の語彙の表を足した
  - role の説明 (`tools/dev/roles/*.md`) は日本語の見出しのまま。英語に書き換えるのは C65
  - `npm test` 345 件、`npm run ui:check` 79 件が合格、`npm run docs:check` はエラーなし
- [x] C98 Keep the map pane's scroll position across redraws (2026-11-01, decided by the user)
  - `public/index.html` `renderMap`: reads the open pane body's `scrollTop` before it empties `#map`, and restores it after the pane is appended, only while the same `mapOpenKey` is still open. Another chip (or none) starts at 0. New data (SSE) and the C78 deferred redraw both take this path.
  - `tools/dev/ui-check.mjs`: two scenes added after the C95 scenes. The first (the position is kept across new data and the deferred redraw) fails against the committed `index.html` (negative check, run once) and passes with the change. The second (another chip starts at the top) passes either way, as a guard. No existing scene changed.
  - `docs/usage.md` (the map pane paragraph) describes the rule. `docs/design.md` §3.2 does not describe the pane, so it is unchanged.
  - Checked: `npm run ui:check` exit 0 with both new scenes ok; `npm test` 412 pass, 0 fail; `npm run docs:check` 30 items, 0 errors, 0 warnings (after the close). The reviewer read the uncommitted change, found no findings. Not checked: a Message that loads after the pane is open ("Loading…" and then the Message): the position can be clamped and lost, and no scene covers it.
- [x] C99 A Mailbox's reply is refused for a request it was handed (C86) (2026-11-01, decided by the user)
  - The log's `message` line records `recipients` (the Mailboxes that received the Message when sent) and `known` (the Mailbox names that existed then). `Store.appendMessage` writes both; the replay reads them; compaction keeps them. The Message as returned does not carry them.
  - `Store.isRecipientAtSend` decides for a name in `known` by `recipients`, and for any other name by the current rule (`isRecipient`), so a direct address before creation and a project-scoped role message for a project with no Mailbox yet still work. Messages without the record use the current rule. `checkReplyTarget` (C86), `oldestOpenRequestTo` (the hint) and the closing rule (`answeredBy`, C28) use it.
  - Tests: `src/hub/reply-target.test.ts` (unsubscribe, re-attach with another role, re-attach with another cwd, a Mailbox that was not a recipient refused with `reply_not_received`, the hint names the request) and `src/hub/store-recipients.test.ts` (recording, restart and compaction, pre-record lines, Mailboxes created after sending).
  - `docs/protocol.md` §2 (Recipients, Awaiting reply) and §3 (`POST /messages`) say what "received" means for a reply; `docs/design.md` §3.14 describes the record.
  - Checked: `npm test` 422 pass, 0 fail; `npx tsc --noEmit` clean; `npm run docs:check` 29 items, 0 errors, 0 warnings after the close. The reviewer read the uncommitted change, found no findings, and ran `npm test` 422 pass. Not checked: the new tests against the pre-change code; a live Hub with an old on-disk log. Open points, left as they are: a Mailbox created after the request and then re-attached with another role or cwd still loses its reply for a project-scoped role request (reviewer note, judgment call); the backlog's awaitingReply, the map chip and live delivery still use the current state.
- [x] C100 The start result line (C88) says `started` for a role that did not run (2026-11-01, decided by the user)
  - `agent` on its own with a token records `started` only after the attach is seen on the Hub (`watchAttach` in `src/team/agent.ts`, polling `attachmentOf` every second, `--attach-timeout` default 60 seconds). The baseline is the id held before claude started. An unreadable Hub read (`attachmentOf` returns `undefined`) never counts as an attach, and when the baseline could not be read the first successful read is the baseline. A claude that ends first, or does not attach in time, records `failed` with the reason; a later attach is not recorded. Without a token `agent` records `started` on spawn, as before, and `usage.md` says so.
  - `team` with the `print` opener and no `HUB_TOKEN` records each role as `printed` (`StartOutcome.printed` in `src/team/startlog.ts`, carried into the result line). A tab opener without a token still records `started`. `docs/usage.md` (start warnings) and `docs/design.md` (§C88) describe `printed`.
  - `runAgent` writes exactly one result line on every exit path (`recordOnce` and `withResult` in `src/team/agent.ts`): a throw is written as `aborted` and rethrown, and a return that recorded nothing gets an `aborted` line.
  - Tests: `src/team/agent.test.ts` (13 cases: the attach watch, including an unreadable before with an id already held and the unreadable-throughout timeout; `recordOnce`; `withResult`; `printed` in the result line).
  - Checked: `npm test` 435 pass, 0 fail; `npx tsc --noEmit` clean; `npm run docs:check` 28 items, 0 errors, 0 warnings after the close. The reviewer read the uncommitted change; one finding (a false `started` when the Hub read at `before` fails) was fixed and tested. Not checked: a real claude or Hub attach; the NVM-blocked claude (C56); a `team` run with the print opener; the exit-before-attach branch of `runAgent` and the `print ? printed : started` line in `team.ts` (no test runs them). Left as is: a claude that attaches and exits within one 1-second poll is recorded `failed`; a claude that attaches after the limit is not recorded as started later; the attach and timeout messages are printed beside claude's screen; a claude that attaches before the first successful read, with `before` unknown, ends `failed` at the limit.
- [x] C101 The C78 scene "closing Forward to… draws once" in `ui:check` is flaky (2026-11-01, decided by the user)
  - `tools/dev/ui-check.mjs`: the scene reads the render count and the chip count in the same evaluate as `blur()`. `blur()` runs `flushMap` synchronously (the select's onblur; `requestMapRender` renders at once when not held), so renders after it returns are not counted. The 800 ms wait is removed. The checks (`renders === 1`, `chips === chipsBefore + 1`) and the verify text are unchanged. `public/index.html` is not changed.
  - Checked: ten `npm run ui:check` runs in a row on the development machine's Chrome, all exit 0 with the C78 scene `ok` and no NG line; `npm test` 412 pass, 0 fail; `npm run docs:check` 31 items, 0 errors, 0 warnings (after the close). The reviewer read the uncommitted change, found no findings, and confirmed that `blur()` runs `flushMap` synchronously. Linux Chromium, where the flake was seen, was checked on 2026-11-01 at `1b6363c` by the reviewer of the closed item: five runs, all exit 0 with the C78 scenes `ok` and no NG line. The same review found the page still draws twice more right after the deferred redraw (the old scene fails 1 of 2 runs on Linux); the item leaves stopping those renders out.
- [x] C102 Close an item after its review, not in the deployer's first run (2026-11-01, decided by the user)
  - `tools/dev/roles/leader.md`: the work request's DONE WHEN asks only for checking off and the facts in the body, not the close. A "Closing request (C102)" bullet and the order in "When to ask" send the close after the review and its fixes (or after the leader's check when no reviewer is connected), before the report to the human.
  - `tools/dev/roles/deployer.md`: the section is closed only when a request asks for the close, not when the last condition is checked.
  - `docs/design.md` §3.12 (the "A break" row), §3.15 (the C96 block's progress bullet and the C97 order), `docs/usage.md` (teams in detail, and the deployer's progress line), `CLAUDE.md` ("Updating the docs"), and the top rules of `docs/roadmap.md` all give the closing request after the review.
  - Checked: `npm test` 412 pass, 0 fail; `npm run docs:check` 32 items, 0 errors, 0 warnings (after the close). The reviewer read the uncommitted change and found two stale places (the design.md §3.12 row and the roadmap.md top rule) plus usage.md line 199; all three were fixed. Not checked: a live closing request in a team run.
- [x] C103 Two projects with the same folder name get the same Mailbox names (2026-11-01, decided by the user)
  - Names (`src/shared/types.ts`): `chooseMailboxName` takes the default `<folder>.<role>` unless a Mailbox with another project (compared with `normalizeProjectPath`) holds it; then `<parent>-<folder>.<role>`, then `-2` … `-9`. A Mailbox with no project is not another project's. `mailboxNameFor` keeps the numeric suffix through the 64-character cut (review note: the long-name candidates had all been cut to one name). A later start in the same folder finds its own name and keeps it.
  - Start (`src/team/team.ts`, `src/team/agent.ts`): `team` brings the Hub up first, then chooses the names (`chooseStartNames`), then runs the connected check and writes the pre-start line with the chosen names; each role's name is printed, and `agentSub` passes `--mailbox`. With a token, a Hub list that cannot be read stops the start; without one the default is used. `agent` on its own uses `chooseAgentMailbox`: an explicit `--mailbox` as given; with a token an unreadable list fails (recorded once as `aborted`); without a token the default, and the start says so (review finding: names had been chosen before the Hub was up, so a Mailbox on a Hub that was down was missed).
  - Hub (`src/hub/hub.ts`, `attach`): a live Attachment with a `cwd` that differs from the Mailbox's `project` is refused with 409 `project_mismatch`, and nothing changes. The same folder (takeover), no live Attachment (`projectChanged` as before) and no `cwd` are accepted as before. `mailbox.test.ts` (moved-folder case) and `reply-target.test.ts` (C99 case) now detach before the attach from another folder.
  - Shim (`src/shim/hub-client.ts`, `src/shim/main.ts`): the refusal stops the session without retry; the Hub's message goes to stderr, and tool errors and `status` carry the `project_mismatch` note (`whoami` still works).
  - Docs: `docs/design.md` §3.3, `docs/protocol.md` (error code list, attach section), `docs/usage.md` (team names).
  - Tests: `src/team/mailbox-name.test.ts` (names, long-name suffixes, `chooseStartNames`, `chooseAgentMailbox`, `agentSub --mailbox`), `src/hub/attach-project.test.ts`, `src/shim/project-mismatch.test.ts`.
  - Checked: `npm test` 462 pass, 0 fail; `npx tsc --noEmit` clean; `npm run docs:check` 30 items, 0 errors, 0 warnings after the close. The reviewer read the uncommitted change; the names-before-Hub finding and the long-name note were fixed and tested. Not checked: two real projects side by side on one Hub; the shim error inside a real claude; `team` with the print opener and a name clash; the order inside `teamStart` and `agent` with the Hub down end to end (read, not run). Left as is: the Hub's hook fallback `resolveMailbox` (folder name) can map project B to A's default-named Mailbox for a hand-started session with no header; two starts racing can both take the default (the `project_mismatch` refusal catches it once the first is attached); the pre-start line is not written when the name choice fails.
- [x] C104 Confirm before a role message from the browser reaches several projects (2026-11-01, decided by the user)
  - `public/index.html`: `broadcastQuestion(to)` returns a question only for a `role:` target with no `project` whose receivers (Mailboxes of that role with a `project`, in `mailboxList`, compared with `projectKey`) are in two or more projects; it names the Mailbox count and the project count. `onsubmit` and `forwardSelected` ask with `window.confirm` before anything changes. Cancel returns, so the text, the address, the images and the forward state stay. A scoped send (a project chosen) adds `to.project` and is not asked.
  - `tools/dev/ui-check.mjs`: three scenes at the end (cancel sends nothing and keeps the draft; confirm sends; one project is sent without asking). `window.confirm` is replaced in the page, so no dialog opens. Setup: reviewers outside `demo` are detached and deleted for the last scene.
  - `docs/usage.md` (the project paragraph) and `docs/design.md` §3.2 (the `All projects` bullet) say what happens.
  - Checked: `npm run ui:check` exit 0, 145 ok; `npm test` 462 pass, 0 fail; `npx tsc --noEmit` clean; `npm run docs:check` 29 items, 0 errors, 0 warnings after the close. The reviewer read the uncommitted change, found no findings, and ran ui:check. Not checked: the forward path's question (no scene); cancel keeping attachments and the forward state (the scene checks text and address only); a real browser with two real teams. Left as is (reviewer notes): the count comes from the page's `mailboxList`, so a Mailbox that attaches within the SSE gap is missed; Mailboxes of the role without a project receive the message but are not counted, so "N Mailboxes" can be lower than the Hub delivers to.
- [x] C107 Send the ledger index when a team starts, and say so when a project has none (2026-11-01, decided by the user)
  - The ledger is named in `.agent-hub.json` at the project's root (`"ledger"`, default `docs/roadmap.md`), read by `readLedgerSetting` (`src/shared/ledger.ts`) for the team start, `docs:index` and the post-commit hook (`docs:index -- --if-touched`, `touchesLedger`). The place and why are in design.md §3.15 (open question 2). `sendLedgerIndex` (`src/docs-check/send-index.ts`) never throws and returns the reason when it does not send.
  - Team start: after the Hub is up, sends the index when the ledger exists; the summary always prints `index: sent <file> (N items) to <Hub>` or `index: not sent: <reason>`; a failed send does not stop the start. Post-commit hook (`tools/hooks/post-commit-index.sh`): sends only when the commit changed the ledger. Items pane (`noIndexHint` in `public/index.html`): with no index for the chosen project, shows `npm run docs:index -- --project <folder>`, with no `--file`.
  - Checked: `npm test` 474/474 pass; `npm run ui:check` 157 ok, 0 NG (the empty-pane scene asserts the command has `--project`, no `--file`, and no `--file` hint); `npm run docs:check` 0 errors. The hook, the team-start summary and the pane command were checked by hand in a scratch git repo and a Hub on port 7797 (the earlier reports). The leader checked the diff against SCOPE. No reviewer was connected, so the item had no review.
  - Late review (2026-11-03): the review request of 2026-11-01 stayed unread (it predates C113) and reached the first reviewer that attached, after the close. Lines 1, 2, 4 and 5 met; line 3 met for ASCII paths in git's canonical form. The two findings (non-ASCII ledger paths, paths not in canonical form) and three notes are C126.
- [x] C113 A request the leader went on without stays open and arrives stale (2026-11-01, decided by the user)
  - `tools/dev/roles/leader.md` ("When the other side is not connected"): a request is left open only when the work is still due once the role starts (`NEEDS ACTION`); when the leader goes on without the other side (a review reported `NOT VERIFIED`, or work done another way), it closes its own request with a `reply` to the same address, one line why. `docs/usage.md` (teams in detail) says the same.
  - `src/hub/reply-target.test.ts`: a reply from the sender to its own request, addressed to an unattached role, is accepted, closes the request and reads as unread on that Mailbox. It passed on the existing Hub code; `src/hub` not changed.
  - Checked: `npm test` 475/475 pass; `npm run docs:check` 0 errors. No reviewer was connected, so the item had no review.
- [x] C106 Every badge jumps to what it counts (2026-11-01, decided by the user)
  - `public/index.html`: one jump helper for every badge (`jumpChip`: pointer cursor, a title saying what a press finds). The sidebar `#backlog` badges jump like a card's badge (C44); the `#states` counts jump to the oldest Message or Event (`oldestTargetOf`, Needs you and Stopped) or to the first card in that state (`jumpToCard`, sidebar or map, highlighted); the map's human `Needs you N` (all projects) and a card's Needs you label jump to their oldest target; `jumpTo` switches from Map view to Messages first. A press sends nothing, marks nothing read and changes no state. No Hub or protocol change.
  - Done-when 5 was reworded on 2026-11-01 by the user: a sidebar badge counts only the shown cards, so its target cannot be hidden by the project filter; the scene uses the map's human `Needs you N`, which counts all projects.
  - Checked: `npm test` 475/475 pass; `npm run ui:check` 176 ok, 0 NG (the C106 scenes press the real badges); `npm run docs:check` 0 errors; `docs/usage.md` and design.md §3.15 updated. Closed without a review (the user's decision).
- [x] C111 Write the Hub hooks on a project's first team start (2026-11-01, decided by the user)
  - `src/team/hooks.ts` `writeMissingHooks` is the one writer (`hooks --write` and the team start both call it, with a backup when the file existed); `src/team/team.ts` `hooksForStart` writes the missing hooks at a team start and says so in the summary (`hooks: …`) instead of warning; `--no-hooks` (`src/team/options.ts`, `src/team/main.ts`) keeps the warning only. The version warning is `WARNING` only on the first start with that version (`versionWarnedBefore` in `src/team/startlog.ts`, read from `logs/start-warnings.jsonl`); later starts print a plain `note:`, and every start is still recorded.
  - Checked: `npm test` 479/479 pass; `npm run docs:check` 0 errors; `npx tsc --noEmit` ok. A real team start against a scratch project on a separate Hub (port 7791, stopped afterwards): the first start wrote `.claude/settings.local.json` and printed `hooks: Hub hooks written to …`, the second left it unchanged, `--no-hooks` warned only and wrote nothing, and with the start log set aside the first start printed `WARNING` for the newer version. A failed write inside a real start is covered by the unit test only. No reviewer was connected, so the item had no review.
- [x] C108 A command for the starting session to read a project's latest reports and states (2026-11-01, decided by the user)
  - `src/team/status.ts`: `npm run team -- status --project <dir>` (also `hub-team status`) prints one line per Mailbox of the project and the newest report from one of its Mailboxes to the human, in full. It reads `GET /mailboxes` and pages `GET /messages` with the URL and token rule of `docs:index`; a missing token, a refused token or an unreachable Hub is one line and exit 1. The team start's summary prints `status: npm run team -- status --project <dir>`. `src/team/options.ts`, `src/team/main.ts`, `src/team/team.ts` wire it; `docs/usage.md` (teams) describes it.
  - Checked: `npm test` 485/485 pass; `npm run docs:check` 0 errors; `npx tsc --noEmit` ok. A real read-only run of `npm run team -- status --project .` against the running Hub printed the three Mailbox lines and the latest report in full; `hub-team status` ran in that folder (exit 0). The unreachable and refused cases are covered by unit tests only. No reviewer was connected, so the item had no review.
- [x] C27 Preparing new projects (2026-11-02, closed by the user as done)
  - Hooks by hand: done by C111 (written on the first team start). The ledger's place: done by C107 (`.agent-hub.json`).
  - Learning the rules: `docs/project-setup.md` (linked from the README and the CLAUDE.md map) lists what a project prepares (the document map, the ledger and `.agent-hub.json`, a place for decisions and facts, hooks, the post-commit hook), how to write items, who writes what, and one item end to end. `tools/dev/roles/reviewer.md` starts from the README when a project has no map, and reads the project's own places for non-goals, decisions and facts. No template file is placed; the guide carries an example item.
  - Not built: reading ledgers with their own format (vcp: states in headings, no done-when lists). The stance stays as the section had it: the other side is not asked to rewrite its ledger, and such a project gets plain requests without the index (`docs/usage.md`, Items; `docs/project-setup.md` §2).
  - Checked: `npm test` 485/485 pass; `npm run docs:check` 0 errors. Docs only; no review.
- [x] C13 A warning when the body starts with a built-in command (2026-11-02, decided and done in the planning session at the user's word)
  - `public/index.html` `updateHint`: a body starting with one of `BUILTIN_COMMANDS` (`/clear`, `/compact`, `/model`, `/exit` and other Claude Code built-ins) shows `/<name> is a Claude Code command. Sent here it arrives as text and does not run.` under the box (design.md §6.1h). A custom command with the same name wins; `//` escapes and other names are unchanged. Sending is not blocked. `docs/usage.md` (custom commands) says so.
  - Checked: `npm run ui:check` exit 0, 178 ok, 0 NG (two C13 scenes: the hint for `/clear` and `/compact now`; none for `/clearx` and `//clear`). No review.
- [x] C24 Checking rejected lines `[-] C<n>` with docs:check (2026-11-02, decided and done in the planning session at the user's word)
  - `src/shared/roadmap.ts` `checkRoadmap`: a `[-] C<n>` line whose closing parenthesis is not `(却下 YYYY-MM-DD、理由)` / `(rejected YYYY-MM-DD, reason)` is an error; a `[-] C<n>` whose section remains is an error (`[x]` was already checked through refs); an ID closed on two lines is an error (numbers are not reused). `parseRoadmap` puts the rejection's `reason` in the index's `closed` (null when the form is broken).
  - Checked: `npm test` 501/501 (two existing tests updated for the new field and error, two C24 tests added); `npm run docs:check` 0 errors on this ledger; cairn's `docs/items.md` / `docs/roadmap.md` and vcp's `docs/TODO.md` get no new errors. No review.
- [x] C117 Gaps found adopting docs/project-setup.md in cairn (2026-11-02, reported from cairn's adoption; filed and done in the planning session)
  - Empty ledger: `sendLedgerIndex` (`src/docs-check/send-index.ts`) does not send a ledger with no items unless the Hub already holds an index of the same project and file (`GET /indexes`; then it is sent, to clear it). The reason names `.agent-hub.json`, and the team start summary prints it. Test: `send-index.test.ts` (not sent with nothing held; sent when held).
  - `docs:check` reads a relative path from the folder npm was called in (`INIT_CWD`), as `docs:index --file` does; `npm --prefix <agent-hub> run docs:check -- docs/items.md` from cairn's root gave 7 items, 0 errors.
  - `npm run team -- git-hook [--project <dir>] [--write]` (`src/team/git-hook.ts`): writes a thin `.git/hooks/post-commit` (path from `git rev-parse --git-path`) that sets `AGENT_HUB_DIR` and runs agent-hub's `post-commit-index.sh`; an older thin hook is rewritten, a full copy is replaced with a `.bak`, the project's own hook is left alone with the line to add. Tests: `git-hook.test.ts` (6). Real: a scratch git repo with a one-item ledger, hook written, commit sent the index to the running Hub (removed afterwards).
  - Docs: `docs/project-setup.md` (map row names cairn's CLAUDE.md as a second example and adds a skeleton; the `.agent-hub.json` and hook rows; the check command with a relative path), `docs/usage.md` (Items: empty ledger, `docs:check` path, `git-hook`), design.md §3.15 (C107 addendum), `tools/dev/roles/reviewer.md` ("What to read" and the wording check name the places the project's map points to, with agent-hub's in brackets).
  - Checked: `npm test` 508/508; `npx tsc --noEmit` ok; `npm run docs:check` 0 errors. No review.
- [x] C114 A request handed after it was sent cannot be answered (C99) (2026-11-02, closed by the user without a review)
  - `Store.hasReceived` (renamed from `isRecipientAtSend`) is `recipients` ∪ `isRecipient`: in the send-time record, or a recipient now. `checkReplyTarget` (C86), `oldestOpenRequestTo` and `answeredBy` (C28) use it. `appendMessage` and `compact` no longer write `known`; a line with `known` loads and the field is ignored. protocol.md §2 (Recipients) / §3 (`POST /messages`) and design.md §3.14 say the rule.
  - Tests: `src/hub/reply-target.test.ts` (C114) runs both cases through the Hub (a Mailbox first attached without `cwd`, then with the project's: reply 201, named in the hint, request closed; a detached Mailbox re-attached from a moved folder after `role @ <new folder>`: named in the hint, closed by its later request to the sender) and a Mailbox created after a project-less role request still gets 400. `src/hub/store-recipients.test.ts` (C114): a Mailbox that gets the project after the send has received it, also after compaction and restart; no `known` in new lines; a line with `known` loads. The C99 tests (unsubscribe, another role, restart and compaction, legacy lines) pass unchanged.
  - Checked: `npm test` 499/499; `npx tsc --noEmit` ok; `npm run docs:check` 0 errors. No review.
- [x] C115 Gaps left in C100's start result (2026-11-02, closed by the user without a review)
  - `fail()` in `src/team/agent.ts` records `failed` first; the status file write after it is in a try/catch that prints the error.
  - `superviseChild` (`src/team/agent.ts`) holds the child wiring `runAgent` used inline (spawn, error, exit, attach watch); `runAgent` calls it with the real child. `noTokenOutcome` (`src/team/team.ts`) is the no-token choice `teamStart` uses. Tests (`src/team/agent.test.ts`, `team.test.ts`): exit before attach is `failed` (fails if reverted to started-on-spawn), attach then exit is one `started` line, spawn error, attach timeout, started by team records nothing; `noTokenOutcome` is `printed` for `print` and `started` for each tab opener (fails if reverted to always `started`).
  - Checked: `npm test` 499/499; `npm run docs:check` 0 errors. The unwritable status file is not exercised by a test. No review.
- [x] C116 Refuse `agent` without a token, and leave a result line on Ctrl+C (2026-11-02, closed by the user without a review)
  - `tokenRefusal` (`src/team/agent.ts`): `runAgent` on its own with no token prints the reason, records `failed` (role, the default or given Mailbox, reason) and returns 1 before any Hub read or claude spawn. Run for real with agent-hub's `.env` set aside: exit 1 and the `failed` line in `logs/start-warnings.jsonl`. `agent` from `team` is not refused.
  - `onStartSignals` / `interrupted`: SIGINT and SIGHUP write the result line with `aborted: "interrupted by <signal>"` and exit 130 / 129. `runAgent` on its own installs it at the start and removes it just before the spawn, where SIGINT is ignored for claude as before; `runTeam` keeps it for the whole start and writes its outcome so far. docs/usage.md (team names, start warnings) says the refusal, the signal line, and that only a kill that cannot be caught leaves no line.
  - Checked: `npm test` 499/499 (refusal, `interrupted`, `onStartSignals` with a fake process); `npm run docs:check` 0 errors. A real Ctrl+C was not sent (unit tests only). No review.
- [x] C121 Is `--dangerously-load-development-channels` still in Claude Code? (2026-11-03, closed by the planning session: a fact check with no code change)
  - The official Channels page (code.claude.com/docs/en/channels, "Research preview", read 2026-11-03) says neither `--channels` nor `--dangerously-load-development-channels` appears in `claude --help` during the preview, and that they work although unlisted. So the flag is hidden, not removed; nothing in the start path, the README or the verified-version line changes. Recorded in design.md §6.1.
  - Also read on the MCP page: the v2 client runtime does not register a channel server that negotiates protocol `2026-07-28`. Already in design.md §6.1 and the SDK 1.x pin (§5); nothing new.
- [x] C118 Walk README and project-setup.md through from nothing, and fix what breaks (2026-11-03, closed by the user without a review)
  - Walked by the deployer in scratch folders: a fresh clone of agent-hub (16fb15f) and a clone of ad_masker (382cabc, the original untouched), on spare ports. The Hub on 7777 was not touched. Documents fixed: `README.md` (step 1: a variable already set in the shell overrides `.env` without a warning; the npm 11 install-scripts warning; step 3 Mailbox note), `docs/project-setup.md` (§1.2 the PATH form for PowerShell and Git Bash; §2 how an own-format ledger is converted, from ad_masker's 29 `docs:check` errors to 0; §5 Mailbox names and `--tabs print`), `docs/usage.md` (Items; Role definitions).
  - Role routing without `roles.json`: `role:leader` and `role:deployer` still reach their Mailboxes and the round trip completes; `GET /roles` is `{"roles":null}`. The file adds only the role description and the default subscriptions. Recorded in `docs/usage.md`.
  - Checked: README steps 1, 2, 5 and 6 (with `--tabs print`); project-setup §1-§5 on the ad_masker clone (own-format ledger converted to 4 items, 0 errors; the git hook sent the index; `hub-team status`); user → leader → deployer → leader → user through the shim's tools and the Hub API; `npm run docs:check` 26 items, 0 errors. No review.
  - **Not run, accepted by the user as closing anyway**: the channel delivery into an interactive Claude session (README step 3 with `--dangerously-load-development-channels`), the browser form and the Items modal's Draft request and Send, real tabs (`wt`), hook events fired by a real session (the hooks were written, not fired), macOS and Linux (C62). Done-when 1 and 2 were met at the Hub and shim level, not through those.
  - Found, not filed (code changes; for the planning session): a variable set in the shell (`HUB_TOKEN`, `HUB_ROLE`, `HUB_MAILBOX`) overrides `.env` for the Hub, the shim and the team start with no warning; the esbuild install-scripts warning on npm 11; `claude --help` 2.1.316 does not list `--dangerously-load-development-channels` (hidden or removed, to check against design.md §6).
- [x] C119 Warn when a variable set in the shell overrides `.env` (2026-11-03, closed by the closing request; no review)
  - Checked: `npm run typecheck` pass; `npm test` 525 pass, 0 fail (the leader checked it too); `npm run docs:check` 0 errors.
  - Scratch-Hub runs in a temp copy of the repository (Hub on 7795; the shell's `HUB_TOKEN`, `HUB_PORT` or `HUB_URL` differing from the copy's `.env`): `npm run hub` warns for the variable only and listens on the shell's port; `team status` warns and its 401 message names the environment, exit 1; `docs:index` warns and its refusal names the environment, and `--if-touched` on a non-ledger path is silent; team start (`--tabs print`) warns, the mailbox-list error names the environment, and the result line keeps `warnings`; `agent` warns and stops before spawning anything. No token in any output or in `logs/start-warnings.jsonl`.
  - Not verified: the team-start UI 401 line (unit test only, since a start with a refused token stops earlier); the Docker side; real Claude sessions (NVM blocks `claude` in the shell here, so a test-only `claude.exe` stood in for the claude check); macOS and Linux.
  - No review (no reviewer connected).
- [x] C120 Remove the esbuild install-scripts warning on `npm install` (npm 11) (2026-11-03, closed by the closing request; no review)
  - Checked: npm 11.19.1 `npm ci` printed the esbuild install-scripts warning before the change (`allowScripts` absent) and none after; `npm test` 525 pass, 0 fail (the leader checked it too, after the change); `docker compose build` exit 0, and the built image started the Hub; `package-lock.json` unchanged; `npm run docs:check` 0 errors.
  - Not verified: npm versions other than 11.19.1; the image's own npm version. The scratch build ran outside the working tree; its move of the `agent-hub` image tag was reverted by hand.
  - No review (no reviewer connected).
- [x] C9 Checking the document conventions (2026-11-03, closed by the planning session after the review)
  - `src/docs-check/repo.ts` (run by `npm run docs:check` on this repository's ledger only): CLAUDE.md's map against the numbered headings of design.md and protocol.md; the Hub routes (`createApp`) against protocol.md §3's tables; `EVENT_KINDS` / `MESSAGE_KINDS` against §2's kind lists; a `YYYY-MM-DD` on each `Decision` / `Direction` / `Decided` line of design.md §9. The first run found 5 drifts, fixed in the docs.
  - Review finding: plain-text labels (`Decision (user): ...`, `- Decided by ...`) escaped the §9 check; the deployer's fix also matches a label at the start of the line, with tests for both.
  - Done-when line 5 (0 errors and 0 warnings): the deployer left it unchecked because the one warning left was the roadmap rule's close reminder for C9 itself. The planning session read that warning as part of closing, not drift in the documents, so the line is met; after this close the run reports 0 errors and 0 warnings.
  - Checked: `npm test` 538 pass, 0 fail; `npm run typecheck` pass; `npm run docs:check` 0 errors, 0 warnings.
- [x] C124 Extend the table-drift checks to MCP tools and SSE event names (2026-11-03, closed by the planning session after the review)
  - `npm run docs:check` (this repository's ledger) also checks the shim's MCP tools against protocol.md §5 (a row with no tool must say "Not built"), the UI stream's `event:` names against §7 and the shim stream's against §3's SSE table. Names come from the code: `SHIM_TOOLS` (`src/shim/tools.ts`, moved out of `main.ts` unchanged), `UI_EVENT_NAMES` (the type `emitUi` takes) and `SHIM_STREAM_EVENTS` (`src/shared/types.ts`), read by `src/docs-check/code-names.ts`.
  - Drift fixed: §5's `attach`, `list_topics` and `report_event` rows now say Not built (`report_event` deferred, C17). §7 and the §3 shim table already matched.
  - Review finding: a name left in `UI_EVENT_NAMES` after its last emitter was removed passed. Fix: the literal names of `emitUi(` calls in `src/hub` are compared with the list both ways, and a non-literal call is an error; checked by renaming the `index.deleted` emitter and restoring it.
  - Done-when line 4 (0 errors and 0 warnings): left unchecked by the deployer for the same reason as C9 (the only warning was C124's own close reminder); read as met, and after this close the run reports 0 warnings.
  - Checked: `npm test` 550 pass, 0 fail; `npm run typecheck` pass; `npm run docs:check` 0 errors, 0 warnings.
- [x] C125 One home per document convention, with the table in design.md §3.12 as the index (2026-11-03, closed by the closing request after the review)
  - design.md §3.12: the table's last column, "Written in full in", names one file per row; the other files point there. The Read / Add cells are shortened, and the intro line points at CLAUDE.md for reading the map.
  - The item rules moved from CLAUDE.md "Updating the docs" to the top of roadmap.md (progress and the wording-is-a-promise rule, who files items, the deployer's first-run close, `docs:check` on this file); CLAUDE.md keeps one pointer. The roadmap top's docs:check bullet points at design.md §3.12 for the list of checks.
  - tools/dev/roles: stay project-neutral. Item numbers removed; design.md §3.15 citations marked as agent-hub examples or "the project's planning session"; the PROPOSED CONDITIONS rule points at the top of the project's roadmap.
  - Review findings fixed: the 'A break' row had lost the engram / memory step (restored, with the outside home named); two bare citations in leader.md; the reviewer row's Read cell let the request decide what is read (now the reviewer chooses).
  - Checked: `npm test` 550 pass, 0 fail; `npm run docs:check` 0 errors.
  - Done-when line 4 was checked on the user's instruction in the request (the item's own close reminder is not counted as a warning). After this close the reminder is gone, so `docs:check` shows 0 warnings.
  - Not changed (outside this item's done-when): the global ~/.claude/CLAUDE.md, the skills roadmap-items and clear-timing, and docs/usage.md:205 (who files items, restated in full).
- [x] C126 The ledger index misses non-ASCII and non-canonical ledger paths (2026-11-03, closed by the closing request after the review, which had no findings)
  - The hook passes `git diff-tree -z` output to `docs:index --if-touched` NUL-separated, so a non-ASCII ledger path (`docs/台帳.md`) reaches the send. Checked with the real hook under git's sh in a scratch repository (the previous hook sent nothing; the new one sends).
  - One form for the `ledger` setting, `docs:index --file` and the hook's comparison: `canonicalPath` (`src/shared/ledger.ts`). `docs/./items.md`, `docs//items.md`, `./docs/items.md` and `docs\items.md` name one file with one `source`.
  - A bad setting or a bad `--file` value (empty, absolute, a drive letter, `..`) prints a warning and falls back to the project's ledger: the setting when it is usable, else `docs/roadmap.md`. Done-when line 2 is met as written for both.
  - The hook shows push-index's warning on every commit (an unusable setting too), and a failed send prints the real reason (`docs/items.md を送れない: …`), not "Hub stopped or no token".
  - `docs/usage.md` says how the path is matched (one form, the spelling must match git's, non-ASCII works, the `--file` fallback).
  - Checked: `npm test` 563 pass, 0 fail; `npm run docs:check` 0 errors, 0 warnings.
  - Review (2026-11-03): no findings.
  - Left as they are: a different letter case on Windows is not folded (usage.md says the spelling must match git's); a real send to a running Hub from the hook was not run (the tests use an unreachable Hub); the hook's `grep -v '^npm \(error\|warn\)'` uses `\|` in a basic regex (GNU grep, as in Git for Windows), not checked with a BSD grep.
- [x] C128 Item rules in one place: the skill and usage.md point at the top of roadmap.md (2026-11-03, closed by the planning session; docs only, no review)
  - The top of roadmap.md is the one home for every project's ledger. Rules that only the skill had moved there first: nothing after the title, a request names the ID, an undecided item is `proposed`, each done-when line checkable within the item and written from the current decision, about one request in size, working promises in CLAUDE.md, removing a closed item from `## Plan`, where closed lines live.
  - The skill `roadmap-items` keeps when to read, the two layers, where a ledger goes, the four-tier answer and how to run `docs:check`; for writing and closing it points at the top of this file by absolute path.
  - docs/usage.md (the team section) points at the top of roadmap.md for who files items and how an item is closed. design.md §3.12's table has a row for writing, filing or closing an item, naming the skill and usage.md as pointers, and states the test for a line (would deleting it make someone act wrongly).
  - The global `~/.claude/CLAUDE.md` "plans" block was left as is: it triggers the skill and carries two ledger-placement prohibitions, no item rule.
  - Not changed: docs/project-setup.md's table of who writes what (the human's first-team guide).
  - Checked: `npm test` 550 pass, 0 fail; `npm run docs:check` 0 errors, 0 warnings.
- [x] C127 The You node shows when the ball is with the human (2026-11-03, closed by the planning session after the review)
  - `public/index.html`: `yourMoveOf` decides from the cards' own states (`stateOf`) on each redraw, so it follows SSE with the cards. The map's You node shows `Your move` (`.mapnode.st-move`: 1px `--st-you` frame, 10% tint, no pulse) when Needs you is 0 in every project, a connected card is shown, and none is `working` (quiet unread included), `delegated`, `you`, `paused` or without a state. Stopped does not hide it. Needs you takes precedence.
  - Review finding fixed: a connected `you` card (C49, waiting on an unconnected party) blocks `Your move`.
  - Wording changed in the planning session on 2026-11-03 (the user's decision): Paused also hides it, since a usage-limit wait resumes by itself; code and a Paused scene followed.
  - Checked: `npm run ui:check` 187 ok, 0 NG, exit 0 (run again by the planning session; 9 C127 scenes, including Working → Idle without a reload and Paused); `npm test` 550 pass, 0 fail; design.md §3.15 and docs/usage.md updated.
  - Seen by eye (2026-11-03, the user): on the live team in dark mode, three idle sessions and Needs you 0 show the frame, the tint and `Your move`. The compose Hub had to be rebuilt first (`docker compose up -d --build`); the image predated C127. Light mode not seen.
- [x] C130 A read-only procedure for checking whether a project is ready for the Hub (2026-11-05, decided and closed by the planning session; docs only, no review)
  - Raised from a check of vcp that was first answered from `docs:check --index`, which shows no errors and exits 0.
  - docs/project-setup.md §7: the order (`docs:check` without `--index`, `team -- hooks`, `team -- git-hook`, both without `--write`, then four things read by hand: where the map names decisions and facts, the working rules, `.agent-hub.json`, the shape of closed lines) and a result table (what / result / evidence).
  - Scope written in: the delivery layer only; the other project's ledger content goes to its leader. The Windows case-insensitive `docs/ROADMAP.md` hit is written in (seen in vcp).
  - Decided against: a global skill (only agent-hub's own session runs the check) and a combined command (added only if running the commands by hand turns out to fail).
  - CLAUDE.md's map names §7 on the project-setup.md line.
  - Checked: `npm run docs:check` 0 errors, 0 warnings.
- [x] C133 When the planning session does the review, the team stops before the close (2026-11-06, closed by the closing request; no review)
  - Decided 2026-11-06 by the user: (b). With no reviewer connected, the leader reports and stops before the closing request; the close waits for the user's word. The reviewer order is unchanged.
  - Changed: `tools/dev/roles/leader.md`, `docs/usage.md` (review order), `docs/roadmap.md` (the close rule at the top), `docs/design.md` §3.15 (C97 bullet), `docs/project-setup.md` §5 step 4.
  - Checked: `npm test` 563 pass, 0 fail; `npm run docs:check` 32 items, 0 errors (the all-conditions-checked warning was gone after the close).
  - No review (no reviewer connected). Not checked: a live team run with no reviewer and the user's "close C133". Done-when wording not changed.
- [x] C134 Two checker messages read from a ledger whose items are all proposed (2026-11-06, closed by the closing request; no review)
  - Decided 2026-11-06 by the user: (1) the missing-heading error also says a heading alone is enough when nothing is decided; (2) a title after `C<n>` on a plan line is a warning, not an error.
  - Changed: `src/shared/roadmap.ts`, `src/shared/roadmap.test.ts`, `docs/roadmap.md` (the plan-list rule at the top).
  - Checked: `npm test` 566 pass, 0 fail (563 before, +3 new); `npm run docs:check` 31 items, 0 errors (the all-conditions-checked warning was gone after the close).
  - No review (no reviewer connected). Not checked: a ledger with a titled plan line and real items outside the tests. Done-when wording not changed.
- [x] C132 Point the starting session at how requests and closes work, at the moment it starts a team (2026-11-06, closed by the closing request; no review)
  - Decided 2026-11-06 by the user: both carriers. The team start's summary gets a `planning session:` line (Draft request, and the absolute path to docs/usage.md's review and close order); with no reviewer connected at the end of the start, a `no reviewer:` line says the close waits for the user's word (C133). The global CLAUDE.md lines are written by the planning session, outside this repository.
  - Changed: `src/team/summary-lines.ts` (new), `src/team/summary-lines.test.ts` (new), `src/team/team.ts`, `docs/usage.md` (the team start's summary).
  - Checked: `npm test` 569 pass, 0 fail (566 before, +3 new); `npx tsc --noEmit` clean; `npm run docs:check` 30 items, 0 errors (the all-conditions-checked warning was gone after the close).
  - No review (no reviewer connected). Not checked: a real team start against a Hub (the summary printed end to end, and the reviewer attach result). Done-when wording not changed.
- [x] C141 Closing writes a line the checker rejects in a ledger without phases or with full-width parentheses (2026-11-09, closed after the review)
  - Raised 2026-11-09 (arb-sentinel C10–C12): each close by the deployer left two `docs:check` errors in a ledger with `## 予定` and a closed list, and the planning session fixed the ledger by hand. Decided: (a) the rules say where a close goes in a ledger without phases (the plan line is removed, never checked; the closed line goes in the closed list), (c) the closing instructions end with a `docs:check` run, and the error-message half of (b) (the checker's message names the fix). The checker does not accept a full-width trailing group.
  - Changed: `src/shared/roadmap.ts` (the two messages; the vocabulary per ledger), `src/shared/roadmap.test.ts` (two new tests; three expectations updated), `docs/roadmap.md` (the rules at the top, the facts), `docs/conventions-log.md` (one line, 2026-11-09), `tools/dev/roles/deployer.md` and `tools/dev/roles/leader.md` (the close instructions; the check uses the `npm --prefix <agent-hub>` form, see below).
  - Checked: `npm test` 584/584 pass; `npm run docs:check` 0 errors; the two messages on two scratch ledgers (Japanese and English) through the real checker.
  - Review (uncommitted change): one finding, the close check used `npm run docs:check`, which does not exist in another project's folder. Fixed: both role files now use `npm --prefix <agent-hub> run docs:check -- <ledger>`. The fix itself was not re-reviewed.
  - Not run: a real project folder with its own package.json and no docs:check script (a scratch folder without package.json was used instead). The agent-hub path is not carried in the role text: the placeholder `<agent-hub>` must be filled by the leader's closing SPEC, or reported as NOT VERIFIED.
  - Notes: the message language is chosen per ledger by the `## Plan` / `## 予定` heading. A trailing group with ASCII parentheses inside it gets the "no date" message.
- [x] C142 After a Hub outage, a session stays `Working` forever and its lost reply is never asked for (2026-11-09, closed after the review)
  - Raised 2026-11-09 (arb-sentinel C15): the Hub stopped after a hand-over; the session's reply and turn end were lost, so the card stayed `Working` and Health check could not see it. Decided option (b) only: the Hub records its start time, and a hand-over before the start that the existing rules would show as Working, with no reply and no turn end since the start, shows `Stopped, no reply (Hub restarted after the hand-over)`. Health check counts it and sends the existing cue. Options (a) and (c) were not taken (design.md §3.1, §3.15).
  - Changed: `src/hub/hub.ts` (startedAt), `src/hub/app.ts` (`GET /mailboxes` returns startedAt), `src/hub/store.ts` (`backlog.lastHanded.open`), `src/hub/app.test.ts`, `src/hub/mailbox.test.ts`, `src/hub/store.test.ts`, `public/index.html` (`stateOf`), `tools/dev/ui-check.mjs` (restart scenes, the two review scenes, the C71 flash wait, the C106 helper wait), `docs/protocol.md` §3, `docs/design.md` §3.15.
  - Checked: `npm test` 582/582 pass; `npm run docs:check` 0 errors; `npm run ui:check` 202 ok, 0 NG in 3 runs in a row (the leader and reviewer reran, no NG).
  - Review (uncommitted change, read twice by the reviewer): one finding fixed. The restart rule hit a leader that had handed work to a deployer and ended its turn, and a session that ended its turn without replying. It now requires `handedWorking`, and two ui:check scenes cover those cases.
  - C106 Working-badge check: it raced a redraw. The helpers now wait until the cards stop being rebuilt before the click. The source of the redraw was not identified; a HEAD run passed the check 2 of 2, and this tree failed it before the helper fix.
  - Not run: a live Hub restart in a team; the reply path as a ui:check scene (covered by the Hub test and by reading `open`); the older-Hub path (no `startedAt`).
  - Known limit (design.md §3.15): the time compared is the Message's own time, not the hand-over time; only the last hand-over is judged.
- [x] C143 The Hub's own log is lost when its tab closes (2026-11-09, closed after the review)
  - Raised 2026-11-09, split from C142's (d): the Hub's stdout went only to its tab, so why the Hub stopped during arb-sentinel C15 left no trace.
  - Changed: `src/hub/log.ts` (new: the logger, one rotation, the exit handlers), `src/hub/log.test.ts` (new, 12 tests), `src/hub/main.ts` (installs the log outside Docker only), `docs/usage.md` ("Hub log outside Docker"), `docs/design.md` §3.14 ("Hub log (C143)").
  - Checked: `npm test` 581/581 pass; `npm run docs:check` 0 errors (the close reminder is gone after this close). `npm run hub` on a spare port wrote each console line to `logs/hub.log` with an ISO time, the UI line with `?token=***`. Exit paths (SIGINT 130, SIGHUP 129, an unhandled rejection and an uncaught exception 1) were checked by emitting the events in-process, each line in the file.
  - Review (uncommitted change): one finding, a failed rotation rename dropped lines; fixed (the append runs anyway, the size is re-read) and tested with a directory at `hub.log.1`.
  - Not checked: real OS signals (Ctrl+C, closing the tab, `taskkill`); a live Windows file lock during rotation (`Get-Content -Wait`); the logger inside a Docker container. Done-when wording not changed.
- [x] C152 `docs:check` follows the ledger's language, and names a closed line's inner parentheses (2026-11-10, closed after the review)
  - Raised 2026-11-09 by the reviewer of C141, outside its done-when; moved from C146's body on 2026-11-10. Decided 2026-11-10 in the planning session: the ledger's own vocabulary picks the language, and every message has both texts (not `HUB_LANGUAGE`).
  - Changed: `src/shared/roadmap.ts` (every `checkRoadmap` message through `pick`; the language from the ledger's vocabulary, read outside fences; the closed-line message names inner ASCII parentheses through `trailingDatedGroup`), `src/shared/roadmap.test.ts` (5 new cases; 4 existing expectations or inputs updated), `docs/conventions-log.md` (one `practice` line, 2026-11-10), `docs/design.md` §3.15 (one sentence on the checker's language).
  - Checked: `npm test` 588 pass, 0 fail; `npm run docs:check` 0 errors. Before the change, the closed-line cases were reported as "no date" (probed with `checkRoadmap`). The accepted and rejected lines are unchanged.
  - Review (uncommitted change): two defects, both reproduced with `checkRoadmap` and fixed with a test that failed before: (a) a date in the title, followed by `(see note)`, was taken for the trailing group (fixed: the group is the one that closes the line's last `)`); (b) the language test read fenced blocks (fixed: lines outside fences). Done-when wording not changed.
  - Not checked: how the messages read to an adopter with a real English ledger.
- [x] C153 A run, several items in one request (2026-11-10, closed after the review)
  - Decided 2026-11-10 by the user in the planning session: a `RUN:` request names several items, and the leader takes them one at a time in the listed order. The queue is in the ledger, not in the Hub (design.md §3.15).
  - Changed: `tools/dev/roles/leader.md` ("Runs" section; the Commitments line, the step 3 pointer and the three "the user commits" lines qualified for a run), `docs/design.md` (§1.2 row 1, §2, §3.15, §6.1aa), `docs/usage.md` ("Several items in one request (a run)"), `docs/conventions-log.md` (one `practice` line).
  - Checked: `npm test` 588 pass, 0 fail; `npm run docs:check` 0 errors. The review of the first pass found two gaps, both fixed in the item's commit `eeb25af`: a default taken on a closed item (now recorded through the closing request), and a deployer not attached (now stops the run). The second review found no finding and three notes: three statements in design.md §6.1aa come from the leader's own account, and the last report said more than the readings show. The first real run, `RUN: C156, C152`, is recorded in design.md §6.1aa. Not observed in that run: the stop rules, a message from the user during a run, a default taken by the leader, a listed item with a status line. Done-when wording not changed.
- [x] C157 A reply with `reply_to` closes only the request it names (2026-11-10, closed after the review)
  - Raised 2026-11-10 by the user in the planning session (C156's review): a reply to a mid-run message also closed the `RUN:` request, because the Hub's closing swept every open request from that party.
  - Changed: `src/hub/store.ts` (`closedBy` and `answers`; the `closing` log line, written once at the first start and after the `seq` line in `compact()`), `src/hub/store.test.ts` (6 new cases in "Store: 返信の閉じ方 (C157)"; 2 expectations changed), `src/hub/mailbox.test.ts` (3 expectations changed to the new rule), `docs/protocol.md` §2, `docs/design.md` (two bullets), `docs/conventions-log.md` (one `format` line).
  - Checked: `npm test` 594 pass, 0 fail; `npx tsc --noEmit` clean; `npm run ui:check` 202 ok, 0 NG; `npm run docs:check` 0 errors. The review found no finding. Done-when wording not changed.
  - Not checked: a live Hub across the change (the compose Hub on 7777 runs the old code until it is restarted; it then writes the closing line once); an older Hub reading a log with a `closing` line.
  - Notes for what follows: a second reply to an already closed request falls back to the sweep (as decided); `docs/usage.md` lines near 28 and 144 still describe the old rule.
- [x] C158 The Hub started by `ui:check` writes to its own log, not the real Hub's (2026-11-10, closed after the review)
  - Decided 2026-11-10 by the user in the planning session; found the same day after a team ran `npm run ui:check`, when the last lines of `logs/hub.log` were from the check's own Hub (port 7793), not from the Hub on 7777.
  - Changed: `src/hub/log.ts` (`resolveHubLogFile`: unset or blank gives `logs/hub.log` under the agent-hub folder; a relative `HUB_LOG_FILE` is resolved from that folder), `src/hub/main.ts` (the file log uses it; the rotation goes to `<HUB_LOG_FILE>.1`), `src/hub/log.test.ts` (3 new tests), `tools/dev/ui-check.mjs` (sets `HUB_LOG_FILE` to `<work>/hub.log`; a failed run keeps its work folder and prints the path, a passing run removes it as before), `.env.example`, `docs/design.md` §3.14, `docs/usage.md` ("Hub log outside Docker").
  - Checked: `npm test` 597 pass, 0 fail; `npm run ui:check` 202 ok, 0 NG; `logs/hub.log` 85798 bytes with the same last line (`2026-11-10T09:30:59.519Z [hub] UI: http://127.0.0.1:7777/?token=***`) before and after a run; a real start of `src/hub/main.ts` on port 7798 with `HUB_LOG_FILE` in a scratch folder wrote its lines to that file; `npm run docs:check` 0 errors. The review found no finding. Done-when wording not changed.
  - Not checked: a failed `ui:check` keeping its work folder; a real Hub start with `HUB_LOG_FILE` unset (the default is covered by the unit test only).
  - Notes: a failed run keeps its work folder, a deviation from the spec's "keeps its log" that the work folder's deletion on every run would otherwise undo. A relative `HUB_LOG_FILE` is resolved from the agent-hub folder, while a relative `HUB_DATA_DIR` is resolved from the process's cwd (documented; harmless for `npm run hub`). `logs/hub.log` is written by the host Hub on 7777, started outside Docker; the compose Hub writes no file.
- [x] C146 Roles in another project's team know where agent-hub is (2026-11-10, closed after the review)
  - Decided 2026-11-10 in the planning session: through the shim's instructions, not a tool or a PATH command. Raised 2026-11-09 by the leader closing C141: another project's team did not know the agent-hub folder, so the closing check could not run there.
  - Changed: `src/shim/instructions.ts` (`agentHubFolderLine`; the line is added on both routes; the command quotes the folder), `src/shim/config.ts` (`ROOT` exported), `src/shim/role-instructions.test.ts` (2 new tests, one with a folder that has a space), `tools/dev/roles/leader.md` (the closing step: the folder comes from the line in the leader's own instructions, with a fallback when it is missing), `docs/design.md` §3.7.
  - Checked: `npm test` 599 pass, 0 fail; `npx tsc --noEmit` clean; `npm run docs:check` 0 errors. The review found two defects, both fixed: an unquoted folder broke on a space, and a shim started before C146 had no fallback in the closing step. Done-when wording not changed.
  - Not checked: a folder with a space in a real shell; a live session started after the change showing the line. Shims started before it, including this team's, do not carry the line; the closing step now says what to do then.
  - Reviewer note: the line puts the host's absolute path (for example, the user's name) into every role's instructions on both routes, including clients of other vendors. It is local configuration, not a received body.
- [x] C140 Keep a record of convention changes, with reading notes for old forms (2026-11-08, decided and closed by the planning session on the user's word; docs only, no review)
  - Raised 2026-11-08: a change to the conventions reaches every registered project at once. Policy in design.md §3.12, "When the conventions change": old forms stay readable, new restrictions enter as warnings, a practice change applies forward with a reading note; no version pin per project yet.
  - Changed: `docs/conventions-log.md` (new; lines for C51, C64, C65, C102, C133 and C134, dates checked against the closed lines and the commits), `CLAUDE.md` (map line), `docs/roadmap.md` (a pointer line at the top), `docs/design.md` §3.12 (a row in the table of conventions, the file named in the section, no format number on the index yet).
  - Survey from git: the rules at the top of this file changed in 17 commits between 2026-10-18 and 2026-11-06; two restrictions entered as errors at once (C25, C51), C134 as a warning. C25 was not written back, since the checker reads an indented status line as a status.
  - Checked: `npm run docs:check` 0 errors (before the close, only C140's own all-conditions-checked warning). No review. Done-when wording not changed.
- [x] C112 The C78 dragend scene in `ui:check` waits 800 ms before counting renders (2026-11-01, decided by the user)
  - `tools/dev/ui-check.mjs`: the dragend scene dispatches `dragend` and reads the render count, `isConnected` and the chip count in one evaluate, with no wait (the C101 fix); checks and verify text unchanged. `public/index.html` not changed (`ondragend` calls `flushMap()` synchronously).
  - Audit of the other C78 scenes: `released` and `dropped` read in the same evaluate as their action. `held` and `dragging` wait 2 s after an SSE post before expecting `renders === 0`; the wait is needed to let the update arrive, and a render in that window is a failure, so both stay (reason in the item's body, now removed with the section).
  - Checked: `npm run ui:check` ten runs in a row, each 157 ok, 0 NG, dragend scene ok; `npm test` 474/474 pass; `npm run docs:check` 0 errors. The leader checked the diff against SCOPE. No reviewer was connected (the user said to continue without), so the item had no review.
- [x] C110 The leader does not close an item whose done-when it could not meet as written (2026-11-01, decided by the user)
  - `tools/dev/roles/leader.md`: a done-when line not met as written (also when it failed before the work and still fails after it) sends no closing request; `NEEDS DECISION` with the facts and the proposed reading, and the item stays open. The flow step and the "Closing request (C102)" bullet cross-refer to it, and a reviewer finding of this kind goes to `NEEDS DECISION`, not to the deployer as a code fix.
  - `tools/dev/roles/deployer.md`: checks off a line only when it is met as written; otherwise leaves `[ ]` and writes the facts in `NOTES:` and in the section's body.
  - `tools/dev/roles/reviewer.md`: for `TARGET: C<n>`, a checked line whose facts do not meet its wording is a `FINDINGS:` entry.
  - `docs/design.md` §3.15: one paragraph ("A done-when line is checked only when its wording is met as written") states the rule for all three roles.
  - Checked: `npm test` 462 pass, 0 fail; `npm run docs:check` 33 items, 0 errors, 0 warnings (after the close). The reviewer read the uncommitted change; one finding (the parenthetical was wider in `deployer.md` and design.md §3.15 than in `leader.md`) was fixed in all places, and the planning session narrowed done-when line 1 to the same wording (bee8a8b). Not checked: a real team run where a line is unmet; a review of an item whose lines are all `[ ]` reads only the wording (C97 edge, not touched).
- [x] C109 Catch a turn that ends with a handed request and no reply (2026-11-01, decided by the user)
  - `public/index.html` (`stateOf`): a handed request with no reply after the turn ended, with an outgoing target that is not connected, shows `Stopped, no reply (<target> not connected)` (the C49 cause is named). With a background task still running within 60 minutes it stays `Needs you (<target> not connected)`, as C49 had it. The tab title, the tab icon and `#states` count the card's own state; `#backlog` counts layers and is unchanged.
  - `tools/dev/roles/leader.md` ("When the other side is not connected"): one rule for empty or unattached `recipients`: a review goes on as `NOT VERIFIED`; otherwise `NEEDS ACTION` names the role or Mailbox; `NEEDS DECISION` only when the address may be wrong; the report is sent with `post_message` before the turn ends.
  - `tools/dev/ui-check.mjs`: two scenes (the Stopped case with a role that has no Mailbox; the background-task case), each negative-checked against the previous code (NG: `Needs you (auditor not connected) · <1m`, then `Working · <1m`), plus count checks of the tab and `#states` against the cards. `docs/usage.md` (card states) and `docs/design.md` §3.15 (card states, the C109 exception) say the same.
  - Checked: `npm run ui:check` exit 0, 154 ok, 0 NG; `npm test` 462 pass, 0 fail; `npx tsc --noEmit` clean; `npm run docs:check` 32 items, 0 errors, 0 warnings (after the close). The reviewer read the uncommitted change; two findings were fixed (the background-task combination hid the C49 cause; two leader.md bullets gave one case two destinations). Not checked: a real team run in which a leader ends its turn with a handed request and an unattached reviewer; the favicon pixels; the scenes use hook events, not a real Claude Code turn. The Stop hook that would block a stop is not taken (decided).
- [x] C94 A settings button in the page header (2026-11-01, decided by the user)
  - Header: the Theme button is gone. The right side holds exactly three controls, the Map / Messages toggle, Health check and the gear (`#settingsToggle`, rightmost). The gear has `aria-expanded` and `aria-controls="settings"`.
  - Panel `#settings` sits inside `<header>` (absolute, under the header on the right, so the header's flex row is unchanged while it is hidden or open). It offers Follow the OS / Light / Dark as three `data-choice` buttons, marked with `aria-pressed`. The `localStorage` key (`agent-hub.theme`), the stored values, the `<head>` first-paint script and `applyTheme`'s data-theme rule are as in C93.
  - Open and close: the gear opens and closes it; a second press closes it; Escape closes it and returns focus to the gear; a press outside the panel and the gear closes it; a choice keeps it open.
  - Positions: fixed widths for `#health` (150px), `#mapToggle` (80px), `#settingsToggle` (34px) and `#conn` (140px, ellipsis). The right group is still anchored by `#health`'s `margin-left: auto`.
  - `tools/dev/ui-check.mjs`: the C93 theme scenes use the panel (`pressTheme(choice)`, the same states); four header and panel scenes added (exactly the three controls and no Theme button; the right controls' edges unchanged across a Health count change, Map ↔ Messages and a connection-label change, measured; open, close, Escape with focus on the gear, outside press, a choice keeps it open and is saved); one scene asserts the open panel's rectangle is below the header and inside the viewport and that `elementFromPoint` at its centre is the panel or a child.
  - Review fix (a reviewer finding): the panel was a sibling after `</header>`, and the body is not positioned, so it landed below the viewport and `body { overflow: hidden }` clipped it. Negative check: before the fix the rectangle scene failed (panel top 486 px, viewport height 482 px, centre point not hit). It was moved inside `<header>` and passes.
  - `docs/usage.md` (Light and dark theme) and `docs/design.md` §3.2 (header controls) describe the panel, its closing rules and the fixed positions.
  - Checked: `npm run ui:check` exit 0, 150 ok, 0 NG (145 before, plus five C94 scenes); `npm test` 462 pass, 0 fail; `npx tsc --noEmit` clean; `npm run docs:check` 29 items, 0 errors, 0 warnings after the close. The reviewer read the uncommitted change; the panel finding was fixed with a negative-checked scene. Not checked: a narrow (phone) width, where the fixed widths may crowd the left side (the connection label shrinks with ellipsis); the panel in dark theme beyond the scenes; keyboard tab order inside the panel beyond the three choices. Left as is (reviewer notes): Escape is a document-level handler that does not stop propagation (no conflict found, not tested); the moved theme scenes press explicit choices instead of cycling.
- [x] C97 Review the uncommitted change before the leader reports an item done (2026-11-01, decided by the user on 2026-10-31)
  - `tools/dev/roles/reviewer.md`: for `TARGET: C<n>` with at least one `[x]` condition, the reviewer also reads `git diff HEAD` and the untracked files from `git status`, plus the item's commits, and says in `VERIFIED` which it read. A commit range `TARGET` is still accepted.
  - `tools/dev/roles/leader.md`: "When to ask" sends `TARGET: C<n>` after the deployer's report and the leader's check, before the report to the human. Nothing is committed for it. The `NEEDS ACTION` (commit first) path is removed, and the review is not sent while the deployer is still working on the same tree. Flow step 2 points to it, and the no-reviewer rule (`NOT VERIFIED`) is kept.
  - `docs/design.md`: §3.12 (the reviewer's target can be an uncommitted change), and the C96 block in §3.15 (a new bullet with the order: deployer reports → leader checks → reviewer → fixes to the deployer → leader reports → human commits). `docs/usage.md` (teams in detail) has the same order.
  - Checked: `npm test` 412 pass, 0 fail; `npm run docs:check` 33 items, 0 errors, 0 warnings (after the close). Reviewed: the reviewer read the uncommitted change, no findings. This was also the first live run of the order (2026-11-01): the reviewer, started after the deployer's report, read `git diff HEAD` with nothing committed and said so in `VERIFIED`; the leader then had the deployer close the item before reporting (the order C102 writes down).
- [x] C96 Who files items, and where a reviewer's findings go (2026-10-31, decided by the user)
  - `docs/design.md` §3.15 (the new block "Who files items, and where a reviewer's findings go"): the planning session (the human's session with Claude where the project is discussed; not a Hub role) is the only place that files items, changes done-when wording and rejects items; progress is written by the deployer with the change; the three kinds of reviewer findings (`FINDINGS:` fixed in the request, `NOTES:` raised with the human, `OUT OF SCOPE:` candidates only) and where each goes. No section numbers changed, so the map in CLAUDE.md only gained a pointer in its §3.15 line.
  - `CLAUDE.md`: the map's §3.15 line, and "Updating the docs" (who files items; approved wording is written by the planning session; the deployer writes progress only).
  - `tools/dev/roles/reviewer.md`: `OUT OF SCOPE:` in the reply format, with the three kinds explained; a commitment that the reviewer does not judge whether a candidate becomes an item.
  - `tools/dev/roles/leader.md`: `OUT OF SCOPE:` goes to the human as candidates (`default: not filed`), never to the deployer; approved `PROPOSED CONDITIONS:` are returned in the report for the planning session, not sent to the deployer; a decided item is reviewed (`TARGET` = its commit range) before it is reported done, and a missing reviewer is written in `NOT VERIFIED`; filing and wording are not asked of the deployer.
  - `tools/dev/roles/deployer.md`: records progress only; a request to file or reword is not done and the planning session is named under `NOTES:`.
  - `docs/usage.md` (teams in detail): describes the `OUT OF SCOPE:` lines and where filing happens.
  - Checked: `npm test` 412 pass, 0 fail; `npm run docs:check` 29 items, 0 errors, 0 warnings. Each required phrase was checked by grep in the files named above. Not checked: a real team run, so the role changes are read, not exercised (a reviewer reply with an `OUT OF SCOPE:` line has not been seen by a leader yet).
- [x] C95 Show an opened map chip below the map, not inside its node (2026-10-31, decided by the user)
  - `public/index.html`: the open chip is one key (`mapOpenKey`, with `mapOpenInfo` kept after the edge closes), not a set. A chip keeps only the chip and gets an `open` outline. `mapPaneOf` renders the pane below the map (after the canvas, so the canvas and the nodes do not change size): seq, item, sender and receiver; the Message (`buildMsgBox`) or Event (`eventBody`) body with a height cap and its own scroll; a × that empties it. Clicking the same chip again also empties it.
  - The pane survives redraws (it is rebuilt from the model each time, and the C78 deferred redraw applies). When the edge is no longer open it says `Closed:`; when the receiver is hidden by the project or Mailbox filter it says so. The C92 notes (`not on the Hub`, `could not load`, `Loading…`) now appear in the pane.
  - `tools/dev/ui-check.mjs`: `MAP_STATE` reads the open state from the chip's class and the body from the pane (the only change to an existing scene's reader). Seven scenes added after the C92 scenes: a long-line request leaves the canvas width and node positions unchanged and fills the pane; the header names seq, item, from and to; one at a time; the same chip and × empty it; a redraw (new data, and a redraw held by an open select) keeps the pane; a closed request says so; a gone Message shows the C92 note in the pane.
  - `docs/usage.md` (the map) describes the pane, the one-at-a-time rule, the close, and the closed / hidden wording.
  - Checked: `npm test` 412 pass, 0 fail; `npm run ui:check` 140 ok, 0 NG; `npm run docs:check` 30 items, 0 errors; `npx tsc --noEmit` clean. The seven new scenes fail against HEAD's `public/index.html` (the first one fails on the canvas-width check). Forward to… and dragging from the chip are covered by the existing drag and Forward scenes, which pass unchanged. Not checked: the pane's look at a phone width; a real drag while the pane is open.
- [x] C92 Small rough edges of the map (2026-10-31, decided by the user)
  - `public/index.html` `drawMapArrows`: a request or waiting Event addressed to the human is not given the `back` class (it keeps its position, and an Event keeps its own dash); Mailbox-to-Mailbox requests against the role order keep the back arrow. `renderMap` passes `human` on each pair.
  - `public/index.html` `mapChip`: the "Forward to…" menu lists the Mailboxes that are in the composer's destination list (`#to`), the same list `fillForwardDraft` checks, and no select is shown when none is left. `fillForwardDraft` is unchanged.
  - `public/index.html` `ensureRequests`: a failed fetch by seq (network or HTTP error) goes into `mapFailed` and shows `could not load`; it is fetched again when the map is opened (`setMapView`) and when the SSE connects again (`connect`), not in a loop while the map redraws. `not on the Hub` (`mapMissing`) is only for a fetch whose list no longer has that seq. The Hub has no 404 for a seq lookup on the list, so "gone" is the Hub's answer without that Message, not a status code (a deviation from the done-when's wording, which is kept as written).
  - `public/index.html` `mapChip` select: arrow keys and Home/End/PageUp/PageDown or a letter mark the keyboard move, and the change it causes does not fill the draft; Enter fills the current value, and a change without a keyboard move (a click, or a choice in the open list) fills it. A value moved with the keyboard and then left unchosen is reset on blur.
  - `tools/dev/ui-check.mjs`: six scenes added after the map's drop scene (the human arrows; the destinations and a pick; a failed fetch that is not repeated; a retry on reopening; a gone Message; the arrow keys then Enter). No existing scene changed; the reviewer's attachment is kept in a variable for the human-directed request.
  - `docs/usage.md` (the map) describes the arrow style to the human, the destination list, the arrow keys, and `could not load` against `not on the Hub`.
  - Checked: `npm test` 412 pass, 0 fail; `npm run ui:check` 133 ok, 0 NG; the six new scenes run against HEAD's `public/index.html` and five of them fail (the "gone" scene passes on both, as a guard). Not checked: a real SSE disconnect (the reconnect retry is by reading `connect` only); the arrow keys with real key input (the scene dispatches keydown, change and keyup events, not a real popup); how the human arrows look (no visual check).
- [x] C89 An explicit item on a reply takes the original's project (2026-10-31, decided by the user)
  - `src/shim/main.ts` `itemFor`: a reply that names `item` takes `id` from the argument and `project` from the original Message's `meta.item.project` when it has one; otherwise the shim's `cwd`, as before. A reply without `item` is unchanged (C77). A non-reply keeps `cwd`. The original is read by `originalItem` (`GET /messages/:id`); an unreadable original falls back to `cwd`. No refusal of a disagreeing `item` (decided).
  - `src/shim/shim.test.ts` (new case): a reply from the shim's project naming `item` to a request tagged with `c:/other` is tagged with `c:/other`; a reply to an untagged request is tagged with the shim's project; a non-reply naming `item` uses the shim's project.
  - `docs/protocol.md` §3 (`post_message`) and §2 (`meta.item`) say where `project` comes from.
  - Checked: `npx tsc --noEmit` clean; `node --import tsx --test src/shim/shim.test.ts` 27 pass, 0 fail; `npm test` 407 pass, 0 fail; `npm run docs:check` 30 items, 0 errors, 0 warnings. Not checked: a real session naming `item` on a reply end to end.
- [x] C88 What the start-warnings record leaves out (2026-10-31, decided by the user)
  - `src/team/startlog.ts`: the pre-start line gets `kind: "start"` and the start's `time`; `splitByConnection` leaves connected roles (without `--force`) out of it. `buildResultRecord` / `recordResult` write a `kind: "result"` line with `start` (the pre-start `time`), `started`, `skipped`, `failed` (each with its reason) and `aborted`. The result is written on every start, and a failed write only warns.
  - `src/team/team.ts`: `runTeam` is a wrapper; the body (`teamStart`) fills an outcome, and the `finally` writes the result, so an early stop (claude does not run, the Hub does not start, a thrown error) still leaves one with `aborted`. `src/team/agent.ts`: `start-agent` writes its own result when started on its own (`started` on claude's spawn, `failed` when it cannot spawn or fails before that); `team` does not add one for an agent it starts.
  - `src/team/startlog.test.ts` (new cases): the split (connected skipped without `--force`); the pre-start line lists only the roles that will start and its `time` is the result's `start`; the result line with started, skipped and failed (reason) and its match to the pre-start line; a result without warnings, and an aborted one; a failed write returns an error and does not throw.
  - `docs/usage.md` (Start warnings) and `docs/design.md` §3.14 describe both lines.
  - Checked: `npm test` 412 pass, 0 fail; `npx tsc --noEmit` clean; `npm run docs:check` 29 items, 0 errors, 0 warnings. Not checked: `runTeam` and `runAgent` end to end (they need a Hub, claude and a tab), so the wrapper's `finally` and the agent's spawn events were checked by reading and typecheck only.
- [x] C86 Refuse a reply to a Message the sending Mailbox never received or sent (2026-10-31, decided by the user)
  - `src/hub/hub.ts` `postMessage` → `checkReplyTarget`: a reply from a Mailbox (`from.type === 'mailbox'`) passes only if `store.isRecipient(name, original)` or the original's sender is that Mailbox. Otherwise 400 `reply_not_received`, nothing stored or delivered. The message names the oldest open request that Mailbox received (`store.oldestOpenRequestTo`: id, seq, sender) or says there is none. Human replies are not restricted; forwarded copies go through `forwardMessage`, which is not changed (see NOTES below).
  - `src/hub/reply-target.test.ts` (new): the C80 case (deployer replying to the user's request to the leader is refused, names the leader's request, saves nothing, received stays 0); no open request; a human reply to another Mailbox's request passes; by name; by role; a forwarded copy received; its own Message; a reply after takeover. `mailbox.test.ts` (receipt by reply) now replies to a message the Mailbox received; `shim.test.ts` (C77 item inheritance) addresses its requests to the shim's Mailbox by name.
  - `docs/protocol.md` §1 (error codes named in the document) and §3 (`POST /messages`) describe the rule.
  - Checked: `npm test` 406 pass, 0 fail; `npm run typecheck` clean; `npm run docs:check` 31 items, 0 errors, 0 warnings. Not checked: the refusal through the shim's `post_message` tool in a real session, and the UI (unchanged).
  - Took the default without an answer (2026-10-31): (1) the two existing test edits accepted; (2) forwardMessage's missing replyTo check not filed.
- [x] C93 A light / dark / follow-OS theme toggle in the page header (2026-10-31, decided by the user)
  - `public/index.html`: a `Theme:` button after Map cycles auto → light → dark, kept in `localStorage` (`agent-hub.theme`, in `try`). A `<head>` script sets `data-theme` before the first paint; `applyTheme` sets it on a press or an OS change. The dark palette is one `:root[data-theme="dark"]` block (with `color-scheme`); the light palette is `:root`. The tab icon redraws in `applyTheme`, so its colors follow the chosen theme.
  - Checked: `npm test` 398 pass; `npm run ui:check` 127 pass, 0 failures (new scenes: the three states in order with titles; light on a dark OS and dark on a light OS, background and `--st-you`; the choice across a reload; follow tracking an OS change while open; the tab badge's pixel color per choice; `localStorage` blocked, page still works); `npm run docs:check` 32 items, no errors, no warnings. Not checked: the button and palettes looked at by eye in a real browser tab, and a Chrome with a real OS theme change (the OS was emulated through CDP).
- [x] C78 A map in the page showing where messages are stopped (2026-10-31, decided by the user)
  - Hub: `backlog.outgoing.to[]` entries carry `seqs` (oldest first, counted by the same rule as `count`; protocol.md §3). `src/hub/mailbox.test.ts` checks `seqs` against `count`, including a request closed by the other party's reply that was never handed over; `store.test.ts`'s reference count includes `seqs`.
  - `teamModel()` gains `edges`: one per open request and receiving Mailbox (or `#human`), with seq, item (`meta.item.id`) and time, plus the human's waiting Events (not draggable). A request's item and time come from the Message in the page, or from a fetch by seq (`ensureRequests`).
  - The map: a toggle in the header (`#mapToggle`) replaces the thread with `#map` in the same page; the composer and sidebar stay. Columns by role (human, leader, other roles, no role); chips stack at the receiving node; a request against the column order is a dashed back arrow (SVG over the nodes). A chip opens its Message through `buildMsgBox` (split out of `render`). "Forward to…" and a drop onto a Mailbox node call `fillForwardDraft`, which fills the Forward selection and the destination and sends nothing.
  - `ui:check`: 10 scenes on `map.*` Mailboxes (toggle, columns, one chip per request with a stack, item label, human event not draggable, back arrow, expansion, Forward to… filling the draft without a send, the Forward menu offering Mailboxes only, toggling back). 115 scenes pass; the 105 existing scenes are unchanged.
  - design.md §3.2 describes the view; usage.md "Seeing where requests wait (the map)"; CLAUDE.md's map lists it.
  - Checked: `npm test` 398 pass; `npm run ui:check` 115 ok, exit 0; `npm run docs:check` no errors.
  - Not checked: a real mouse drag onto a node (HTML5 drag is not driven by `ui:check`; the "Forward to…" menu fills the same draft and is what the scene tests). Requests whose address has no receiving Mailbox are not drawn (nowhere to put them). A request from the human to a Mailbox is not a chip (it shows in the receiver's card state). Not seen in a live browser session beyond the headless scenes.
- [x] C90 Derive the team once into a model that the cards render from (2026-10-31, decided by the user)
  - `public/index.html`: `teamModel()` derives from `mailboxList` (and the Messages and Events at hand) one entry per Mailbox with the card's fields and `waiting`, `signal`, `layers`, `awaitingSeq`, plus `human` (`waiting`, `stopped`, `working`). It touches no DOM and applies no filter. `renderMailboxes()`, `renderElsewhere`, `renderStates`, `renderBacklog`, `renderHealth` and `stoppedMailboxes` read it. The tab title and icon read the tab counts that `renderBacklog` copies from `human` (`tabWaiting`, `tabStopped`, `tabWorking`, unchanged for `ui:check`). `stateOf`, `layersOf` and `humanTurnOf` are called only from inside `teamModel()`. The model's card fields are the same as the old per-render derivations.
  - design.md §3.2 states the layering (data → model → views) and that C78's map is a second view of the same model.
  - Checked: `npm run ui:check` 105 scenes ok, exit 0, `tools/dev/ui-check.mjs` not edited; `npm test` 397 pass; `npm run docs:check` no errors.
  - Not checked: a look by eye in a browser beyond the scenes. The tab's counts are still the copy taken at the last render, as before; a focus change reads that copy, not a fresh derivation. The model is not in its own file and is not unit-tested (not decided, C90's note).
- [x] C82 Objections and review findings carry a failure scenario (2026-10-31, requested by the user)
  - `tools/dev/roles/reviewer.md`: each finding line names `breaks when: <input or state> → <wrong result>` and, when there is one, `instead:`, keeping `checked against:`. A finding that cannot name a breaks-when goes under a new `NOTES:` heading, apart from `FINDINGS:`. design.md §3.12's reviewer row says the same.
  - `tools/dev/roles/leader.md`: `FINDINGS:` lines may go to the deployer as fixes, after the leader checks their breaks-when. `NOTES:` lines are never sent to the deployer; they go to the user's report as `NOT VERIFIED` lines prefixed `reviewer note:` (or `NEEDS DECISION` if the user must decide).
  - design.md §1.2's sycophancy row points at reviewer.md and leader.md (Partly: the reviewer's findings only; objections from other roles are not covered).
  - Checked: the role files have no duplicate copies (`roles.json` holds descriptions, not these files); no test reads the role files' content (`team.test.ts` writes its own temporary `leader.md`); `npm run docs:check` no errors (28 items); `npm test` passes (397).
  - Not checked: a real reviewer run that replies in the new format. Objections from roles other than the reviewer are out of scope (a separate item if they come up). The done-when wording is unchanged. No ledger line waited on C82.
- [x] C85 Record a start's warnings locally, including a Claude Code outside the verified envelope (2026-10-31, requested by the user)
  - `src/team/startlog.ts`: `team` and `agent` started on its own append one JSONL line to `logs/start-warnings.jsonl` when the start has warnings (`team` writes one line for its roles; `agent` started by `team` writes none). It holds the time, project, HEAD, roles and Mailboxes, the `claude --version` output (`checkClaudeCli` in `checks.ts` now returns it), the last verified version with its §6.1 section, and the warning texts. A failed write prints one warning and the start goes on. The Hub is not involved.
  - The last verified version is the highest Claude Code version named after "Claude Code" in the headings of design.md §6.1 (currently 2.1.310, §6.1r; `6.2` and the Docker version in §6.1l are not counted). A newer `claude --version` is a warning; the start is not stopped.
  - usage.md "Start warnings" says where the file is and how to read it against `git log`. design.md §3.14 says what is recorded and what is not, and that sessions started by hand are not covered.
  - Checked: `npm test` 397 pass (new `src/team/startlog.test.ts`: version parsing and comparison; the §6.1 heading parse on a fixture, which excludes a version after `;` and a version in a body line; the newer-version warning and its absence; the real design.md; the line format and one line per append; a failed write returned, not thrown; no line without warnings); `npm run docs:check` no errors (29 items). The C58 warnings and the hook warning are written into the same line.
  - Not checked: a real `npm run team` or `agent` start writing the line (not run here: it opens tabs and starts claude). The newer-version warning on a real newer claude; the test uses a fixture version. Sessions started by hand are not covered, by design.
- [x] C80 Write down the working conventions agent-hub stands for (2026-10-31, requested by the user)
  - design.md §1.2 (new, after §1.1): the thesis, the input envelope, trust on evidence, sorting conventions by what they do, and "what is not written in the repository did not happen". A table lists each convention with where it is already enforced, or "not enforced yet". Not enforced yet: publishing and deleting data (no rule in the repository), running the affected tests while working (C84, rejected), a "direction first" reply at the start of work (no rule; §6.1n is a correction that arrived mid-work), an incident becoming a new verification angle (no step does it), and sycophancy (C82, proposed).
  - CLAUDE.md's document map lists §1.2.
  - Checked: `npm run docs:check` no errors (28 items). Each row was checked by grep against CLAUDE.md, `tools/dev/roles/*.md`, design.md §3.11, §3.13, §3.15, §3.16 and §6.1n, and `tools/hooks/post-commit-index.sh`. No `blocked(after C80)` or `held(after C80)` line existed. C82 and C85 name C80 only in their text, so their wording is unchanged. Not checked: no test or UI run (docs only).
- [x] C77 Let agents tag their messages with an item (2026-10-30, requested by the user)
  - `post_message` takes `item?` (`^C[1-9][0-9]*$`; a bad value is a tool error naming `item`, and nothing is sent). The shim builds `meta.item` as `{ id, project, source: null, promise: null }` with `project` from its working folder (the same value its Mailbox attaches with). A reply without `item` reads the original through `GET /messages/:id` at send time and copies its `meta.item.id` and `project`; an explicit `item` wins; no item on the original, or an unreadable original, sends no item. The shim keeps no record of delivered Messages. `parent` is not adopted (decided 2026-10-30).
  - The Hub serves `GET /messages/:id` (same token; 404 `message_not_found` for an unknown or deleted id) and returns the stored Message as is. Its handling of `meta` is unchanged: a test posts a `meta.item` with an extra key and reads it back untouched.
  - Item cards (`itemRequests` in `public/index.html`) count only requests from a `user` sender that are not unedited forwards. `ui:check` posts a later request with the same item from a Mailbox and forwards it unedited, and the card still shows the human's earlier request and its promise diff.
  - `tools/dev/roles/leader.md` tells the leader to pass `item` when `GOAL` starts with `C<n>`. protocol.md (§2, §3, §5) and design.md §3.15 (decision 3) are updated.
  - Checked: `npm test` 364 pass (new: `GET /messages/:id` x2 in `src/hub/app.test.ts`; `item` to `meta.item` with six bad values rejected, reply inheritance, explicit item wins, and no item when the original has none, in `src/shim/shim.test.ts`); `npm run ui:check` 88 pass; `npm run docs:check` no errors. Not checked: a real leader session passing `item` end to end.
- [x] C70 Give the browser tab a hub icon that shows the same two signals as the cards (2026-10-30, requested by the user)
  - `public/index.html`: `TAB_ICON_IDLE` at the top of the script holds the idle hub icon (SVG text, turned into a `blob:` URL because the page's CSP blocks `data:` images; empty gives the browser default). The tab draws the amber count badge (`--st-you`) with a white outline when the human is awaited (Needs you, Stopped, plus new arrivals while the tab is hidden, summed), the hub in `--st-working` when only someone is working (same `signalOf` as the cards), and the idle hub otherwise. Colors are read from the CSS variables at draw time (and redrawn when the color scheme changes). No blinking. The title count (`N waiting`) is unchanged and does not count Stopped.
  - Checked: `npm test` 364 pass; `npm run ui:check` all pass (the existing scenes for the tab title still hold). Not checked: the icon was not looked at by eye in a real tab strip (light and dark), and `ui:check` has no scene for the icon itself.
- [x] C75 The page reads the Hub's limits and retention instead of its own copies (2026-10-30, requested by the user)
  - `GET /config` now also returns `limits` = `{ maxUploadBytes, maxFilesPerMessage, readRetentionHours }` (`MAX_UPLOAD_BYTES`, `MAX_FILES_PER_MESSAGE`, the effective `HUB_READ_RETENTION_HOURS`; `main.ts` passes the retention to `createApp`). They are constants and an `.env` value, not read from `hub.config.json`; a `limits` key in that file is an unknown key and ignored. protocol.md, usage.md and design.md say so.
  - `public/index.html`: `MAX_IMAGE_BYTES` / `MAX_IMAGES` are gone; the image pre-check uses `hubLimits` (type and range checked, `null` when absent or invalid, in which case the check is skipped). `staleHandedHours()` = min(`STALE_HANDED_HOURS` 12, retention) when retention is a positive number, else 12 (unknown or 0 = not deleted).
  - Checked: `npm test` 386 pass (new: `limits` values and default retention, `limits` not settable from the config file, shim `MAX_FETCH_BYTES >= MAX_UPLOAD_BYTES`); `npm run ui:check` all pass (new scenes: pre-check refuses an oversize image and a second image under the Hub's values; no values, bad types and a failed fetch skip the check; retention 6 h makes an 8 h old hand-over not `Working` while 24 h, 0 and unknown keep 12 h; the real test Hub returns 20 MB, 4 and its retention 0); `npm run docs:check` no errors.
  - Not checked: an older Hub without `limits` against a real browser (simulated by stubbing the response).
- [x] C74 A read-only configuration file for the Hub and the page (2026-10-30, requested by the user)
  - `src/hub/config.ts` reads `hub.config.json` (or `HUB_CONFIG_FILE`) once at startup (`main.ts`); `GET /config` (behind the token, GET only) returns the validated values and warnings; the page loads them in `loadConfig` and uses `projects.olderDays` as a number only, showing warnings with `textContent` in `#cfgWarn`. First key: `projects.olderDays` (default 30, integer 1 to 3650). `hub.config.example.json` is committed, `/hub.config.json` is in `.gitignore`, `compose.yaml` and the `Dockerfile` set `HUB_CONFIG_FILE=/host/hub.config.json` (the existing `./:/host:ro` mount; no new mount). The shim, `npm run team`, hooks and `.env` values are unchanged.
  - Checked: `npm test` 383 pass (new `src/hub/config.test.ts`: missing file, non-JSON, directory, valid value, six bad `olderDays` values, range ends, unknown keys including `constructor` / `__proto__`, defaults not mutated, `GET /config` 401 without token / values and warnings / defaults / no write method); `npm run ui:check` all pass (new: the page takes the value as a number, rejects a non-number, shows warnings as text without rendering markup); `npm run docs:check` no errors. With Docker 29.9.2, `docker compose up` on another port and project name with a bad `hub.config.json` showed both warnings in the container log and in `GET /config`, so the mount is read.
  - Not checked: the warning's look in a browser by eye; a missing-file `docker compose up` (the missing-file path is covered by unit tests only). C75 and C73 are unchanged.
- [x] C76 One health check button that pings Mailboxes holding a request with no reply (2026-10-30, requested by the user)
  - `public/index.html`: a `Health check (N)` button at the top right of the page header (N = Mailboxes in `Stopped, no reply` across all projects, from the same `stateOf` / `backlog` the cards use; disabled at 0). Pressing it sends one `notice` from `user:browser` (ordinary `POST /messages`) to each such Mailbox, with `HEALTH_CHECK_TEMPLATE` (one constant near the top of the script) naming `backlog.awaitingReply.oldestSeq` and that request's id. No timer; a human presses it. The Hub (`src/`) and protocol are unchanged.
  - Checked with `npm run ui:check` (new scenes): the button shows the count at the top right and is enabled; the notices go only to the Stopped Mailboxes (`demo.deployer`, `demo.old`), one each, from `user:browser`, with the exact template, the oldest unreplied `#<seq>` and its id; the notice leaves `awaitingReply.count` unchanged and a reply to the original closes it as before; the count follows the backlog. `npm test` 365 pass; `npm run docs:check` no errors. `docs/usage.md` says what the button sends and to whom.
  - Not checked: a real agent acting on the notice. C79 stays `held(after C76)`: it is held on a decision after using the button, not blocked, so the ledger rules do not change it.
- [x] C72 Start the page on the project the team was started for (2026-10-30, requested by the user)
  - `npm run team` / `hub-team` prints `UI: <hub>/?token=...#project=<key>` (`uiUrl` in `src/team/team.ts`; the key is the page's `projectKey` of the team's folder, URL-encoded). The project is in the #fragment, not `&project=`, because the Hub's `GET /?token=` redirects to `/` and drops other query parameters; a fragment survives the redirect and never reaches the server. The page also reads a `project` query parameter. The Hub is unchanged.
  - The page (`takeUrlProject` in `public/index.html`) uses the value only when it exactly matches the first project list, then saves it; an unknown value is ignored (nothing stored, the stored value is restored as before); it is held as a string and never rendered. It removes `project` from the address bar as soon as it is read.
  - Checked: `npm test` 365 pass (new: `uiUrl` normalizes, encodes markup and quotes); `npm run ui:check` all pass (new scenes: parameter wins over stored and is saved and removed from the URL; a markup-bearing unknown parameter is ignored, not stored and not rendered; no parameter restores stored); `npm run docs:check` no errors. Not checked: a real `npm run team` run printing the URL (only `uiUrl` is tested).
- [x] C71 Express "working" and "waiting on the human" on cards, with colors that are easy to change (2026-10-30, requested by the user)
  - Cards: frames and state lines read only `--st-you` (amber: Needs you, Stopped), `--st-working` (blue: Working, Waiting on others) and `--st-ring` (3px), set in the top CSS block; dark mode redefines the two colors. Working and Waiting on others pulse over about 2 s; `prefers-reduced-motion` gives a steady ring. A change between signals flashes for 1.5 s (Idle: green, no frame); the first render and unchanged re-renders do not flash. An agent's unread messages are not a signal: a connected card with only unread messages says plain `Working` with no frame, pulse or flash (decided 2026-10-30).
  - Checked with `npm run ui:check` (87 pass): first render no flash and Idle has no frame; Idle to Working flashes and pulses; Working to Idle flashes green with no frame; an unchanged re-render does not flash; to Needs you, no pulse and the amber frame; reduced motion gives a steady ring and no flash; unread only gives no frame, pulse or flash; Stopped has the same amber frame as Needs you. `npm test` 360 pass; `npm run docs:check` no errors. `docs/usage.md` says what the cards show for the two signals and where to recolor them.
  - Not checked: dark mode and the feel of the pulse were not looked at by eye (dark mode is by the CSS block only).
  - Left open (2026-10-30): a card with only unread messages still says `Working` (muted) while it has no frame, so text and frame differ slightly. Renaming it (e.g. `Unread`) touches several `ui:check` scenes; not decided, kept as is.
- [x] C69 Check and fill in the Hub's hooks per event, for other projects too (2026-10-29, requested by the user)
  - Found when vcp's cards showed effort but no model: vcp's `settings.local.json` was copied before C61 and had no `SessionStart` / `PostModelSwitch`, and the start check passed because any `/events` counted. Copying `tools/hooks/settings.json` into another project also breaks `SessionStart`, whose `${CLAUDE_PROJECT_DIR}` then points at that project. Done with a published user in mind, not as a fix to vcp only.
  - `npm run team -- hooks [--project <dir>] [--write]` (`src/team/hooks.ts`) reads the Hub's hooks per event from the project's two settings files and `~/.claude/settings.json` (`/events`, `/events/<source>` or `post-event.mjs`), lists the missing events, and with `--write` adds only those to `settings.local.json` with agent-hub's script by absolute path and `HUB_PORT`, keeping everything else and a `.bak`. The start check (`hookWarning`) warns per missing event, about files that are not JSON and about a `post-event.mjs` that does not exist, and offers that command instead of a copy.
  - Checked: on vcp it reported `SessionStart, PostModelSwitch` missing (through `hub-team hooks`); on agent-hub, whose older copy posts to `/events`, all set. Writing vcp's file was left to the user (auto mode refused a session editing Claude settings). Tests cover none / some missing / a missing script / all set, and that `--write` keeps other keys and existing groups. `npm test` 360 pass, `docs:check` no errors.
- [x] C67 Starting a team from another project's folder (2026-10-29, requested by the user)
  - Decided with the user: a thin wrapper only, no skill (a session must not start a team by itself; design.md §2), and `npm run team`'s own `--project` default stays agent-hub. `tools/bin/hub-team.cmd` and `tools/bin/hub-team` (sh) add `--project <current folder>` unless one is given, then run `npm run team` in agent-hub's folder (`AGENT_HUB_DIR`, else two levels above the script).
  - Checked with a stub `npm` that prints its folder and arguments: from a folder with a space in its name the `.cmd` passed `--project "<that folder>"`, and a given `--project` was left alone; the sh version did the same under Git Bash. `hub-team.cmd --help` reached the real `npm run team`. A real team was not started through it. sh on macOS/Linux is not run on a real machine.
  - README "Using it in other repositories" has the one-line how-to. `npm test` and `docs:check` pass.
- [x] C68 Slim down the README (2026-10-29, requested by the user)
  - README went from 395 to 145 lines: it keeps the goals, status, setup, the first round trip, hooks and team start in short, and "Using it in other repositories". The reference parts moved to `docs/usage.md` (cards, commands, images, hooks, Forward, subscriptions, takeover, retention, teams in detail, Items, roles.json, `HUB_LANGUAGE`, inbox, curl, development) with the text unchanged except links. The "Inspiration" section was removed.
  - Fixed references: CLAUDE.md's document map, the pointers in `tools/hooks/post-commit-index.sh`, the UI tooltip and a comment in `public/index.html`, and design.md §6.1 (hooks step 3). Records in closed lines that name the README stay as they were.
- [x] C66 人宛ての本文の言語を 1 つの設定で決める (2026-10-29、ユーザーの依頼)
  - 設定は Hub の `HUB_LANGUAGE` (BCP 47 のタグ) にし、attach の応答の `language` で shim に渡す。shim は role の説明の後に「人宛ての本文は Japanese (ja) で書き、返事の型の見出しは訳さない」の 1 行を英語で差し込む。置き場の理由は design.md §3.5 (roles.json には全体で 1 つの設定を置く場所がない、shim の環境変数ではセッションごとに渡す手間がかかる)。README と `.env.example` に使い方を書いた
  - 読めない値 (`japanese`・`zz`) では Hub が起動しないこと、`JA` が `ja` になり attach の応答に載ることを、別のポートの Hub で確かめた。試験は `src/shared/language.test.ts` と `src/shim/role-instructions.test.ts` (設定あり・なし、Hub から取れないとき)。`npm test` 349 件が通る
  - 完了条件の 4 つ目 (英語の role の説明と `ja` でチームを起動して確かめる) は、英語の role の説明を作る C65 と互いを待つ形だったため、C65 の起動の確認に移した (2026-10-29、ユーザーが承認)
- [x] C65 Replace the published documents with English (2026-10-29, requested by the user)
  - Replaced `README.md`, `CLAUDE.md`, `docs/design.md`, `docs/protocol.md`, `docs/plan-p0.md`, the role descriptions (`tools/dev/roles/*.md`) and `roles.example.json` with English. The roadmap's header rules, phase headings, goals, acceptance criteria, `## Plan` and the open items use C64's English vocabulary; the records under closed lines stay in Japanese (out of scope).
  - Content was kept: design.md has the same 59 headings at the same levels (§1 to §10, including every §6 verification record), with decisions and dates as they were. CLAUDE.md's document map was rewritten against the English headings, and every section it names was checked to exist. Japanese left in the English documents is only the earlier vocabulary (in the mapping tables and where Japanese ledgers are mentioned) and strings the code emits, quoted as they are (the `inbox` texts, `--- まとめ ---`).
  - The leader now writes to the human with the English headings and the body in the user's language (`HUB_LANGUAGE`); `roles.json` on this machine was replaced with the English sample too (it was identical to the old sample).
  - Live check (design.md §6.1w): with the compose Hub rebuilt with `HUB_LANGUAGE=ja` and the English roles, an English request (#277) went leader → deployer (#278, English `GOAL`…) → leader (#279, English `CHANGED`…) → user (#280): English headings `RESULT` / `VERIFIED` / `NOT VERIFIED` / `NEEDS DECISION` / `NEEDS ACTION`, Japanese bodies. This also closes C66's live check.
  - Translating the open items changed the wording of their done-when conditions, so their promise fingerprints changed (a request sent earlier with `meta.item` for C3, C38 or C62 would show a diff). No such request was open.
  - `npm test` 349 pass, `npm run ui:check` 79 ok, `npm run docs:check` no errors.
- [x] C62 Starting the team on platforms other than Windows (2026-10-29, requested by the user)
  - `npm run team` (`src/team/`, run with tsx) replaces the PowerShell startup; `tools/dev/start-team.ps1` / `start-agent.ps1` stay as wrappers with the same parameters, and `team-checks.ps1` / `mailbox-name.ps1` were removed. Only opening tabs differs per OS (wt or a console window, Terminal.app, tmux); with none, each role's command is printed and the human runs it (design.md §3.8, §5).
  - Checked (design.md §6.1x): Linux in a container with a stub `claude` that runs the shim (tmux tabs, Hub start, attach, skipping connected roles, the print fallback, fast failure, no `claude`); Windows with a real `claude` through `start-team.ps1` (attached), and the console-window fallback.
  - Closed with macOS and a real `claude` session on Linux unchecked, as the user decided (recorded in design.md §6.2-8). A first Windows try opened the tab hidden (`windowsHide`), fixed before closing.
  - `npm test` 357 pass, `npm run docs:check` no errors. The UI did not change.
- [-] C81 Tie commits to items and requests with commit trailers (rejected 2026-10-30, item IDs are already in commit subjects, 53 of 193 this month; Hub-Request ids dangle once Messages are deleted, design.md §3.14; nothing reads trailers, as C22 derives "reflected" from the index)
- [-] C83 Approval levels by reversibility (rejected 2026-10-30, accepting after a silent window is deciding by timeout, against design.md §2; the reversibility split already exists as commit freely / push on the user's word and is a point of C80; recording instead of gating is C80's thesis)
- [-] C84 A checkpoint claim: a test set passed on a tree, within an envelope (rejected 2026-10-30, no need here as `npm test` takes about 12 s; a claim held by the Hub is knowledge, §3.14, and holding requests on it is orchestration, §2; hashing is solved per project by existing tools; "affected tests while working, the full set before reporting" is a point of C80)

## Items

Open items. How to write them is in the rules at the top (design.md §3.15). Integration by operating desktop apps' screens is out of scope and is not made an item.

### C3. Check real clients other than Claude Code, and how receivers read
Status: held(once an MCP client other than Claude Code is installed)

Today this has only been checked with the test MCP client.

In C2 on 2026-10-19, when two of the deployer's replies were forwarded to the leader (Claude Code) with the covering note "list the authors (forwarded_sender) and bodies", it answered that the author of both was the deployer. The covering note named the attribute, so whether it reads it as the author without being told is still unknown.

Once a real client is installed, also check with `tools/probe/resources-probe.mjs` whether `resources/updated` starts a turn (C1 checked only Claude Code and closed; design.md §6.1m).

#### Done when
- [ ] Whether a client other than Claude Code, such as Codex, calls `inbox` and treats the body as data, as the notice says
- [ ] Whether the receiving agent reads `forwarded_sender` as the author of the body (Channels path)
- [ ] The results are recorded in design.md §6

### C4. Connecting the storage of what was learned at breaks to engram
Status: proposed

Whether to connect the Hub with the flow that leaves what was learned at breaks (commits, items done) in engram. Optional.

### C10. Making the leader disposable
Status: proposed

The minimum version of the ledger (a list of unanswered requests), and who holds the trigger to discard it (the open questions of design.md §3.13). C129 would cover the list without a ledger.

### C11. The request ledger and checkpoints
Status: proposed

Declaring message shapes and checking them on the Hub, matching each request's SCOPE against `git diff`, fingerprints of acceptance and needs-re-confirming (design.md §3.11, §9-6).
The vocabulary is taken from the headings used every time in leader / deployer operation, not designed up front. New checks start as warnings only, and are raised to 400 after seeing that they agree with human judgment.

### C12. Opt-in delivery rules (automatic forwarding without human confirmation)
Status: proposed

The default is that a human presses Send (design.md §2). If added, it is opt-in, and the boundary with autonomous orchestration is in design.md §3.13.

### C14. Granting permission from the UI with the permission relay
Status: proposed

Use Channels' permission relay to grant tool execution permission from the UI (design.md §6.1).

### C15. Comparing plugin monitors with Channels
Status: proposed

Compare plugin monitors with Channels as a delivery path (design.md §6.2-3).

### C16. Adding `kind`s
Status: proposed

`handoff` for handing over at replacement, and so on (design.md §3.6).

### C17. De-duplicating `report_event` and `Stop`
Status: held(until showing P1's `Stop` turns out not to be enough)

A `report_event` tool for skills to declare breaks, and de-duplicating it against `Stop` (design.md §3.4).

### C18. Assigned areas and conflicts
Status: held(until there are two or more writing deployers)

First separate git worktrees per deployer; if that is not enough, record a request's `SCOPE` as the assigned area and warn of conflicts in the UI. Enforce with hooks only where it must be stopped (design.md §9-6).

### C19. Moving delivery to the official cross-session messaging
Status: held(until the posting format is in the official docs)

design.md §9-5. Even after moving, the source of truth for Mailboxes, roles and unread messages stays on the Hub.

### C20. Adding MCP Events (`events/stream`) to the shim
Status: held(until Claude Code supports MCP Events)

Add `io.modelcontextprotocol/events` (`events/stream`) to the shim (design.md §7).

### C22. Deriving "reflected" for requests on an item from changes in the index
Status: proposed

After a request with `meta.item: C<n>` is sent, if in an index that arrived through `docs:index` that item's done-when checks increased, or its section disappeared and became `[x] C<n>` / `[-] C<n>`, show reflected on the card (design.md §3.16). Show facts in the repository before the reply (self-report). The index needs the IDs of closed items and how they closed (`refs` of `parseRoadmap` is the material).

### C23. Prompting the sorting of requests without an item
Status: proposed

When a request without `meta.item` gets a reply, have the human choose "gather into an item / discard" (design.md §3.16). Where to show it, and how to keep the choice without the Hub holding it as knowledge, is open question 2 of §3.16.

### C35. Relaying requests from projects with their own ledger
Status: held(until running it shows what is needed)

What runs on the Hub is the repository the work was cut out into (with a `### C<n>.` ledger); `C<n>` is not mixed into a requesting project that has its own ledger or numbering (such as "item N" in thesis's CLAUDE.md) (2026-10-22, user; how to write it is in the global skill `roadmap-items`).
The example is thesis and cite-bridge: the design document and taking in (updating the submodule) are thesis's; the implementation and the ledger are cite-bridge's. The team starts in a standalone clone of cite-bridge, not inside thesis (so it does not read the parent's CLAUDE.md).
For now it runs without adding anything (`project` is a value; design.md §3.15). If something is added, it could be showing the "owner" (the requesting project) on the item card, or notifying the owner's Mailbox with a notice when an item finishes. Do not overthink it; decide once running it shows what is needed.

### C38. Showing sessions stopped by a usage limit apart from Working
Status: held(until the next usage limit is hit)

cite-bridge's deployer was stopped for 2 hours 20 minutes by a usage limit, but the Hub had no Event for the moment it stopped, and the card state (C37) must have shown `Working` (design.md §6.1q). Use the official hook `StopFailure` (when a turn ended on an API error) and Notification's `quota_auto_resume_*`. Whether `StopFailure` also fires while waiting for automatic resume is unverified (§6.2-6), so register it and check at the next limit. Decided by the user on 2026-10-23.
Implemented on 2026-10-26: convert `StopFailure` to `turn.failed` (with the `payload` as input), put `error` / `notification_type` in `backlog.lastEvent.detail`, and add Paused to the UI plus Needs you for `quota_auto_resume_stale` / `_disabled`. Checked by adding scenes to `ui:check`. `settings.command.json` is the command hook configuration that replaces only `Stop`; per the README's steps it is used in place of the HTTP `Stop`, and `StopFailure` from `settings.json` stays as it is. Adding `StopFailure` there would double it, so it was not added. Removing "and `settings.command.json`" from the done-when condition was proposed and approved by the user on 2026-10-26. The same day, `StopFailure` was added to the hook settings that have the Hub's `/events` (agent-hub's and vcp's `.claude/settings.local.json`; `~/.claude/settings.json` has no agent-hub hooks).

#### Done when
- [x] Add `StopFailure` to `tools/hooks/settings.json`, and the Hub takes it in as an Event (e.g. `turn.failed`, keeping `error` and `last_assistant_message` in the payload as they are). Align the hook steps in the `README` and the Event kinds in protocol.md
- [x] Add a `Paused` state to the UI's card, decided before Working. If the last Event is `turn.failed` (`error: rate_limit`) it is Paused (usage limit), cleared by a later `quota_auto_resume_fired` or `turn.end`. `quota_auto_resume_stale` and `_disabled` are Needs you (Enter is needed, or it will not continue automatically). Add the Events' display names too
- [x] Tests: the Hub takes in `StopFailure`'s payload as `turn.failed` (in the form of the tests for Event conversion in `src/hub`)
- [ ] Record in design.md §6 the order of Events when a usage limit is actually hit, and close §6.2-6 (if it did not fire, say so, and propose in the report narrowing Paused to what `quota_auto_resume_*` alone can show)

### C46. Sending document updates as signals to subscribed Mailboxes
Status: held(until it turns out that the reviewer reading the sources of truth on every request is not enough)

The "signals" layer of design.md §3.12. Send the differences in the index that arrive through `docs:index` (done-when conditions added or removed, sections added or deleted, closed `C<n>`) to a topic as notices pointing at places, so a session that holds context long (the leader) can learn its understanding has gone stale. The knowledge itself is not sent (§3.14).
Decide after C45, once it turns out that the reviewer reading the sources of truth on every request is not enough (criterion 2 of §1.1). Additions to §9's decisions are not in the roadmap's index, so picking them up would mean widening the index's scope.

### C47. Consulting another agent through a Forward with a fixed covering note
Status: held(after C3; it needs the independence of showing it to another vendor)

A future idea (2026-10-26, user). What kanary's /relay (design.md §8.1) speeds up is the hauling in the round of filing → consulting another agent → proposed corrections. On the Hub, put a "consult" button on the leader's reports and proposals; pressing it fills the send form with the address `role:reviewer` and a fixed question as the covering note, and a human looks and presses Send (design.md §3.12 "Send review requests by target, not by a stretch of conversation").
- The parts are mostly there: unprocessed Forward, the covering note (P2 acceptance criterion 5), and Reply / Forward and Relay's counts to bring the answer back to the leader. What is added is only the fixed texts and the button.
- The fixed text is only the question; what to check against is left to reviewer.md (C45). A few kinds (consistency: does it contradict decisions, non-goals, rejections / refutation: is anything overlooked / promise: can each done-when condition be checked on its own). If the original message has `meta.item`, insert the item number.
- The fixed texts live in the repository's configuration, like `roles.json` (configuration, not knowledge; §3.14).
- The independence of showing it to another vendor needs a reviewer other than Claude Code, so after C3. Until then it goes only as far as a fresh context and a different model.
- Decide the content of the fixed texts after C45 settles the reviewer's conventions.

### C50. Decide a pool where agents temporarily put what they make, and hand it over by reference from the Hub
Status: proposed

2026-10-27: prompted by a remark from the author of kanary relay (passing images and HTML mock-ups made with inline widgets in the desktop apps to another AI through a local path to double-check them), the user set the direction. Not only images: the abstraction is **deciding where the pool for provisionally placing what agents generate lives, so the Hub can refer to it**. The speed of seeing things inline is the client's job, and we do not chase it (design.md §2, §8.1).
Today the only image path is "browser → agent" (design.md §3.10). An agent's `post_message` has no way to attach a file. Writing a path in the body lets a party on the same machine open it with `Read`, but it does not appear in the human's UI and is not covered by retention management.

Rules to keep (forms that touch them are not adopted):
- The Hub is 127.0.0.1 only, with token authentication on every API (§3.8, §4). The compose Hub is inside a container, so it sees only what is mounted.
- The Hub holds only state for delivery (§3.14). The pool is not a place for knowledge; it is temporary and disappears after a period.
- Content from other agents is treated as data (§4, protocol.md §6). The UI does not execute HTML and the like (images are displayed; others are shown as content or a link without being opened, for example).
- Content is not summarized or processed. A string from a Message is not used as a path as is (following how ids are handled in §3.10).

To decide:
1. Where the pool is: per project (e.g. `<project>/.agent-hub/pool/`, gitignored) or one on the host (`HUB_POOL_DIR`).
2. How the Hub refers to it: mount the pool into the Hub read-only, or have the shim upload to the Hub (if mounting, decide the form for both compose and the direct start).
3. How a Message points at it: align with §3.10's `meta.files` (id), or a relative path within the pool. The receiver gets a `path`, as now.
4. Which kinds to handle and how the UI shows them: images (A/B/C side by side to compare), HTML mock-ups, text and diffs.
5. Who handles expiry and cleanup (align with the images' TTL in §3.14?).
6. Whether to merge §3.10's path for images from the browser into the same pool.

Related: it becomes the destination for having another agent or vendor double-check, in C47 (the consult button) and C3 (clients other than Claude Code).

### C60. Making which notifications Noise includes configurable
Status: held(after C59)

C59's Noise treats notification-type Events as fixed. Let a human configure what Noise includes (per Event kind). Where the setting lives is decided by looking at what C59's implementation showed: per browser in `localStorage` like the other filters, or shared in the Hub's configuration file (C74). C74 does not decide this. Once decided, remove the status and write the done-when conditions.

### C79. A watcher that nudges on a timer
Status: held(decide after using C76's Health check button for a while)

Raised 2026-10-30 as the second step of C76. A separate, non-LLM program and ordinary API client with its own Mailbox (e.g. `hub.watcher`), not code in the Hub: the Hub stays address-and-delivery only and never writes text itself; nudges are visibly from the watcher, and stopping it stops them. Every interval it reads `backlog` (the same derivation as the cards) and sends C76's cue (what the Health check button sends) to a Mailbox that holds a handed request with no reply and has shown no activity for T. Skips: a Mailbox waiting on others, and a request already nudged (one per request). Vendor signals (Claude's `turn.end`) may only make it faster, never required.

- 2026-11-09: a timer would not have caught C142's case (the deployer stayed `Working` after a Hub outage, so it was never `Stopped, no reply`). C142 goes first.

Open: the opt-in setting that allows sending without a human's Send, and the boundary it needs in design.md §2; how "no activity" is judged without vendor hooks (last Message sent, last `inbox` call, attachment heartbeat); how it is run (`npm run watcher`, a second compose service). Decide after using C76's button for a while.

### C87. The tab icon lags while the tab is in the background
Status: proposed

Seen 2026-10-31: with the agent-hub tab behind another tab, its icon stayed idle grey while the deployer was Working, and turned blue when the tab was brought forward. Likely cause, not measured: after an SSE message the page re-reads Mailboxes through `setTimeout` (`refreshMailboxes`, 300 ms), and Chrome throttles timers in hidden tabs, to about once a minute after a while. The icon (C70) exists to be read from the background.
Seen again 2026-10-31 after a Hub restart (C86's run): with the tab in the background, the icon did turn blue when the team started working, so the lag is not every time. A likely difference is how long the tab had been hidden (Chrome's heavier throttling starts after about five minutes hidden), not yet measured.
To decide after measuring: the delay with the tab hidden, then whether to re-read without a timer when hidden, or to update the state from the SSE event itself.

### C91. The human's open requests on the map
Status: proposed

Found 2026-10-31 in a review of C78. The map's chips come from `backlog.outgoing.to[].seqs`, and `outgoing` counts only what a Mailbox sent (`from.type === 'mailbox'` in `src/hub/store.ts`). A request from the human is not in anyone's `outgoing`, so the most common stop, the human's request to a `leader` that is Stopped, has no chip: the leader's card state shows it, but it cannot be expanded or forwarded from the map. The receiver's `backlog.awaitingReply` and `unread` have only a count and the oldest seq, which is not enough for one chip per request (the reason C78 added `seqs`).
To decide: where the seqs come from (`seqs` on the receiver's `awaitingReply` and `unread`, or an `outgoing` for the human across its user ids `browser` / `cli`), and how the chip is drawn (an edge from the human node, which runs along the role order, unlike a Mailbox's request to the human).

### C105. Switch between projects with running teams from the page header
Status: held(after the user has run teams in two projects side by side)

Raised 2026-11-01 by the user: projects where a team was started could show as tab-like buttons, so switching is one press (today it is the project selector above the sidebar). The user wants to run two teams first and decide then. design.md §3.2 chose a selector over tabs so waits in other projects are not missed (`N waiting in other projects`); buttons have to keep that.

### C122. Do channels now work with `claude -p`?
Status: proposed

Found 2026-11-03 while checking C121. design.md §6.1 (checked 2026-10-16) says a channel "works only in interactive sessions. It is ignored with `-p` and the Agent SDK." The official Channels page read on 2026-11-03 now says: "When you run channels in non-interactive mode with `-p`, tools that need terminal input, such as multiple-choice questions and plan mode approval, are disabled so the session never stalls waiting for input." That reads as if `-p` sessions now receive channel messages.
If so, it matters: a role could run without a terminal tab (the tab openers, C62/C116), but a `-p` session ends after its turn, so how it would stay to receive the next message is unknown.
To decide after checking: on a real machine, whether a `claude -p` session started with `--dangerously-load-development-channels server:agent-hub` receives a Hub message, and whether it stays alive to receive another; record the result with the Claude Code version in design.md §6 and correct §6.1. Whether to use it for roles is a separate item.

### C123. Send `docs:check` results to the Hub, and check `CHANGED` for missing docs
Status: proposed

Split from C9 on 2026-11-03 (design.md §3.12, layer 1). The Hub does not read the working tree (§3.8), so the checks run on the host, in the leader's checking steps or a Stop hook, and their results would be sent to the Hub as a notice or Event and shown in the UI.
The other half: a deployer's reply whose `CHANGED` lists `src/` but no `docs/`. Whether that is read by the Hub (the shape of `CHANGED` is not declared yet; C11) or by the leader's checking steps is open.


### C129. After a context reset, let the session fetch which requests are still open
Status: proposed

Raised 2026-11-03 from the official page on what survives compaction (design.md §6.1z). Hub Messages arrive as conversation, so a context reset (compaction, `/clear`, or the like in other clients) loses who asked what and which replies are awaited: a leader can lose the deployer's open request, a deployer the request it is working on. The design is in design.md §3.13 ("Restoring delivery state after a reset"), split like §3.9 into common content and a per-client trigger.
- Content (any MCP client): one shape for this Mailbox's requests owed a reply (`backlog.awaitingReply`) and awaiting one (`outgoing`), as pointers only (`id`, `seq`, the other side, `meta.item`; no bodies), the text made in one place in the shim. Through a shim tool or the head of `inbox()`. The shim's instructions say when to fetch it (at start, and whenever the session does not know what it is waiting on), which is the whole trigger for a client without hooks.
- Trigger for Claude Code: a `SessionStart` command hook for the `compact` / `clear` / `resume` sources prints the same content into the new context. It prints nothing with no token, no Mailbox or nothing open, and never fails the start.
Open before deciding: a new tool or the head of `inbox()`; whether the hook asks the Hub directly (like the Event hooks) or reuses the shim's text through a Hub endpoint; whether `startup` prints too; the exact text. Covers the list half of C10.


### C131. Name the file actually read when the default ledger matches by letter case only
Status: proposed

Raised 2026-11-05 from the vcp check (C130). Paths on Windows (and macOS by default) are case-insensitive, so with no `.agent-hub.json` the default `docs/roadmap.md` opens a `docs/ROADMAP.md`: in vcp `existsSync('docs/roadmap.md')` is true and `realpathSync.native` gives `docs\ROADMAP.md`. `src/docs-check/send-index.ts` then says "docs/roadmap.md has no `### C<n>.` items", naming a file that was not the one read.
- Idea: when the real name differs from the configured one only by case, name the real file in the reason (and in the team start's summary, which passes the same reason on), e.g. "docs/roadmap.md opened docs/ROADMAP.md (letter case differs), which has no items". Whether to also warn when such a file does have items is open.
- docs/project-setup.md §7 already describes the pitfall; that line would point at the new message once built.

### C135. Let the planning session receive the leader's reports
Status: proposed

Raised 2026-11-05 (cite-bridge). The planning session is not connected to the Hub (design.md §3.15: it is not a Hub role), so after each item the user typed "C10 done" into it before it could check. The friction is the relay, not the guidance.
- Idea: a read-only connection for the planning session that receives reports addressed to the user (no requests, no role), or the Hub notifying it when a report arrives. This revisits "the planning session is not a Hub role", so it needs a decision on that first.
- Background from the same session, on how long the planning session stays needed. Its work split into three: relaying reports (should move to the Hub), checking independently (re-running tests with pymupdf hidden, reading callers the team did not mention; shrinks as the reviewer and `docs:check` grow), and deciding promises with the human (filing, done-when wording, order). The third is a separate seat from a leader that may be disposable (§3.13), and is expected to stay, maybe inside the UI later. A measure for the second: the share of items where the planning session's check found something the team's report did not (2026-11-05: 1 of 3, C10's close).

- Premise from the user (2026-11-06): the planning session must be able to grasp the Hub's state quickly. Reading it on demand (C139) comes first and does not need the planning session to be a Hub role; receiving reports here is the push side and can follow.
- A second case, 2026-11-06 (cite-bridge C22): the leader's `NEEDS DECISION` on done-when wording went to the user, who pasted it into the planning session; the planning session fixed the ledger; the request then went out stale (C138) and the leader asked the same question again. One decision took two relays by hand and one wasted round trip.

### C136. Give each working convention its lineage and function, and re-check its status
Status: proposed

Raised 2026-11-06 in the planning session, after the comparison with mcp_agent_mail and open-agent-bridge (design.md §8.6). Direction from the user: agent-hub is meant to be adopted by others, and to embody the practices that have supported development in a form that still holds when the practitioner is an AI (stateless, replaceable, inclined to agree). §1.2 already sorts conventions by what they do, but its table does not say which traditional practice each one descends from, its statuses were last checked on 2026-10-31, and it does not say which enforcement runs in a project other than this repository (the repository-specific checks of `docs:check` do not; other projects get the roadmap rules only).
- Idea: add the columns "Descends from" and "Function it keeps" to the §1.2 table; re-check each Status against the repository; list the practices the table lacks, with a reason for each one not added. Candidates to judge, not to assume: the definition of done (the ledger's done-when), handoff and onboarding documents, release and rollback. Commit trailers (C81) and approval levels by reversibility (C83) were rejected on 2026-10-30; do not reopen them here without new evidence.
- Why: the lineage is what an adopter understands at a glance ("this is code review, for reviewers who agree too easily"), and it is the part that a copy of the documents does not carry without the checks behind it.
- Documentation only. Which "Partly" row to strengthen first is decided afterwards, as separate items.

#### Done when
- [ ] design.md §1.2's table has, for every row, the traditional practice it descends from and the function it keeps.
- [ ] Every row's Status was re-checked against the repository (the named files and checks) and corrected where stale; the section records the date of the check.
- [ ] Each practice the table lacks was either added as a row or listed with a one-line reason for leaving it out.
- [ ] The table says, for each enforcement, whether it runs in a project other than this repository.
- [ ] Each row that is not fully enforced either points to a `C<n>` item (proposed) or says it is not planned, with the reason.
- [ ] `npm run docs:check` passes.

### C137. Give a project's planning session a thin block that points at the ledger rules
Status: proposed

Raised 2026-11-06 in the planning session, from mcp_agent_mail's paste-in block (design.md §8.6). The team roles get their instructions through the Hub. The planning session does not (it is outside the Hub, yet it files items, writes done-when wording and decides the close), and in another person's setup nothing tells it agent-hub's conventions. On this machine they come from the user's own global instructions and the `roadmap-items` skill, which an adopter does not have.
- Idea: a short block an adopter pastes into the instruction file their planning agent reads. It points and does not copy: the ledger's path, where the rules live (the top of roadmap.md, usage.md's "Try a round trip between roles"), and the check command (`docs:check`). Copied rule text drifts: when C133 changed the close order, the user's global instructions had to be fixed by hand. The same idea as the thin post-commit hook that calls agent-hub's script (project-setup.md §2).
- Not tied to one vendor (design.md §3.7): the planning agent is not always Claude Code. The block is plain text with plain shell commands, without one vendor's tool names, skills or file conventions. Which file it goes in (`AGENTS.md`, `CLAUDE.md` and so on) is the adopter's choice; the guide names the common ones without preferring one.
- To decide: whether the block goes in the project's file (committed and read by collaborators who may not use agent-hub, while agent-hub's path differs per machine), in the user's own instructions, or split between them; whether project-setup.md §7's readiness check looks for it.
- After C136: the conventions its table finds not reaching other projects are the candidates for what the block points at.

### C138. Do not let an item card draft a request from an index older than the ledger
Status: proposed

Raised 2026-11-06 (cite-bridge C22). The planning session fixed C22's done-when wording in the working tree without committing. The index reaches the Hub only at the team start and after a commit that touches the ledger (post-commit hook), so the item card still showed the old wording, and the user sent it again. The leader read the request against the code, not against the ledger file, and stopped with the same question as before (#1010, #1013). The fix was a manual `npm run docs:index` from the project.
- Ideas, not decided: (a) the card or the draft says when the ledger file changed after the index was sent (file mtime or hash beside the index); (b) the Hub or the team re-sends the index when the ledger file changes (a file watch while the team runs); (c) the planning-session guidance (C137's block) says to run `docs:index` after editing the ledger without a commit; (d) the leader compares a request's DONE WHEN with the ledger's current text and, when they differ, says the request came from an old index instead of re-asking the decision.
- (a) or (b) removes the cause; (c) and (d) only soften it. (d) also matters on its own: the ledger is the source, and a request is a copy of it.
- Recurred 2026-11-09 (arb-sentinel C12). The planning session reworded and unchecked done-when lines in the working tree (an addendum after 429s in production); the card still showed the team-start index (`0/4 done`, the old line number) until a manual `docs:index`. That project had no post-commit hook, but the hook would not have helped: the edit was not committed. The `roadmap-items` skill now says to run `docs:index` after editing a ledger ((c), on this machine only).

### C139. Let `status` show what is happening per item, for the planning session
Status: proposed

Raised 2026-11-06 (cite-bridge C22), from the user's premise that the planning session must grasp the Hub's state quickly (C135). `team status` (C108) gives per-Mailbox counts and the newest report to the human only. In C22 the planning session could not tell from it which item the leader was waiting on (`awaiting reply 1 (oldest #1014)`), what the earlier exchange was (deployer's question #1008, leader's hold #1009, the two reports #1010 and #1013), or that the item card was drafting from an old index (C138). It read `/messages` with curl after searching the Hub's source.
- Idea: `status --item C<n>` lists that item's thread in order (requests carrying `meta.item`, the replies under them: seq, sender, first line), and plain `status` adds one line per open item with a request in flight (item, who holds it, waiting since). It also says when the ledger file changed after the index was sent (C138's (a), shared code).
- Read-only, like C108; the card states stay the page's job. Whether `status` should also show the newest `NEEDS DECISION` per item is open.


### C144. `ui:check`'s test Hubs write into the real `logs/hub.log`
Status: proposed

Raised 2026-11-09 by the reviewer of C142 (#322). Every Hub that `ui:check` starts runs from the agent-hub folder, outside Docker, so C143's log appends its start and stop lines (with the token masked) to the same `logs/hub.log` the human reads after an outage. C142 added two more starts per run (`restartHub`).
- Ideas, not decided: (a) the Hub takes the log path from an environment variable, and `ui:check` (and other test starts) points it into its own work folder; (b) the Hub writes no file when `HUB_DATA_DIR` is not the default; (c) each line names the port, so test lines can be told apart (softens only).

### C145. Pressing a state chip during a redraw loses the highlight
Status: proposed

Raised 2026-11-09 by the reviewer of C142 (#322). The C106 jump highlights a card, and a redraw driven by SSE within the highlight's 3 seconds replaces the card nodes, so the highlight is gone and the press seems to do nothing (measured in `ui:check` run 14: `replaced: 2`). `ui:check`'s `press` / `press2` now wait for the redraw to settle before clicking, so the check no longer covers this case.
- The C106 failures during C142 were most likely the port clash (two `ui:check` runs on 7793 and a leftover Hub), not C142's code: the planning session ran the strict check without the wait on HEAD's page and on C142's page, 2 of 2 passing each.
- Ideas, not decided: (a) the jump re-applies the highlight to the rebuilt card (keyed by Mailbox name) until its time ends; (b) the card rebuild keeps nodes whose content did not change; (c) a `ui:check` scene that redraws right after the press.

### C147. Put the files and messages an adopter meets first into English

Raised 2026-11-10 in the planning session, from a pass over what is still immature against the direction of adoption (design.md §1.1, 2026-11-06). C65 put the documents into English; the rest of the repository was left. Counted the same day (lines containing Japanese): `.env.example` 13, `compose.yaml` 7, `Dockerfile` 2, the `description` in `package.json`, 154 lines with Japanese inside string literals in `src/` outside tests (for example the 404 text in `src/hub/app.ts`, the start messages in `src/hub/main.ts` and `src/shim/main.ts`, `src/shim/instructions.ts`, `src/shim/tools.ts`, `src/shared/roadmap.ts`), 682 comment lines in `src/` outside tests, 884 lines in tests (mostly test names), 456 in `public/index.html`, 460 in `tools/dev/ui-check.mjs`.
- Some of the Japanese is vocabulary the code must keep reading (`## 予定`, `状態:`, the reply-format headings `結果` and so on; design.md §3.15). That stays.
- Idea: first the files an adopter edits or reads at setup (`.env.example`, `compose.yaml`, `Dockerfile`, `package.json`) and the text a running Hub, shim or command prints or returns. The checker's messages are C152.
- Decided 2026-11-10 in the planning session (the user left the choice to it): this item covers the setup files and the text a running Hub, shim or `npm run team` prints, returns over HTTP or gives an agent (the shim's instructions and tool descriptions). That text is English only; `HUB_LANGUAGE` stays for what agents write to the human (design.md §3.5). Comments, test names, `public/index.html` and `tools/dev/ui-check.mjs` are left as they are; a later item if wanted. The checker's messages are C152.

#### Done when
- [ ] `.env.example`, `compose.yaml`, `Dockerfile` and the `description` in `package.json` have no Japanese.
- [ ] String literals in `src/` outside tests that a running Hub, shim or `npm run team` prints, returns over HTTP or gives an agent are English, except the vocabulary the code reads (design.md §3.15) and `src/shared/roadmap.ts` (C152).
- [ ] The body records the command used to list the Japanese left in string literals in `src/` outside tests, and that its output after the change is only that vocabulary and `src/shared/roadmap.ts`.
- [ ] The body lists the Japanese the UI shows on screen (found, not changed here).
- [ ] `npm test` and `npm run docs:check` pass.

### C148. Run the checks in CI on Windows and Linux

Raised 2026-11-10 in the planning session. The repository has no CI: `npm run typecheck`, `npm test` (584 tests on 2026-11-10) and `npm run docs:check` have only been run on the development machine (Windows 11). The README's Status says `npm run team` "is covered by unit tests on every OS", but nothing runs the tests on another OS. Whether they pass on Linux or macOS is not known.
- Idea: one GitHub Actions workflow on push and pull request, with a matrix of `windows-latest` and `ubuntu-latest`, running the three commands. It backs the README's sentence with a run, and covers the unit-test half of design.md §6.2-8 (a real `claude` session on Linux or a Mac stays unchecked).
- Decided 2026-11-10 in the planning session (the user left the choice to it): `windows-latest` and `ubuntu-latest`; macOS joins when someone uses agent-hub on a Mac. `ui:check` stays off CI (it needs Chrome and free ports; C151). A test that cannot pass on Linux is fixed, or skipped on that OS with the reason written in the test. The tests can be tried on Linux before the push in a Node container (Docker is on the development machine).

#### Done when
- [ ] A workflow under `.github/workflows/` runs on push and pull request to `main`, with a matrix of `windows-latest` and `ubuntu-latest` on Node LTS, running `npm ci`, `npm run typecheck`, `npm test` and `npm run docs:check`.
- [ ] Tests that failed on Linux are fixed, or skipped on that OS with the reason in the test; the body lists them.
- [ ] A run on GitHub Actions passed on both systems (after the user's push), and its URL is in the body.
- [ ] The README's Status says what CI runs, and design.md §6.2-8 says the unit tests are covered by CI while a real `claude` session on Linux or a Mac stays unchecked.
- [ ] `npm test` and `npm run docs:check` pass.

### C149. Check design.md §6.2-4 and §6.2-7 on a real machine, and settle §6.2-1

Raised 2026-11-10 in the planning session. Three entries of design.md §6.2 have no item, and two of them can be checked on this machine now.
- §6.2-4, escaping of Channels' `meta` attribute values: the provisional restriction (only the known keys of `files` go on Channels; `channelMeta` in `src/shared/format.ts`) has stood since 2026-10-16. The entry already says how to check (`tools/probe/`, `GET /case/attr` with `probe_quote: 'a"b<c>&d'`). The result decides between using `escapeAttr` for `meta` and leaving values as they are, and whether the restriction is lifted.
- §6.2-7, whether `/clear` changes the hook's `session_id`: C41's rule for whose questions count depends on it (the closed record of C41 says the behaviour is unverified). Check the hook input before and after `/clear`, and whether the Event still resolves to the Mailbox (the first means of design.md §3.4).
- §6.2-1, "Windows-specific: path notation, line endings": it names no behaviour to check. Either write what is unverified, or remove the entry and say where the confirmed parts are recorded.
- Results go to design.md §6 with the Claude Code version. A code change that follows from a result (lifting the restriction, a change to C41's rule) is a separate item.
- Decided 2026-11-10 in the planning session, as written above. The `/clear` check needs a session the user types into; it waits for the user's hands like other such checks.

#### Done when
- [ ] §6.2-4 was checked with `tools/probe/` as the entry says, and design.md §6 records how a quote, `<`, `>` and `&` in a `meta` value arrive, with the Claude Code version; §6.2-4 is removed or points at the result.
- [ ] §6.2-7 was checked: design.md §6 records the hook input's `session_id` before and after `/clear` in one session and whether the Event still resolves to the Mailbox, with the Claude Code version; §6.2-7 is removed or points at the result.
- [ ] §6.2-1 names what is unverified, or is removed with a pointer to where the confirmed parts are recorded.
- [ ] No code changes from the results are made here; the body names any that follow, for the planning session.
- [ ] `npm run docs:check` passes.

### C150. Make the card state derivation testable and usable outside the page

Raised 2026-11-10 in the planning session. The card state (Needs you / Working / Waiting on others / Stopped / Paused; design.md §3.15) is derived by `stateOf` in `public/index.html`, which has no unit tests; `ui:check` covers it scene by scene and needs Chrome. `src/team/status.ts` (C108) does not derive states. Two open items need "the same derivation as the cards" outside the browser: C79 (the watcher) and C139 (`status` per item). Built as they stand, each would copy the rules, and the copies would drift.
- Ideas, not decided: (a) move the derivation into a module without Node APIs under `src/shared/`, which the Hub serves to the page and the commands import, with unit tests beside it; (b) the Hub derives the state and returns it with `GET /mailboxes`, and the page only draws it; (c) leave it in the page, and a test pins a second copy against the same cases.
- (a) and (b) touch "the UI is a single framework-less HTML file" (CLAUDE.md "Technology stack"; design.md §3.2, §5): the reason goes into design.md first. (b) also needs a look at what the page uses that the Hub does not have (the browser's clock for elapsed times, the filters in `localStorage`).
- Before C79 or C139 is built, or together with the first of them.
- Decided 2026-11-10 in the planning session (the user left the choice to it): (a). One copy serves the page and the commands, with no framework added. Not (b): the state depends on the browser's clock and filters, which the Hub does not have. Not (c): two copies kept equal by a test are still two copies. The module takes the current time as an argument, so the page passes the browser's clock and the commands their own.

#### Done when
- [ ] design.md §5 records the reason for serving a shared module to the page before the change, and CLAUDE.md's "Technology stack" line on the UI says what the page loads besides the HTML file.
- [ ] The card state derivation (`stateOf` and what it needs) is a module under `src/shared/` without Node APIs; the Hub serves it to the page, started directly and in Docker, and `public/index.html` uses it instead of its own copy.
- [ ] Unit tests beside the module cover Needs you, Working, Waiting on others, Stopped and Paused, with cases taken from the `ui:check` scenes.
- [ ] `npm test`, `npm run ui:check` and `npm run docs:check` pass.

### C151. `ui:check` has no guard on Chrome's debugging port

Raised 2026-11-10 in the planning session. C142 made `ui:check` stop when its Hub port (7793, `UI_CHECK_PORT`) is already answered by another Hub. The Chrome it starts still uses a fixed debugging port (9333, `UI_CHECK_CDP_PORT`) with no such check, and the page is found by asking that port for its list of targets. A second run on the same machine (a team's deployer and the planning session, or a leftover Chrome) could read the other run's page. Not reproduced; the failures during C142 were put down to the Hub port (C145's body).
- The Hub-port check also has a gap when two runs start at the same moment: both see the port free.
- Ideas, not decided: (a) check the debugging port the same way before starting Chrome; (b) pick free ports for both when the environment variables are not set, so two runs do not meet; (c) a lock file in the temporary folder that names the run holding the ports.
- Decided 2026-11-10 in the planning session (the user left the choice to it): (b) by default and (a) when a port is set by hand. Free ports from the system also close the gap of two runs starting at once. Not (c): a run that crashes leaves its lock behind.

#### Done when
- [ ] With `UI_CHECK_PORT` and `UI_CHECK_CDP_PORT` unset, `ui:check` takes free ports from the system for its Hub and for Chrome's debugging port, and prints them.
- [ ] With either set, `ui:check` stops before starting Chrome when that port already answers, and names the port, as it does today for the Hub port.
- [ ] Two `ui:check` runs started at the same time on one machine both pass; the body records the run.
- [ ] The docs that name the fixed ports (7793, 9333) say what happens now.
- [ ] `npm test`, `npm run ui:check` and `npm run docs:check` pass.

### C154. Draft a run from the plan in the UI
Status: held(after C153; decide once runs written by hand show what the draft needs)

Raised 2026-11-10 with C153. Today an item card drafts a request for one item (**Draft request**, design.md §3.15). For a run, the human would pick several items in the Plan tier and get a draft `RUN:` request in the plan's order, addressed to the leader.
- To decide: how the request carries its items (`meta.item` holds one item; a list, or a `meta.run`), so the cards can show `requested` / `reported` for each item of a run; whether items outside the Plan tier can be picked (C153 does not start items with a status line); whether the draft warns above five items.

### C155. Show what a run left for the human: worked items that are still open, and decisions taken by default
Status: held(after C153; decide once a real run shows what is hard to find)

Raised 2026-11-10 with C153. After a run, what waits for the human is spread over the last report (a Message, deleted after the retention period), the items' sections (the defaults taken, the items left open) and `git log` (unpushed commits). The ledger is the place that lasts (design.md §3.16).
- Idea: the Items list gets a tier, or a mark, for items whose done-when lines are all checked while the section is still there ("worked, waiting for the close"); the index already has the counts (`conditions.done` / `total`). `team status` (C139) could list the same.
- To decide: whether a default taken without an answer needs a form the index can read (today it is a sentence in the item's body), which would change the ledger's format (conventions-log.md); whether unpushed commits are shown, and by whom (the Hub does not read the working tree; design.md §3.8).

### C156. Messages from the user during a run: stop, correct, ask

Decided 2026-11-10 by the user in the planning session, from the reviewer's notes on C153 ("stopping the leader was not thought through; handle it").
C153 says that while a run goes on the leader sends the user no `request` or `reply`, so that the `RUN:` request stays awaiting a reply. Nothing says what the leader does when the user writes to it during the run: a stop, a correction, or a question. Two readings both fail today: a reply to the `RUN:` request closes it after the first answer (protocol.md §2), and no answer leaves the user with none. There is also no way to call a run off.
- **Answer the message itself.** A `reply` whose `reply_to` is the user's mid-run message should close only that message, not the `RUN:` request. Correction (2026-11-10, planning session): this was filed as if the Hub already worked that way; it does not (the review fix below), and the user chose to change the Hub, which is C157. That is the one exception to "no other `reply`" in a run. Rejected: answering by `notice` (the user's message would stay awaiting a reply until the retention period); answering in the next item's notice (late, and mixes two things).
- **Stop.** A message that asks to stop the run (one starting `STOP`, or one that says so in words) makes the leader start no further item. The item in progress ends as items end: the deployer's report already asked for is awaited (no new request to the deployer), the leader does its check, and the item is committed if the tests pass, or left uncommitted and named. Then the last report goes as the reply to the `RUN:` request, naming the later items as not started (stopped by the user). The stop takes effect when the leader next reads its messages; stopping at once is Esc in the leader's terminal, outside the Hub (C14). Rejected: a cancel state or a `kind` in the Hub. The Hub holds addresses and delivery, not the state of work (design.md §3.14), and the run's state is in the ledger and `git log` (C153).
- **Correct.** A correction about the item in progress applies from the leader's next request to the deployer. One about a later item applies when that item starts. Either way it is recorded in that item's section body as `changed by the user during the run: …`. A correction that would change a done-when line's meaning leaves that item open, as C153's rule does, because the wording is the planning session's. A request to add an item to the run is not followed (C153, membership); the reply says so.
- **Unclear.** The run goes on, and the leader asks in a reply to that message.
- **Before sending.** The leader stops a run when the working tree is not clean before the first item (C153). So an item filed in the planning session and left uncommitted stops the run before anything starts (the reviewer's note on C153). usage.md asks the human to commit before sending `RUN:`.
- Checked (2026-11-10, deployer): `npm test` 584 pass, 0 fail; `npm run docs:check` 46 items, 0 errors, 0 warnings before the boxes were ticked; after they were ticked, 1 warning, the close reminder for C156 (gone once the usage box was un-checked, see the fix record below). Written: `tools/dev/roles/leader.md` "Runs": the exception to "no other request or reply" in the reports bullet, and a "Messages during a run" paragraph (answer with a `reply` to the message, `STOP`, corrections, unclear messages); `docs/usage.md` "Several items in one request (a run)": commit before `RUN:`, `STOP` and Esc, the reply to each message; `docs/design.md` §3.15 run paragraph (answered on their own; a stop is a message, not a Hub state); `docs/conventions-log.md` one `practice` line dated 2026-11-10. Not checked: a live message from the user during a run (the rules are written, not run).
- Review fix (2026-11-10, deployer): the review found the premise of "Answer the message itself" above false under the current Hub. A request or reply from the leader to the user closes every open request the user sent, whatever its `replyTo` (checked in `src/hub/store.ts` `answeredBy()` and `docs/protocol.md` §2), so a reply to a mid-run message also marks the `RUN:` request answered; only a `notice` does not. The usage box of the done-when list is un-checked, its wording unchanged, because its clause "the `RUN:` request stays awaiting one" does not hold. Not decided here: a Hub change to protocol.md §2, answering by notice, or answering in the last report (the planning session). The known-gap sentence is in leader.md "Runs", usage.md and design.md §3.15.
- Docs done (2026-11-10, deployer, after C157 closed): the known-gap sentences are removed from `tools/dev/roles/leader.md` ("Runs": the reports bullet and "Messages during a run"), `docs/usage.md` (the run subsection, and the two awaiting-reply sentences near the top and in retention) and `docs/design.md` §3.15. They now say that a reply whose `reply_to` names the user's message closes only that message (C157), that a mid-run message is replied to once, that a second reply falls back to the sweep, and where follow-ups go (the item's notice or the last report).
- Checked (2026-11-10): `npm test` 597 pass, 0 fail; `npm run docs:check` 44 items, 0 errors, 0 warnings. The docs were read against protocol.md §2 ("Awaiting reply"), where C157's rule is written. The Hub on 7777 was not restarted, so C157 was not checked live.
- Fix (2026-11-10, deployer, review of the docs fix): a user message of kind `reply` or `notice` awaits no reply (the UI's Reply button sends `reply`), so "answer with a reply naming it" applies only to a `request`; a reply naming a `reply` or `notice` falls to C157's sweep and closes the `RUN:` request. leader.md and usage.md now say so.
- Done (2026-11-10, deployer): `leader.md` "Runs" says the `STOP` message gets one `reply` naming it, and that before the last report each user request still awaiting a reply is answered with a `reply` naming it (found in `GET /mailboxes` `awaitingReply` or the leader's own record), so the last report, which closes only the `RUN:` request (C157), leaves nothing open. `docs/usage.md` (the STOP bullet) says the same. Checked: `npm test` and `npm run docs:check` (see the report).
- Fix (2026-11-10, deployer, review of the STOP reply): the Stop bullet said the `STOP` gets a reply, but a user `reply` or `notice` awaits none (a reply naming it would sweep the `RUN:` request), so the reply is for a `STOP` sent as a `request`; a `STOP` sent as a `reply` or `notice` is applied and reported in the notice or the last report.
- Not done: the real-run box stays `[ ]`. No message from the user during a real run has been sent since C157, so no seqs are recorded in design.md §6.

#### Done when
- [x] `tools/dev/roles/leader.md` "Runs" says that a message from the user during a run is answered with a `reply` whose `reply_to` is that message, never the `RUN:` request; the line "no other `request` or `reply`" names this exception.
- [x] `leader.md` says what a stop does: a message that asks to stop the run (starting `STOP`, or saying so in words) starts no further item; the item in progress ends with the awaited deployer report, the leader's check, and a commit if the tests pass (otherwise uncommitted and named); the last report is the reply to the `RUN:` request and names the later items as not started (stopped by the user).
- [x] `leader.md` says how a correction is applied: from the next request to the deployer for the item in progress, or when a later item starts; recorded in that item's section body as `changed by the user during the run: …`; one that would change a done-when line's meaning leaves the item open; a request to add an item to the run is not followed and the reply says so; an unclear message is asked about in a reply to it while the run goes on.
- [x] docs/usage.md "Several items in one request (a run)" says to commit the project's changes, the ledger included, before sending `RUN:`; how to stop a run (`STOP`), and that it takes effect when the leader next reads its messages, while Esc in the leader's terminal stops at once; and that a mid-run message gets its own reply while the `RUN:` request stays awaiting one.
- [x] design.md §3.15's paragraph on runs says that mid-run messages are answered on their own and that a stop is a message to the leader, not a state in the Hub, with the reason.
- [x] docs/conventions-log.md has a `practice` line for messages during a run.
- [x] `npm test` and `npm run docs:check` pass.
- [ ] After C157, the known-gap sentences in `leader.md` "Runs", usage.md and design.md §3.15 are removed or replaced by a pointer to C157, and a message sent to the leader during a real run is answered with a reply to it while `GET /mailboxes` still shows the `RUN:` request awaiting a reply; design.md §6 records the seqs seen.
- [x] `leader.md` "Runs" says a mid-run message is replied to once: a second reply to it, once it is closed, closes every open request from the user, the `RUN:` request included (C157's fallback). docs/usage.md's two sentences on what closes awaiting reply (the Mailbox list near the top, and retention) state C157's rule.
- [x] `leader.md` "Runs" says the `STOP` message gets its own reply, and that a request the user sent during the run and not yet answered is answered before the last report, so that no mid-run message stays awaiting a reply after the run (C157 no longer closes them with the last report).
