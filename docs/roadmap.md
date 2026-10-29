# Roadmap

Each phase puts weight on "ending in a working state". Move on after the acceptance criteria are met.

Open items are written as `### C<n>. Title` sections under "Items" at the end (design.md §3.15).
- Right after the heading, write only an exceptional status, on one unindented line: `Status: proposed | held(<condition to resume>) | blocked(after C<n>)`. Without the line, the item is decided (may be started).
- A decided item has `#### Done when` (a list of checkboxes). A request's `DONE WHEN` is copied from it.
- Numbers are not reused. When done, delete the section, mark the phase line `[x] C<n> …`, and write the record of what was checked below it. In the same cleanup, remove `blocked(after C<n>)` lines that waited for that item (status is progress, not a promise).
- When rejected, delete the section and leave `[-] C<n> Title (rejected YYYY-MM-DD, one-line reason)` under a phase or "Known issues". If the reason is long, write it in design.md §9 and point to it (design.md §3.16).
- The plan list: the ledger has one `## Plan`, listing the items without a status line and the `blocked(after C<n>)` items in the order they will be taken up, as `- [ ] C<n>`. No titles. These two kinds are always listed, and nothing else. Blocked items go after the item they wait for. Reordering is a human's decision (design.md §3.15).
- How states are split: each of the four tiers corresponds to one state. `proposed` is only "awaiting a human's decision". `blocked(after C<n>)` is only for decided items (with done-when conditions) waiting on another item, with `C<n>` in the reason. An undecided item waiting on another is `held(after C<n>)`. Something waiting on an outside event (an update to the official docs, the next time a usage limit is hit and so on) is `held(<condition to resume>)` even if decided, and the reason is not omitted. Something accepted but not to be worked on is not held but rejected, `[-]`.
- A closed line (`[x] C<n>` / `[-] C<n>`) has the date it was closed (`YYYY-MM-DD`) at the head of the parentheses at the end of the line (e.g. `(2026-10-27, requested by the user)`; for a rejection `(rejected 2026-10-27, reason)`). A date inside the title does not count.
- When asked about the plan, first check for breakage with `npm run -s docs:check`, then answer from the JSON of `npm run -s docs:check -- docs/roadmap.md --index` and the dates on closed lines. Do not read the whole ledger and reclassify it (the four-tier answer is in the skill `roadmap-items`).
- The Japanese vocabulary (`状態: 提案 | 保留(…) | ブロック(C<n> の後)`, `#### 完了条件`, `## 予定`, `(却下 YYYY-MM-DD、…)`) is read the same way by the checker and the index (the mapping table is in design.md §3.15). The closed records below, from before 2026-10-29, are in Japanese.
- Breakage of the rules is checked with `npm run docs:check` (`src/shared/roadmap.ts`).
- An explanation for writing the same rules in other projects is in the global skill `roadmap-items` (`~/.claude/skills/roadmap-items/`). The source of truth is this header and `src/shared/roadmap.ts`.

## Plan

In the order they will be taken up. Only items without a status line and blocked items are listed (titles come from the index). Reordering is a human's decision.

- [ ] C71
- [ ] C70
- [ ] C72
- [ ] C74

(Items with a status line are listed under "Items".)

## P0: One round trip in one session (done 2026-10-16)

**Goal**: a message written in the browser reaches a Claude session, Claude replies with `post_message`, and the reply shows in the browser.

- [x] Channels の仕様を公式資料で確認し、結果を design.md §6.1 に追記
- [x] hook・MCP の仕様を公式資料で確認し、design.md §6.1b に追記
- [x] design.md §6.2 の Channels・hook 関連をプローブ (`tools/probe/`) で実機確認し、結果を §6.1c に記録
- [x] プロジェクト雛形 (package.json, tsconfig。作業順は [plan-p0.md](plan-p0.md))
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

### C9. Checking the document conventions
Status: proposed

