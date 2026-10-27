# ロードマップ

各フェーズは「動く状態で終わる」ことを重視する。受け入れ条件を満たしてから次へ進む。

開いている項目は末尾の「項目」に `### C<n>. 題` の節で書く (design.md §3.15)。
- 見出しの直後に、例外の状態だけ `状態: 提案 | 保留(理由) | ブロック(理由)` を字下げせずに 1 行書く (保留の理由は省ける)。行がなければ決定 (着手してよい)。
- 決定の項目は `#### 完了条件` (チェックボックスの並び) を持つ。依頼の `DONE WHEN` はここから写す。
- 番号は使い回さない。終わったら節を消し、フェーズの行を `[x] C<n> …` にして、確かめた記録をその下に書く。その項目を待つ `ブロック(C<n> の後)` の行も同じ片付けで外す (状態は進捗で、約束ではない)。
- 却下したら節を消し、フェーズか「既知の問題」に `[-] C<n> 題 (却下 YYYY-MM-DD、理由 1 行)` を残す。理由が長ければ design.md §9 に書いて指す (design.md §3.16)。
- 規則の崩れは `npm run docs:check` で検査する (`src/shared/roadmap.ts`)。
- 他のプロジェクトで同じ規則を書くための説明は、グローバルの skill `roadmap-items` (`~/.claude/skills/roadmap-items/`) に置いた。正本はこの冒頭と `src/shared/roadmap.ts`。

## P0: 1 セッションで往復する (完了 2026-10-16)

**ゴール**: ブラウザで書いたメッセージが Claude セッションに届き、Claude が `post_message` で返信し、ブラウザに表示される。

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

**受け入れ条件**
1. Hub を起動し、Claude Code を channel 有効 (`--dangerously-load-development-channels`) で起動できる。
2. shim が `HUB_MAILBOX` (未指定ならフォルダ名) の Mailbox に attach する。
3. エージェントが `subscribe("user.message")` を呼ぶ。
4. ブラウザから `user.message` に送ると、Claude の会話に `<channel source="agent-hub">` として入る。
5. Claude が `post_message` (`kind: reply`) で返信すると、ブラウザに `kind` 付きで表示される。
6. トークンなしの API 呼び出しは 401。127.0.0.1 以外からは到達しない。
7. ブラウザは起動時に表示された `?token=` 付き URL で開くと cookie で認証され、以後 URL にトークンが残らない。

**確認結果** (2026-10-16、Claude Code 2.1.301 / Haiku 5.5 / Windows 11)
- 1〜5, 7: 実セッションとブラウザで確認。`mailbox:agent-hub` 宛て (直接) と、`subscribe("user.message")` 後の `topic:user.message` 宛て (購読) の両方が届き、
  Claude が `post_message` (`to` 省略) で返した reply が `user:browser` 宛てとして UI に出た。
  購読していない `topic:agent-hub` 宛てと `user:agent-hub` 宛ては届かなかった (仕様どおり)。
- 6: 実起動した Hub に curl でトークンなしの 401 を確認。netstat で `127.0.0.1:<port>` のみで待ち受けていることを確認。

**調整予定** (P0 の実使用で見つかった点。P1 と並行して行う)
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

## P1: 区切り・質問の検知 (完了 2026-10-17)

**ゴール**: エージェントが止まった/質問した時点がブラウザに出る。

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

**受け入れ条件**
1. Claude が `AskUserQuestion` を呼ぶと、UI に質問内容が該当 Mailbox の下に出る。
2. ターン終了と許可待ちが区別して表示される。
3. UI の返信が該当セッションに届く。質問への回答はターミナルで行い、UI の返信はその後に届く (channel の通知は回答にならない。design.md §6.1c)。

## P2: 複数セッション・交代・メッセージパッシング

