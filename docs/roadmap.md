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

### C28. 読んで動いたのに、受領の確認と返信待ちが残る
状態: 提案

Channels では受領の確認が `replyTo` の返信でしか付かず、付くのはその `replyTo` の Message までである (protocol.md §4)。vcp の C147 の通し (design.md §6.1n) で、次の 2 つが残った。
- **まとめた返信**: 作業中に届いた手直しの依頼を、leader は最初の依頼への返信 1 本でまとめて答えた。手直しの依頼は返信がないので、ずっと返信待ち (エージェントの番) に出る。
- **報告への返信はない**: deployer から leader への reply は、leader が読んで次の指示を出しても確認にならない。報告にさらに返信する人はいないので、leader の Mailbox では保存期間まで「怪しい」に残る。leader と deployer の往復のたびに増える。

候補: 返信で `replyTo` より前に渡した分までをまとめて確認にする (同じセッションのターンで読んだはずなので) / `post_message` で複数の `replyTo` を受ける / 渡した後に同じ Mailbox が送った Message があれば、その時点までを確認にする。どれも Channels では「読んだ」の保証にはならない (§6.1k) ので、怪しいの層を何のために置くかと一緒に決める。design.md §3.16 で配送の細部として軽く扱うとした範囲に入る。

2026-10-21 の vcp の C142 の通し (design.md §6.1o) でも同じ形が 3 件増えた。前日の手直しの依頼が残っていたので、leader のバッジは今日の作業と関係なく `Agent 3 · 24h` (赤) になった。人の催促 (#72) は、催促どおりに動いても催促への返信がないので返信待ちに残った。

### C29. 起動スクリプトで権限モードを渡す
状態: 提案

`start-agent.ps1` / `start-team.ps1` は権限モードを渡さないので、Claude Code の既定 (この開発機では auto) で起動する (design.md §6.1o)。既定のモードの許可待ちを試すには `claude --permission-mode default` を渡す口が要る。`-PermissionMode` を足し、省略時は今までどおり渡さない、が候補。role ごとに既定を持たせるか (例: deployer だけ default) も決める。
2026-10-21 (2.1.306): Shift+Tab の切り替えに `default` はなく `manual` がそれに当たり、hook の `permission_mode` には `default` と載った。手で `manual` にすれば許可待ちは試せる (§6.1o) ので、急ぎではない。

### C33. 起動し直した直後に、start-team が前の接続を「attach した」と読む
状態: 提案

`start-team.ps1 -Force` は、起動したタブの Mailbox に Attachment があるかだけを見る。前のセッションを止めた直後は Hub に前の Attachment がリースの切れるまで残るので、新しい claude が起動に失敗しても (2026-10-21 は NVM が claude を止めた) 「attach した」と出た。候補: 起動前の Attachment の `id` (または `sessionId`) を覚え、違うものになるまで待つ / `-Force` のときは前の Attachment が外れるのを先に待つ。

### C30. 許可した後に、許可待ちが解けたことが分からない
状態: 提案

質問待ちには `question.answered` (`PostToolUse`) があるが、許可待ち (`Notification` の `permission_prompt`) には対になる Event がない。許可して作業が再開しても、カードの `Last event` は次のターン終了まで `permission` のまま残る (design.md §6.1o)。`Notification` の payload にはツール名もない。候補: 許可待ちの後の最初の `PostToolUse` (どのツールでも) を `permission.resolved` として取る / `PostToolUse` の hook を全ツールに広げる負荷を測ってから決める。拒否されたときに何が届くかも確かめる。

### C31. カードの `Last event` に日付がない
状態: 提案

UI の `time()` は `toLocaleTimeString()` だけなので、前日の Event が今日の時刻に見える (design.md §6.1o)。今日でない Event には日付を付ける。Message の時刻にも同じ `time()` が使われているので、同じ規則で揃える。

### C32. Hub の外で始まったターンで、返信を忘れる

deployer がバックグラウンドのテストを待ってターンを終え、完了通知で始まったターンで結果をターミナルに書いただけで、leader に `post_message` しなかった (design.md §6.1o)。人が催促するまでチームは止まっていた。

2026-10-21 に、安い方の案 (role の説明に書く) で決定した。Hub の側で止まりを目立たせる案は、返信待ちの判定 (C28) が正しくなってから意味を持つので C34 に分けた。

#### 完了条件
- [x] `tools/dev/roles/deployer.md` に、依頼の結果は、どのターンで終わっても (バックグラウンドの処理の完了通知で始まったターンも) reply で leader に返すことを、ターミナルに書くだけでは届かないという理由とともに書く
- [ ] 実チームの通しで、deployer がバックグラウンドの処理を待ってターンを終えた後も、催促なしに reply を送ることを確かめ、design.md §6 に記録する

### C35. 独自の台帳を持つプロジェクトから依頼を中継する
状態: 提案

Hub で回すのは、作業を切り出したリポジトリ (台帳 `### C<n>.` を持つ) とし、依頼元が独自の台帳や番号の体系を持つプロジェクト (thesis の CLAUDE.md の「項目N」など) には `C<n>` を混ぜない (2026-10-22、ユーザー。グローバルの skill `roadmap-items` に書き方を置いた)。
例は thesis と cite-bridge: 設計書と取り込み (submodule の更新) は thesis、実装と台帳は cite-bridge。チームは thesis の中ではなく cite-bridge の単独の clone で起動する (親の CLAUDE.md を読ませないため)。
今は何も足さずに回せる (`project` は値。design.md §3.15)。足すとしたら、項目のカードに「持ち主」(依頼元のプロジェクト) を出す、終わった項目を持ち主の Mailbox へ notice で知らせる、など。重く考えず、実際に回して要るものが分かってから決める。

### C38. usage limit で止まったセッションを、Working と区別して出す

cite-bridge の deployer は usage limit で 2 時間 20 分止まったが、Hub には止まった瞬間の Event がなく、カードの状態 (C37) は `Working` と出ていたはず (design.md §6.1q)。公式の hook の `StopFailure` (API のエラーでターンが終わったとき) と、Notification の `quota_auto_resume_*` を使う。`StopFailure` が自動の再開を待つ場合にも発火するかは未検証 (§6.2-6) なので、登録して次の制限で確かめる。2026-10-23 にユーザーが決定。

#### 完了条件
- [ ] `tools/hooks/settings.json` (と `settings.command.json`) に `StopFailure` を足し、Hub が Event に取り込む (例 `turn.failed`、`error` と `last_assistant_message` を payload のまま持つ)。`README` の hook の手順と protocol.md の Event の種類を合わせる
- [ ] UI のカードに `Paused` の状態を足し、Working より先に判定する。最後の Event が `turn.failed` (`error: rate_limit`) なら Paused (usage limit)、その後の `quota_auto_resume_fired` か `turn.end` で解ける。`quota_auto_resume_stale` と `_disabled` は Needs you (Enter が要る、または自動では続かない) にする。Event の表示名も足す
- [ ] 試験: Hub が `StopFailure` の payload を `turn.failed` として取り込むこと (`src/hub` の Event の変換の試験の形)
- [ ] 実際に usage limit に当たったときの Event の並びを design.md §6 に記録し、§6.2-6 を閉じる (発火しなかったら、そう書き、Paused を `quota_auto_resume_*` だけで出せる範囲に直すことを報告で提案する)