design.md §3.12. Layer 1 is a script of deterministic checks (`npm run docs:check`: map drift, drift between the API and enumeration tables, `CHANGED` missing docs, dates on §9's decisions). Results are shown in the UI as a notice or Event.
The table of conventions becomes the source of truth, and CLAUDE.md, leader.md and deployer.md just point to it. For layer 2 (a lightweight judge), measure whether it is worth building once drift missed by layer 1 has accumulated as material.

### C10. Making the leader disposable
Status: proposed

The minimum version of the ledger (a list of unanswered requests), and who holds the trigger to discard it (the open questions of design.md §3.13).

### C11. The request ledger and checkpoints
Status: proposed

Declaring message shapes and checking them on the Hub, matching each request's SCOPE against `git diff`, fingerprints of acceptance and needs-re-confirming (design.md §3.11, §9-6).
The vocabulary is taken from the headings used every time in leader / deployer operation, not designed up front. New checks start as warnings only, and are raised to 400 after seeing that they agree with human judgment.

### C12. Opt-in delivery rules (automatic forwarding without human confirmation)
Status: proposed

The default is that a human presses Send (design.md §2). If added, it is opt-in, and the boundary with autonomous orchestration is in design.md §3.13.

### C13. A warning when the body starts with a built-in command
Status: proposed

When the body starts with `/clear` and the like, the UI warns that "it arrives as a string and is not run" (design.md §6.1h). Optional.

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

### C24. Checking rejected lines `[-] C<n>` with docs:check
Status: proposed

Following the rejection rule at the top of the roadmap (design.md §3.16), check with `checkRoadmap` the form of `[-] C<n>` lines (the date and reason of the rejection), a `[-] C<n>` whose section remains, and reuse of closed numbers, and show them in the index too.

### C27. Preparing new projects
Status: proposed

What remained from C26's run. Hook settings are copied by hand (`start-agent.ps1` only warns). Agents in a new project have no way to learn the rules for writing roadmap items (the rules are at the top of agent-hub's roadmap). Place a template, or have the startup script prepare one.

In projects that already have a ledger, differences in format become a problem before any template does. Running `docs:check` on vcp's `docs/TODO.md` (31 `### C<n>.` items as of 2026-10-20) gives 31 errors: 30 "decided but no done-when heading", and 1 heading form (`### C104 の残り.`, "the rest of C104"). vcp writes state in the heading's parentheses ("held", "record only", "blocked waiting for data"), mixes what to do into the body's `- [ ]`, and moves finished items to DESIGN_LOG.md leaving one line in the "C-done" index. `docs:index` turns errors into warnings and sends, so sending it as is shows all 30 as "decided" in the UI.

- Having the other side rewrite its ledger into agent-hub's format is the wrong way round (the delivery layer would be imposing document conventions)
- Candidates: treat items with neither a status line nor done-when conditions as "unclassified" rather than "decided" / make the done-when heading name and how states are written configurable per project / without done-when conditions, copy the body's `- [ ]` as the promise
- Until then, do not index it and send a plain request (with the item number in the body)

On 2026-10-20 the first half of vcp's C145 was run that way (`start-team.ps1 -Roles leader,deployer -Project <vcp>`, the compose Hub). vcp's hooks had been copied into `.claude/settings.local.json`. user → leader → deployer → leader → user went around without a hand in between, and one round of correction went the same way (the leader found a discrepancy in the report itself and had the deployer fix it). No agent-hub bug appeared. No question or permission Events came up in this run (the deployer was in `auto` mode).

The same day, vcp's C147 was also run as a request without the index (the team was still C145's). From request to final report took about 26 minutes, with one correction from the human. After the deployer reported and while the leader was still checking, the human sent a correction (choose months by label rather than month name); the leader had the deployer fix it as is, and returned the results of both requests together in one reply to the first request. The correction request stayed awaiting reply, and the deployer's two reports stayed without confirmed receipt (design.md §6.1n, C28). The cause of the correction was the request's wording (it copied "run month names through C53's check" from an old discussion in the TODO), not an agent-hub bug.

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