**ゴール**: 複数エージェントが購読ベースで互いにやり取りでき、交代や再起動をまたいで取りこぼさない。

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
- [ ] C3 Claude Code 以外の実クライアントと、受け手の読み方を確かめる
- [ ] C4 engram への区切り知見の保存連携 (任意)
- [x] C7 項目の索引と規則の検査 (design.md §3.15。2026-10-19)
  - `src/shared/roadmap.ts` の `parseRoadmap` が項目 (ID・題・状態・完了条件の進み具合・行) と、節の外の `[ ] C<n>` / `[x] C<n>` を取り出す。Node の API に依存しないので、ブラウザでも使える (C8)
  - `checkRoadmap` は、見出しの形、ID の重複、状態の語彙と位置、ブロックの理由、決定の項目の `#### 完了条件`、`[ ] C<n>` の指す節の有無、節が残っている `[x] C<n>` を error にし、完了条件が全部埋まった項目を warning にする
  - `npm run docs:check` で回し、error があれば exit 1。`-- --index` で索引を JSON で出す。テスト `src/shared/roadmap.test.ts` (このファイル自身が規則どおりであることも含む)。項目の ID・状態・見出しを崩したコピーで exit 1 と行番号つきの指摘を確かめた
- [x] C6 溜まりのバッジ (design.md §3.15 の「実装」。2026-10-19)
  - Hub は `GET /mailboxes` に `backlog` (未読・返信待ちの request・確認待ちを重ならない形で、件数と最も古い ts) を足した。テスト `src/hub/mailbox.test.ts` の「溜まりの材料 (backlog)」
  - UI はカードとサイドバーに `You` / `Agent` / `Stuck?` の件数と最も古いものの経過時間を出し、経過時間で色を変える (30 秒ごとに塗り直す)。タブのタイトルに `N waiting`、favicon に人が動く番の件数を出す
  - 別の Hub (ポート 7795) と headless Chrome で、2 つのプロジェクトの 4 つの Mailbox の層の振り分けとサイドバーの合計、プロジェクトを選ぶとサイドバーが絞られタイトルは全体のままなこと、返信で `Agent`・回答で `You` とタイトルの waiting が消えること、経過時間を 15 分前 / 3 時間前にしたときの色、`backlog` (と `unread` / `unconfirmed`) を外した古い Hub の応答で件数だけが出てページのエラーがないことを確かめた
- [x] C8 項目のカードと依頼の下書き (design.md §3.15 の未決 2・3 の決定。2026-10-19)
  - 索引: `npm run docs:index` が `parseRoadmap` の結果を `PUT /indexes` で送り、Hub は `indexes.json` に写しとして持つ。`parseRoadmap` に完了条件の文言 (`conditionTexts`) と約束の指紋 (`promise`) を足した。テスト `src/hub/indexes.test.ts`、`src/shared/roadmap.test.ts` の「完了条件の文言と約束の指紋」
  - UI: サイドバーの Items に 1 行のカード (ID・題・状態・進み具合・requested / reported)。押すと `GOAL` / `DONE WHEN` の下書きになり、送る request の `meta.item` に項目と送った時点の約束を付ける (Unlink で外せる)。完了条件の文言が変わると、カードに `-` / `+` の差分を出す
  - 別の Hub (ポート 7795) と headless Chrome で、一時フォルダのプロジェクトの roadmap を送ってカードが出ること、プロジェクトの絞り込み、下書きの本文と送った `meta.item`、`requested` → 返信で `reported`、チェックを付けて送り直しても差分が出ず文言を変えると出ること、Unlink で `meta.item` なしになること、`/indexes` が 404 の古い Hub で欄が出ずエラーもないことを確かめた
- [x] C26 登録した roadmap のプロジェクトを、エージェントがつながる前から使えるようにする (design.md §3.15 の「プロジェクトは値」。2026-10-20)
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
  - 未確認: 絞り込みで隠れた場合・畳んだ範囲の中・You バッジ (質問・許可待ちの Event、人宛ての request)・Stuck? バッジは ui:check で流していない (C48)
- [x] C45 reviewer の作法を決め、レビューを対象と問いで依頼できるようにする (2026-10-27、ユーザーの依頼)
  - `tools/dev/roles/reviewer.md` (依頼は対象と問い、何を読むかは reviewer が決める、返事は FINDINGS と PROPOSED CONDITIONS)、`leader.md` (reviewer への依頼、完了条件の提案は人が承認するまで変えない)、design.md §3.12 の表の reviewer 行
  - `start-agent.ps1 -Role reviewer` の dry run で、reviewer.md が system prompt に入ることを確かめた
  - 実チームで確かめた (design.md §6.1u): TARGET と QUESTION だけで依頼した reviewer が、依頼に書かれていない正本を自分で読んで照らした。起票したばかりの C48 の完了条件を、訂正案 → 人の承認 → 直す、の一周で通した