### C70. Give the browser tab a hub icon that shows the same two signals as the cards

Raised 2026-10-30 while using the Hub from another project. The tab has no static icon (`public/index.html` has no `<link rel="icon">`); only a number badge for unread messages / Needs you (`badgeIcon`, red for unread, amber for waiting) replaces it, and it goes back to the browser default when nothing is pending. Decided 2026-10-30: what matters is two signals, "someone is working" and "waiting on the human", and the tab and the cards express them the same way (C71 defines the two signals and their colors). No blinking in the favicon. The idle icon is a hub (a central node with spokes), drawn as an inline SVG.

- Waiting on the human (Needs you, unread, Stopped): the amber count badge replaces the icon, as now (unread no longer has its own red; it counts as waiting on the human).
- Working only (someone is working, nobody waits on the human): the hub icon drawn in the working color.
- Nothing: the plain hub icon.
- One block near the top of the script holds what a person would edit: the idle icon (an SVG data URI or a path; empty for the browser default). Colors come from the same CSS variables the cards use (`--st-you`, `--st-working` from C71), read at draw time, so recoloring is one place.
- A white outline around the badge so it reads on light and dark tab strips.

#### Done when
- [ ] `public/index.html` has a hub-like SVG idle icon that shows when nothing is pending.
- [ ] While someone is working and nobody waits on the human, the icon is drawn in the working color; while the human is awaited, the amber count badge shows (it takes priority over working). Neither blinks.
- [ ] The tab colors are read from the same variables as the cards (`--st-you`, `--st-working`); the idle icon is changed in one block without touching the drawing code.
- [ ] The badge has a white outline.
- [ ] `npm test` and `npm run ui:check` pass.

### C71. Express "working" and "waiting on the human" on cards, with colors that are easy to change

Raised 2026-10-30. Decided 2026-10-30: only two signals matter, whether someone is working and whether the human is awaited, and the tab (C70) and the cards express them the same way. Cards already show state by a frame color plus a text line (`.mb.st-*`, `.state.st-*`), so color is never the only cue. Gaps: the frame colors are borrowed from general variables (`--accent`, `--amber`, `--warn`, `--wait`, `--pause`), so recoloring a state also recolors every other use of that variable, and nothing marks the moment a state changes.

Fold the states into the two signals:
- Waiting on the human: Needs you, unread, Stopped. Amber, a thick steady frame (no blinking).
- Working: Working, Waiting on others (another agent is working). The working color, and the frame pulses.
- Quiet (no emphasis): Idle, Paused, Offline.

The card's text line keeps naming the exact state (Needs you / Working / Waiting on others / Stopped / Paused / Offline); only the frame and the tab fold them.

Idea:
- Give the two signals their own variables in one block (`--st-you`, `--st-working`, plus `--st-ring` for the width), defaulting to today's amber and accent colors. Frames, state lines and the tab (C70) read only these, so one block is the whole recoloring surface. Dark mode redefines them in its existing block.
- Working cards pulse: the frame's intensity changes slowly over about 2 seconds, for as long as the card is working. `prefers-reduced-motion` shows a steady ring instead. Several working cards at once must not be loud.
- When a card changes between the signals (including Working to Idle, "finished"), it flashes for about 1.5 seconds in the new signal's color (Idle: a brief neutral-green flash, no persistent frame). The first render and re-renders without a change do not flash. The previous state is kept per Mailbox name outside the re-render.
- Cover it in `npm run ui:check`: a state change flashes, an unchanged re-render does not, a working card pulses, a Needs you card does not.