**受け入れ条件**
1. 2 つの Mailbox が別トピックを購読し、それぞれの購読分だけ受け取る。
2. セッションを閉じている間に届いたメッセージが、同じ Mailbox に attach した次のセッションに再送される (重複は id で除去できる)。
3. **交代**: Mailbox `reviewer` のセッション A を `/clear` または終了し、新しいセッション B が `reviewer` に attach すると、購読と未読を引き継ぐ。A がまだ接続中なら A は切り離され、UI に表示される。
4. `maxAgeMs` を超えた未読は渡されず、エージェントに省略件数が 1 件の通知で伝わる。
5. ブラウザから、ある Mailbox の出力を無編集で別の Mailbox へ転送できる。
6. **role**: `HUB_ROLE=reviewer` で起動したセッションは、`subscribe` を呼ばなくても role の既定購読分と `to: role:reviewer` 宛てを受け取る。`deployer` の Mailbox はそれを受け取らない。
7. Hub を compose で起動しても 1〜6 が成り立ち、ホスト以外から 7777 番に到達できない。

## 既知の問題・後回し

- [x] **shim の seq 巻き戻し**: Hub の `data/` を消して再起動すると seq が 1 から振り直され、shim が前の Hub で覚えた seq を stream の `after` に使うため、attach 時の未読を黙って捨てていた。attach のたびに `after` を Hub の `cursor` から数え直すようにした (ack 漏れの再送は id で除去)
- [x] **未読の算出が全件走査**: `unread()` と `listMessages()` が毎回ログ全体を見ていた。ログは seq の昇順なので、二分探索で `cursor` (または `after`) の位置から見るようにした。長く ack しない Mailbox はその未読分だけ走査する
- [x] **detached の旧 shim が後継から Mailbox を取り返しうる**: A の stream が切れて猶予 (15 秒) を過ぎ `disconnected` になった間に B が attach すると、戻ってきた A の shim は stream の 404 で attach し直し、「新しい方が勝つ」で B を切り離す。A は superseded ではないので attach し直しを止める仕組みがない。ループバックで 15 秒以上戻れないのは稀なので後回し。対策の候補は、後継のいる Mailbox への attach で、前の Attachment ID を示した attach し直しを拒む、など (design.md §3.3 の takeover。2026-10-17 のレビューで発見)。2026-10-18 にその案で対応した (attach の `previous` と 409 `successor_attached`。テスト `src/hub/mailbox.test.ts` の「切断中の後継 (previous)」、`src/shim/shim.test.ts` の「HubClient: 切断中に後継が attach したとき」)。Hub の再起動と重なった場合は見分けられない
- [ ] C5 **channel なしで起動した Claude Code の通知を ack してしまう**
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
- [x] C41 **C36〜C40 のレビュー (2026-10-23、`7bb1a8d..3aa8c83`) で見つけた弱いところを直す** (ユーザーの依頼)
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
- [ ] C49 **誰も接続していない宛先への依頼に、送ったエージェントも人も気づかない**

## 項目

開いている項目。書き方は冒頭の規則 (design.md §3.15)。デスクトップアプリ向けの画面操作ベースの連携は範囲外として項目にしない。

### C3. Claude Code 以外の実クライアントと、受け手の読み方を確かめる
状態: 保留(Claude Code 以外に MCP の実クライアントがないため。2026-10-19)

今はテストの MCP クライアントでのみ確かめている。

2026-10-19 の C2 で、leader (Claude Code) に「書き手 (forwarded_sender) と本文を列挙して」と添え書きして deployer の reply 2 件を転送すると、2 件とも書き手を deployer と答えた。添え書きが属性の名前を示しているので、指示なしに書き手として読むかはまだ分からない。

実クライアントを入れたら、`tools/probe/resources-probe.mjs` で `resources/updated` によってターンが始まるかも見る (C1 では Claude Code だけ確かめて閉じた。design.md §6.1m)。

#### 完了条件
- [ ] Codex など Claude Code 以外のクライアントが `inbox` を呼び、注意書きどおりに本文をデータとして扱うか
- [ ] 受け手のエージェントが `forwarded_sender` を本文の書き手として読むか (Channels 経路)
- [ ] 結果を design.md §6 に記録する

### C4. engram への区切り知見の保存連携
状態: 提案

区切り (commit・項目の完了) の知見を engram に残す流れと Hub をつなぐか。任意。

### C5. channel なしで起動した Claude Code の通知を ack してしまう
状態: 保留(起動手順で channel を付ける前提。取りこぼしは unconfirmed で見える)

`clientInfo.name` は `claude-code` のままなので Channels 経路になり、Claude Code が通知を捨てても shim は ack する (未読が既読になる)。2026-10-18 に、通知が黙って捨てられること、initialize・環境変数・要求の並びに channel の有無の違いがなく shim から見分けられないことを確かめた (design.md §6.1k)。配送の状態を分けた (2026-10-18) ので、捨てられた分は handed のまま UI に unconfirmed として出て、`inbox` の `unconfirmed: true` で取り直せる。自動では取り戻さない (design.md §3.7)。

### C9. ドキュメントの作法を照らす
状態: 提案

design.md §3.12。層 1 は決定的な検査のスクリプト (`npm run docs:check`。地図のずれ、API と列挙の表のずれ、`CHANGED` の docs 漏れ、§9 の決定の日付)。結果は notice か Event で UI に出す。
作法の表を正本にし、CLAUDE.md・leader.md・deployer.md はそこを指すだけにする。層 2 (軽量ジャッジ) は、層 1 が逃したずれが材料として貯まってから作る価値を測る。

### C10. leader を使い捨てにできるようにする
状態: 提案

台帳の最小版 (未返信の request の一覧) と、捨てるきっかけを誰が持つか (design.md §3.13 の未決)。

### C11. 依頼の台帳と整合点
状態: 提案

メッセージの形の宣言と Hub での検査、依頼ごとの SCOPE と `git diff` の突き合わせ、受け入れの指紋と要再確認 (design.md §3.11、§9-6)。
語彙は leader / deployer の運用で毎回使っている見出しから取り、先に設計しない。新しい検査は警告だけで始め、人の判断と一致するのを見てから 400 に上げる。

### C12. 配信ルール (人間確認なしの自動転送) の opt-in
状態: 提案

既定は人が Send を押す (design.md §2)。入れるなら opt-in で、自律オーケストレーションとの境目は design.md §3.13。

### C13. 本文が組み込みコマンドで始まるときの警告
状態: 提案

本文が `/clear` などで始まるとき、UI で「文字列として届き、実行されない」と警告する (design.md §6.1h)。任意。

### C14. permission relay で UI から許可を出す
状態: 提案

Channels の permission relay を使い、UI から tool 実行の許可を出す (design.md §6.1)。

### C15. plugin の monitor と Channels の比較
状態: 提案

配信経路として plugin の monitor を Channels と比べる (design.md §6.2-3)。

### C16. `kind` の追加
状態: 提案

交代時の引き継ぎ用 `handoff` など (design.md §3.6)。

### C17. `report_event` と `Stop` の重複除去
状態: 保留(P1 の `Stop` の表示で足りないと分かるまで)

skill から区切りを申告する `report_event` ツールと、`Stop` との重複除去 (design.md §3.4)。

### C18. 担当範囲と競合
状態: 保留(書き手の deployer が 2 人以上になるまで)

まず deployer ごとに git worktree を分け、足りなければ request の `SCOPE` を担当範囲として記録して衝突を UI に警告する。止めたい場合だけ hook で強制する (design.md §9-6)。

### C19. 配送を公式 cross-session messaging に移す
状態: ブロック(投函の形式が公式資料に載るまで)

design.md §9-5。移すときも Mailbox・role・未読の正本は Hub に置く。

### C20. MCP Events (`events/stream`) を shim に足す
状態: ブロック(Claude Code が MCP Events に対応するまで)