#### Done when
- [ ] Frames and state lines read only `--st-you`, `--st-working` and `--st-ring`, defaulting to today's colors, with dark mode redefined; Needs you / unread / Stopped share the steady amber frame.
- [ ] Working and Waiting on others cards pulse slowly while in that state; `prefers-reduced-motion` shows a steady ring.
- [ ] A card flashes about 1.5 seconds on a change of state between the signals (Working to Idle included); the first render and unchanged re-renders do not flash. Idle keeps no persistent frame.
- [ ] `npm run ui:check` covers flash on change, no flash when unchanged, pulse while working, and no pulse for Needs you.
- [ ] `docs/usage.md` states what the tab and the cards show for the two signals and where to recolor them; `npm test` passes.

### C72. Start the page on the project the team was started for

Raised 2026-10-30. The page restores the last selected project from `localStorage` (`agent-hub.project`, `readProject` / `saveProject`), and the URL that `npm run team` prints (`UI: <hub>/?token=...`, `src/team/team.ts`) carries no project. So starting a team for one repository opens the page on whichever project was selected last (seen: a team for agent-hub opened on vcp).

Idea:
- The printed URL gets `&project=<the project value the page uses for the team's folder>`.
- On load, a valid `project` parameter wins over the saved value and is then saved as the new last selection. Without it, restoring the last selection is unchanged.
- Treat both the parameter and the stored value as untrusted input. Use one as a selection only when it exactly matches a project the Hub's list returned; otherwise ignore it and fall back (parameter, then stored value, then the default). Never put either into `innerHTML`, a selector string or an API path unvalidated; never store a value that did not match the list. After use, remove `project` from the address bar (`history.replaceState`) so a reload or a shared screenshot does not carry it. The token is not touched by this item.

#### Done when
- [ ] The URL printed by `npm run team` / `hub-team` includes the team's project, URL-encoded.
- [ ] Opening it selects that project regardless of the last saved selection, and saves it as the last selection.
- [ ] A `project` parameter or stored value that is not in the Hub's project list is ignored (no error, no stored value, falls back as above); a value containing markup or quotes is never rendered as HTML.
- [ ] A URL without `project` restores the last selection as before; `project` is removed from the address bar after use.
- [ ] `npm run ui:check` covers: parameter wins over stored, unknown parameter ignored, no parameter restores stored. `npm test` passes.

### C73. Keep the project dropdown manageable when projects pile up
Status: held(after C74)

Raised 2026-10-30. The project list is the union of the `project` values of Mailboxes and roadmap indexes (design.md §3.15, "A project is a value"), so it has no order and a project disappears only when its last Mailbox and index are deleted by hand. With many projects the dropdown gets hard to use.

Idea:
- Order by recent activity (the latest attach or message of that project), most recent first. Computed from existing times; no new state.
- Projects with no activity for N days (default 30) go under a collapsed "Older" group. They are only hidden from the top, not deleted. N is `projects.olderDays` in the Hub's configuration file (C74), not a constant in the page.
- Each entry shows how many things wait on the human and how many Mailboxes are connected.
- A "remove this project" action that deletes its Mailboxes and indexes through the existing deletions, after a confirmation saying how many of each go. The project stays a value (no entity).

Waits for C74, which builds the configuration file with this value as its first user. Not decided: whether the remove action is wanted at all.

### C74. A read-only configuration file for the Hub and the page

Raised 2026-10-30 (survey while filing C73; reviewed the same day). The human prefers a configuration file to constants in code. Settings today are in four places: environment variables (`.env`; the Hub reads 11 `HUB_*`, while `HUB_MAILBOX`, `HUB_ROLE` and `HUB_FILES_DIR` are read by the shim, `npm run team` and hooks), `roles.json`, `HUB_DATA_DIR/settings.json` (custom commands written by the UI through `PUT /settings`, plus a hand-edited `defaultTo`), and the browser's `localStorage` (per-browser preferences).