shim に `io.modelcontextprotocol/events` (`events/stream`) を追加する (design.md §7)。

### C22. 項目への依頼の反映済を、索引の変化から導く
状態: 提案

`meta.item: C<n>` の request を送った後、`docs:index` で届いた索引で、その項目の完了条件のチェックが増えた、または節が消えて `[x] C<n>` / `[-] C<n>` になったら、カードに反映済を出す (design.md §3.16)。返信 (自己申告) より先にリポジトリの事実を見せる。索引に閉じた項目の ID と閉じ方を足す必要がある (`parseRoadmap` の `refs` が材料)。

### C23. 項目のない依頼の選別を促す
状態: 提案

`meta.item` のない request に返信が来たら、人に「項目に回収する / 捨てる」を選ばせる (design.md §3.16)。どこに出すか、選んだことを Hub に知識として持たせずにどう残すかは §3.16 の未決 2。

### C24. 却下の行 `[-] C<n>` を docs:check で検査する
状態: 提案

roadmap 冒頭の却下の規則 (design.md §3.16) に合わせ、`[-] C<n>` の行の形 (却下の日付と理由)、節が残ったままの `[-] C<n>`、閉じた番号の使い回しを `checkRoadmap` で検査し、索引にも出す。

### C27. 新規プロジェクトの下ごしらえ
状態: 提案

C26 の通しで見つかった残り。hook の設定は手で写す (`start-agent.ps1` は警告するだけ)。新しいプロジェクトのエージェントは roadmap の項目の書き方の規則を知る手段がない (規則は agent-hub の roadmap 冒頭にある)。雛形を置くか、起動スクリプトが用意するか。

既に台帳を持つプロジェクトでは、雛形より書式の違いが先に問題になる。vcp の `docs/TODO.md` (2026-10-20 時点で `### C<n>.` の項目 31 件) に `docs:check` をかけると 31 errors: 30 件が「決定なのに `#### 完了条件` がない」、1 件が見出しの形 (`### C104 の残り.`)。vcp は状態を見出しの括弧に書き (「保留」「記録のみ」「データ待ちでブロック中」)、やることは本文の `- [ ]` に混ぜ、終わった項目は DESIGN_LOG.md へ移して「C-完了」の索引に 1 行残す。`docs:index` はエラーを警告にして送るので、そのまま送ると 30 件すべてが「決定」として UI に出る。

- 相手の台帳を agent-hub の書式に書き換えさせるのは筋が悪い (配送の層が文書の作法を押しつけることになる)
- 候補: 状態の行も完了条件もない項目を「決定」でなく「未分類」として扱う / 完了条件の見出し名や状態の書き方をプロジェクトごとに設定できるようにする / 完了条件がなければ本文の `- [ ]` を約束として写す
- それまでは、索引に載せず普通の依頼として送る (項目番号は本文に書く)

2026-10-20 にその形で vcp の C145 の前半を通した (`start-team.ps1 -Roles leader,deployer -Project <vcp>`、compose の Hub)。vcp の hook は `.claude/settings.local.json` に写してあった。user → leader → deployer → leader → user が手を挟まずに回り、手直しの 1 往復も同じ流れで済んだ (leader は報告の食い違いを自分で見つけて deployer に直させた)。agent-hub の不具合は出なかった。質問待ち・許可待ちの Event はこの通しでは出ていない (deployer は `auto` モード)。

同じ日に vcp の C147 も索引なしの依頼で通した (チームは C145 のまま)。依頼から最終報告まで約 26 分で、人の手直しが 1 回入った。deployer が報告した後、leader がまだ確かめている間に人の手直し (月を月名でなくラベルで選ばせる) を送ると、leader はそのまま deployer に直させ、2 つの依頼の結果を最初の依頼への返信 1 本にまとめて返した。手直しの依頼は返信待ちのまま残り、deployer の報告 2 本は受領の確認が付かないまま残った (design.md §6.1n、C28)。手直しの原因は依頼の文面 (TODO の古い検討にあった「月名を C53 の検査にかける」を写した) で、agent-hub の不具合ではない。

### C35. 独自の台帳を持つプロジェクトから依頼を中継する
状態: 提案

Hub で回すのは、作業を切り出したリポジトリ (台帳 `### C<n>.` を持つ) とし、依頼元が独自の台帳や番号の体系を持つプロジェクト (thesis の CLAUDE.md の「項目N」など) には `C<n>` を混ぜない (2026-10-22、ユーザー。グローバルの skill `roadmap-items` に書き方を置いた)。
例は thesis と cite-bridge: 設計書と取り込み (submodule の更新) は thesis、実装と台帳は cite-bridge。チームは thesis の中ではなく cite-bridge の単独の clone で起動する (親の CLAUDE.md を読ませないため)。
今は何も足さずに回せる (`project` は値。design.md §3.15)。足すとしたら、項目のカードに「持ち主」(依頼元のプロジェクト) を出す、終わった項目を持ち主の Mailbox へ notice で知らせる、など。重く考えず、実際に回して要るものが分かってから決める。

### C38. usage limit で止まったセッションを、Working と区別して出す

cite-bridge の deployer は usage limit で 2 時間 20 分止まったが、Hub には止まった瞬間の Event がなく、カードの状態 (C37) は `Working` と出ていたはず (design.md §6.1q)。公式の hook の `StopFailure` (API のエラーでターンが終わったとき) と、Notification の `quota_auto_resume_*` を使う。`StopFailure` が自動の再開を待つ場合にも発火するかは未検証 (§6.2-6) なので、登録して次の制限で確かめる。2026-10-23 にユーザーが決定。
2026-10-26 に実装した: `StopFailure` を `turn.failed` に変換 (`payload` は入力のまま)、`backlog.lastEvent.detail` に `error` / `notification_type` を載せ、UI に Paused と、`quota_auto_resume_stale` / `_disabled` の Needs you を足した。`ui:check` に場面を足して確かめた。`settings.command.json` は `Stop` だけを置き換える command hook の設定で、README の手順では HTTP の `Stop` と置き換えて使い、`StopFailure` は `settings.json` のものをそのまま残す。そこに `StopFailure` を足すと二重になるため足していない。完了条件から「と `settings.command.json`」を外すことを提案し、2026-10-26 にユーザーが承認した。同じ日に、Hub の `/events` を持つ hook の設定 (agent-hub と vcp の `.claude/settings.local.json`。`~/.claude/settings.json` には agent-hub の hook がない) に `StopFailure` を足した。

#### 完了条件
- [x] `tools/hooks/settings.json` に `StopFailure` を足し、Hub が Event に取り込む (例 `turn.failed`、`error` と `last_assistant_message` を payload のまま持つ)。`README` の hook の手順と protocol.md の Event の種類を合わせる
- [x] UI のカードに `Paused` の状態を足し、Working より先に判定する。最後の Event が `turn.failed` (`error: rate_limit`) なら Paused (usage limit)、その後の `quota_auto_resume_fired` か `turn.end` で解ける。`quota_auto_resume_stale` と `_disabled` は Needs you (Enter が要る、または自動では続かない) にする。Event の表示名も足す
- [x] 試験: Hub が `StopFailure` の payload を `turn.failed` として取り込むこと (`src/hub` の Event の変換の試験の形)
- [ ] 実際に usage limit に当たったときの Event の並びを design.md §6 に記録し、§6.2-6 を閉じる (発火しなかったら、そう書き、Paused を `quota_auto_resume_*` だけで出せる範囲に直すことを報告で提案する)

### C43. バックグラウンドの処理を待つターンの終わりを、Stopped と出さない
状態: 提案

`Stop` の hook の `background_tasks` に、ターンを終えた時点で走っている処理 (`status: "running"`) が載る (design.md §6.1t)。deployer が試験をバックグラウンドで流して終えたターンは、今の判定では、完了通知で次のターンが始まるまで Stopped, no reply (赤) と出る。2026-10-26 の vcp の C150 で約 4 分。
案: 最新の `turn.end` の `background_tasks` に `running` があれば、Stopped の代わりに Working (添え書きは処理の `description`) にする。Hub は `backlog.lastTurnEnd` に件数か有無を足す (UI の手元の窓に頼らないため。C41)。処理が終わってもターンが始まらない場合 (完了通知を受けない作り) に Working のまま残らないよう、上限の時間を置くかは決めること。