Why not extend `data/settings.json`: in Docker it sits in the named volume `hub-data`, out of reach for hand editing; it is state the UI rewrites (the whole file is re-serialized on save, and one broken command makes the whole file 500 `settings_invalid`); and configuration already has a precedent in the repository root (`roles.json`, and the consult item's fixed texts "in the repository's configuration").

Shape:
- `hub.config.json` at the repository root, ignored by git like `/roles.json`, with a committed `hub.config.example.json`. The path can be overridden with `HUB_CONFIG_FILE`. In Docker it is read through the existing `./:/host:ro` mount.
- The Hub reads it once at startup (like `roles.json`; a change needs a restart) and never writes it. No write API, so holding the browser token does not let anyone change thresholds.
- Validation is per value: a value of the wrong type, out of range, or an unknown key falls back to the default (or is ignored) and is reported in the Hub's startup log and as a warning in the UI. A broken or missing file means all defaults; the Hub still starts.
- The Hub serves the validated values to the page (for example `GET /config`, behind the same token). The page uses them as data only (never `innerHTML`, never a selector, path or stylesheet text).
- Scope: the Hub and the page. The shim, `npm run team` and hooks keep their environment variables. `HUB_TOKEN` and other deployment values (host, port, directories) stay in `.env`; retention and unread limits stay in `.env` too, so no value has two sources.
- Not moved: protocol constants (`MESSAGE_KINDS`, `EVENT_KINDS`, `META_MAX_BYTES`), security limits (`MAX_INDEX_BYTES`, `MAX_COMMANDS`, the image size and count), and low-value UI constants (`FLASH_MS`, `SIDE_*`, `KEEP_DEFAULT`, which `localStorage` already overrides after the first use). Colors stay in the CSS block of C71 for now; if they move later, only `#rrggbb` values, light and dark pairs, applied with `style.setProperty`.
- First user: `projects.olderDays` for C73. Other values move when their own items need them (C60 decides Noise's place itself; C75 reads the Hub's limits).

#### Done when
- [ ] The Hub reads `hub.config.json` (or `HUB_CONFIG_FILE`) once at startup; a missing or non-JSON file gives all defaults and a log line, and the Hub starts.
- [ ] Each value is validated by type and range; a bad value or unknown key falls back to the default or is ignored, and is named in the startup log and in a UI warning. Covered by `npm test`.
- [ ] The page gets the validated values from the Hub behind the token and uses them only as data; the Hub has no write API for them.
- [ ] `hub.config.example.json` is committed with `projects.olderDays` (default 30) and comments in `docs/usage.md`; `/hub.config.json` is in `.gitignore`; the Docker setup reads it through the existing mount (checked with `docker compose up`).
- [ ] design.md (where configuration lives, §3.8 / §3.14) and protocol.md (the new endpoint) are updated in the same change.

### C75. The page reads the Hub's limits and retention instead of its own copies
Status: held(after C74)

Raised 2026-10-30 in the C74 review. Two places in `public/index.html` copy values the Hub owns:
- Image limits: the page's `MAX_IMAGE_BYTES` / `MAX_IMAGES` (20 MB, 4) repeat the Hub's `MAX_UPLOAD_BYTES` / `MAX_FILES_PER_MESSAGE` (`src/hub/files.ts`, whose error text also says "20 MB"), and the shim's `MAX_FETCH_BYTES` (25 MB, `src/shim/files.ts`) must stay at least the Hub's limit. These are security limits and stay constants; only the copies go.
- `STALE_HANDED_HOURS` (12) exists because hook Events disappear with retention, so it assumes `HUB_READ_RETENTION_HOURS` (default 24) is longer. With retention set below 12 hours, a hand-over whose turn-end Event was already deleted could still show as Working until 12 hours pass (inferred from the code, not observed).

Idea: the Hub serves its upload limits and retention through C74's endpoint (read-only, not settings); the page's pre-check uses them, and the stale threshold is capped at the retention period. A check that the shim's fetch limit is not below the Hub's upload limit is added to `npm test`.

Once C74's endpoint exists, write the done-when conditions and change the status.