### C46. 文書の更新を信号として、購読した Mailbox に流す
状態: 提案

design.md §3.12 の「信号」の層。`docs:index` で届く索引の差分 (完了条件の増減、節の追加と削除、閉じた `C<n>`) を、場所を指す notice としてトピックに流し、文脈を長く持つセッション (leader) が自分の理解が古くなったと知れるようにする。知見そのものは流さない (§3.14)。
C45 の後、reviewer が依頼のたびに正本を読む形で足りないと分かってから決める (§1.1 の基準 2)。§9 の決定の追加は roadmap の索引に載らないので、拾うなら索引の範囲を広げることになる。

### C47. Forward に定型の添え書きをつけて、別のエージェントに相談する
状態: 提案

将来案 (2026-10-26、ユーザー)。kanary の /relay (design.md §8.1) が速くしているのは、起票 → 別のエージェントに相談 → 訂正案、の一周のうち運ぶ手間。Hub では、leader の報告や提案に「相談」のボタンを置き、押すと宛先が `role:reviewer`、添え書きが定型の問いになった状態で送信の欄を埋め、人が見て Send を押す (design.md §3.12「レビューの依頼は、会話の区間でなく対象で送る」)。
- 部品はほぼある: 無加工の Forward、添え書き (P2 の受け入れ条件 5)、返事を leader へ戻す Reply / Forward と Relay の件数。足すのは定型文とボタンだけ。
- 定型文は問いだけにし、何を照らすかは reviewer.md (C45) に任せる。種類は数個 (整合: 決定・非目標・却下と食い違わないか / 反証: 見落としはないか / 約束: 完了条件はそれだけで確かめられるか)。元文面に `meta.item` があれば項目番号を差し込む。
- 定型文は `roles.json` と同じくリポジトリの設定に置く (設定であって知見ではない。§3.14)。
- 別のベンダーに見せる独立性は、Claude Code 以外の reviewer が要るので C3 の後。それまでは新しい文脈とモデルの違いまで。
- C45 で reviewer の作法が決まってから、定型文の中身を決める。

### C48. C44 で未確認だった溜まりのバッジの 3 場面を ui:check に足す

C44 の完了条件のうち、ui:check は 5 日前の返信待ちの Agent バッジだけを確かめた。絞り込みで隠れた場面、畳んだ範囲の中の場面、質問・許可待ちの You バッジは、コードを書いただけで確かめていない (P2 の `[x] C44` の記録)。
完了条件は 2026-10-27 に reviewer の案をユーザーが承認して直した。
実装の側も直す必要がある: `jumpTo` (public/index.html) は畳みを開いてから絞り込みで隠れているかを見ているので、先に隠れているかを見て、隠れていれば畳みを開かない。

#### 完了条件
- [ ] プロジェクトの絞り込みで隠れている Message を指すバッジを押すと、ステータスに隠れていること (All projects で出せること) を出し、スレッドは動かない (畳んだ範囲の中にあって隠れている場合も、畳みを開かない)
- [ ] 畳んだ範囲の中の (絞り込みで隠れていない) Message を指すバッジを押すと、畳みが開き、その Message がスレッドの表示範囲に入って強調される
- [ ] hook の質問・許可待ちで数えた You バッジを押すと、その Event の行がスレッドの表示範囲に入って強調される (Event が人宛ての返信待ちの request より古い場合と新しい場合の両方で、古い方へ飛ぶ)
- [ ] 人宛ての返信待ちの request (outgoing.to の user) で数えた You バッジと、未接続の Mailbox の未読で数えた Stuck? バッジを押すと、その Message へ飛んで強調される
- [ ] 上の場面が `npm run ui:check` の場面として入り、通る
- [ ] `npm test` が通る


### C49. 誰も接続していない宛先への依頼を、送ったエージェントと人に知らせる

2026-10-27、C45 の完了条件 4・5 の依頼で、leader が `role:reviewer` に 2 件 (#157・#160) の request を送った。reviewer のセッションは起動しておらず、Mailbox `agent-hub.reviewer` に未読で溜まった。leader は返事を待ってターンを終え、人は「止まっている」ことに気づくまで理由が分からなかった。ユーザーが、こういう場合は知らせる措置をとるべきと決めた。
今の作り: `POST /messages` は配信先の `recipients` (未接続も含む) を返す。UI からの送信は、配信先が全部未接続なら `Accepted, but nobody is reading …` と警告する。shim の `post_message` は `recipients` が 0 件のときだけ `warning` を返し、配信先があって全部未接続のときは何も言わない。カードは送り手を `Waiting on others` (`delegated`) と出すが、待っている相手が未接続かは出さない。

#### 完了条件
- [ ] `POST /messages` (と forward) の応答が、`recipients` のうち今接続していない Mailbox を区別して示す。protocol.md §3 を合わせる
- [ ] shim の `post_message` が、配信先が全部未接続のとき `warning` を返す (受理はされ、相手が attach したら未読として届く、と分かる文)。0 件のときの警告はそのまま
- [ ] leader.md に、その `warning` が返ったら返事を待ってターンを終えず、ユーザーへの返事の `要操作` で相手の role の起動を頼むことを書く
- [ ] UI のカードで、送り手が待っている相手 (`outgoing` の宛先) が全部未接続なら、`Waiting on others` と区別して出す (人の手が要る側の見た目にする)。相手が attach したら元に戻る
- [ ] 試験: Hub の試験で、未接続の Mailbox だけが配信先の送信の応答に未接続が示される。shim の試験で、そのとき `warning` が付く
- [ ] `npm run ui:check` に、leader が未接続の reviewer に送った request を待っているカードの場面を足して合格する
- [ ] `npm test` と `npm run docs:check` が通る

### C50. エージェントが作ったものを一時的に置くプールを決め、Hub から参照して受け渡す
状態: 提案

2026-10-27、kanary relay の作者の発言 (デスクトップアプリのインラインのウィジェットで作った画像や HTML のモックを、ローカルのパス経由で別の AI に渡してダブルチェックさせる) を受けて、ユーザーが方向を決めた。画像に限らず、**エージェントが生成したものを暫定的に置くプールの場所を決め、Hub がそこを参照できる**、という抽象にする。インラインで見る速さそのものはクライアントの持ち場で、追わない (design.md §2・§8.1)。
今は画像の経路が「ブラウザ → エージェント」だけ (design.md §3.10)。エージェントの `post_message` にはファイルを付ける口がない。本文にパスを書けば同じマシンの相手は `Read` で開けるが、人の UI には出ず、保存期間の管理にも乗らない。

守る規定 (これに触れる形は採らない):
- Hub は 127.0.0.1 限定で全 API にトークン認証 (§3.8・§4)。compose の Hub はコンテナの中にいるので、見えるのは mount したものだけ。
- Hub が持つのは配送のための状態だけ (§3.14)。プールは知識の置き場にせず、期限で消える一時物にする。
- 他のエージェント由来の中身はデータとして扱う (§4、protocol.md §6)。UI は HTML などを実行しない (画像は表示、ほかは開かずに中身かリンクを出すなど)。
- 中身を要約・加工しない。Message から来た文字列をそのままパスにしない (§3.10 の id の扱いに倣う)。

決めること:
1. プールの場所: プロジェクトごと (例 `<project>/.agent-hub/pool/`、gitignore する) か、ホストに 1 つ (`HUB_POOL_DIR`) か。
2. Hub の参照のしかた: プールを Hub に読み取り専用で mount するか、shim が Hub へ上げるか (mount なら compose と直接起動の両方の形を決める)。
3. Message からの指し方: §3.10 の `meta.files` (id) に寄せるか、プールの中の相対パスか。受け手には今と同じく `path` を渡す。
4. 扱う種類と UI の見せ方: 画像 (A/B/C を並べて見比べる)、HTML のモック、テキストや差分。
5. 期限と掃除の受け持ち (§3.14 の画像の TTL と揃えるか)。
6. §3.10 のブラウザからの画像の経路を、同じプールにまとめるか。

関係: C47 (相談のボタン) と C3 (Claude Code 以外のクライアント) で、別のエージェント・ベンダーにダブルチェックさせるときの運び先になる。
