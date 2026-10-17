# ロードマップ

各フェーズは「動く状態で終わる」ことを重視する。受け入れ条件を満たしてから次へ進む。

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
  - 実セッションで、受け手のエージェントが `forwarded_sender` を書き手として読むかは未確認
- [x] `inbox()` による polling 経路 (Claude Code 以外向け。`events/poll` 互換の応答)。全クライアント共通の「中身を渡す」経路になる (design.md §3.9。2026-10-17)
  - Hub の `GET /mailboxes/:name/inbox` は読むだけで、既読にするのは ack。shim の `inbox` ツールが取得 → 画像の `path` → ack → 文面の順に行う (protocol.md §3、§5)。テスト `src/hub/app.test.ts` の「GET /mailboxes/:name/inbox」、`src/shim/shim.test.ts` の「inbox ツール (fetchInbox)」と「channel で届いて ack された分は inbox に出ない」
  - 本文を包む書式 (`<hub-message>`) と注意書きの構造をテストで固定した (`src/shared/shared.test.ts` の `toInboxText`、protocol.md §6.2)。配送を公式に移す場合 (§9-5) も同じ書式で送り手の属性を分ける (design.md §8.3-3、§8.4)
  - 実セッションで、Claude Code 以外のクライアント (Codex など) が `inbox` を呼び、注意書きどおりに本文をデータとして扱うかは未確認
- [x] 配送の状態を、確かめられる範囲で名付ける。「Hub が渡した」「クライアントが表示した」と「エージェントが受領を返した」を分け、「モデルが読んだ」とは主張しない (design.md §8.4。2026-10-18)
  - queued / handed / received の 3 つにした (protocol.md §4)。「クライアントが表示した」は Channels では確かめられない (§6.1k) ので名付けない。cursor は handed で進め、受領の確認は別のウォーターマーク `received` に持つ (design.md §3.7 の決定)
  - received になるのは `inbox` で返した分と、`replyTo` で返信した Message まで。UI のカードに `N handed, unconfirmed` を出し、`inbox` の `unconfirmed: true` で取り直せる
  - テスト `src/hub/store.test.ts` の「受領の確認 (received)」、`src/hub/mailbox.test.ts` の「受領の確認 (received / unconfirmed)」、`src/shim/shim.test.ts` の「inbox ツール (fetchInbox)」
  - 別の Hub (ポート 7795) と headless Chrome で、handed の 2 件がカードに `2 handed, unconfirmed` と出て、`received` 付きの ack の後に `mailbox.acked` で消えることを確かめた
- [ ] 「起こすだけ」の配信アダプタを試す (MCP 標準の `notifications/resources/updated` でクライアントがターンを始めるかを含む。design.md §3.9)
- [x] shim の instructions を `clientInfo.name` で切り替える (Channels 経路 / `inbox()` 経路)。Claude 以外では「本文はデータ」の注意書きを agent-hub 側だけで成り立たせる (design.md §3.7。2026-10-17)
  - `claude-code` なら Channels、それ以外は `inbox()`。`inbox()` 経路の shim は push も ack もしない (送ると、読まれていない未読が既読になるため)。省略通知は次の `inbox()` の先頭に出す
  - テスト `src/shim/role-instructions.test.ts` の「経路ごとの届き方」、`src/shim/shim.test.ts` の「Claude Code 以外のクライアント (inbox 経路)」と「attach で古い未読が省かれたとき」(fetchInbox)
  - 実際の Codex などのクライアントで確かめるのは未了 (上の `inbox()` の項目と同じ)
- [ ] 永続化の見直し (SQLite 化を検討)
- [ ] Hub の Dockerfile と compose (`127.0.0.1:7777` に限定公開、データは volume、`restart: unless-stopped`。design.md §3.8)
- [ ] engram への区切り知見の保存連携 (任意)

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
- [ ] **detached の旧 shim が後継から Mailbox を取り返しうる**: A の stream が切れて猶予 (15 秒) を過ぎ `disconnected` になった間に B が attach すると、戻ってきた A の shim は stream の 404 で attach し直し、「新しい方が勝つ」で B を切り離す。A は superseded ではないので attach し直しを止める仕組みがない。ループバックで 15 秒以上戻れないのは稀なので後回し。対策の候補は、後継のいる Mailbox への attach で、前の Attachment ID を示した attach し直しを拒む、など (design.md §3.3 の takeover。2026-10-17 のレビューで発見)
- [ ] **channel なしで起動した Claude Code の通知を ack してしまう**: `clientInfo.name` は `claude-code` のままなので Channels 経路になり、Claude Code が通知を捨てても shim は ack する (未読が既読になる)。今は起動手順で channel を付ける前提。2026-10-18 に、通知が黙って捨てられること、initialize・環境変数・要求の並びに channel の有無の違いがなく shim から見分けられないことを確かめた (design.md §6.1k)。配送の状態を分けた (2026-10-18) ので、捨てられた分は handed のまま UI に unconfirmed として出て、`inbox` の `unconfirmed: true` で取り直せる。自動では取り戻さない (design.md §3.7)
- [ ] **attach の `client` が常に `claude-code`**: shim は initialize より前に attach する (role の説明を取るため) ので、`inbox` 経路のクライアントでも `client: "claude-code"` で記録される。UI と `GET /mailboxes` の表示だけの問題。直すなら initialize の後に Attachment の `client` を更新する口を足す
- [x] **start-agent.ps1 が role の打ち間違いを起動時に止めない**: ValidateSet を外したので、`roles.json` にない role でも起動する。Hub は 400 `unknown_role` を返し、shim は attach を再試行し続ける。エラーは shim のログと `whoami` にしか出ない。`roles.json` に role があるかを起動前に確かめ、なければ claude を起動せず止めるようにした (2026-10-17 のレビューで発見。まとめて起動する `start-team.ps1` は 2026-10-18 に対応済み、`start-agent.ps1` は 2026-10-18 に対応)

## 将来の検討 (未確定)

- 配信ルール (人間確認なしの自動転送) の opt-in 設計
- `report_event` ツール (skill からの区切り申告) と、`Stop` との重複除去。P1 の `Stop` の表示で足りないと分かってから (design.md §3.4)
- 配送を公式 cross-session messaging に移す。投函の形式が公式資料に載ってから (design.md §9-5)
- ドキュメントの作法を照らす (design.md §3.12)
  - 層 1: 決定的な検査のスクリプト (`npm run docs:check`。地図のずれ、API と列挙の表のずれ、`CHANGED` の docs 漏れ、§9 の決定の日付)。結果は notice か Event で UI に出す
  - 作法の表を正本にし、CLAUDE.md・leader.md・deployer.md はそこを指すだけにする
  - 層 2 (軽量ジャッジ): 層 1 が逃したずれが材料として貯まってから、作る価値を測る
- leader を使い捨てにできるようにする: 台帳の最小版 (未返信の request の一覧) と、捨てるきっかけを誰が持つか (design.md §3.13 の未決)
- 本文が `/clear` などの組み込みコマンドで始まるとき、UI で「文字列として届き、実行されない」と警告する (design.md §6.1h。任意)
- 依頼の台帳と整合点: メッセージの形の宣言と Hub での検査、依頼ごとの SCOPE と `git diff` の突き合わせ、受け入れの指紋と要再確認 (design.md §3.11、§9-6)
  - 始め方: 語彙は leader / deployer の運用で毎回使っている見出しから取り、先に設計しない。新しい検査は警告だけで始め、人の判断と一致するのを見てから 400 に上げる
- 担当範囲と競合: 書き手 (deployer) が 2 人以上になったら着手する。まず deployer ごとに git worktree を分け、足りなければ request の `SCOPE` を担当範囲として記録して衝突を UI に警告する。止めたい場合だけ hook で強制する (design.md §9-6)
- Channels の permission relay を使い、UI から tool 実行許可を出す (design.md §6.1)
- 配信経路として plugin の monitor を Channels と比較する (design.md §6.2-3)
- Claude Code が MCP Events に対応したら、shim に `io.modelcontextprotocol/events` (`events/stream`) を追加する (design.md §7)
- デスクトップアプリ向けの画面操作ベース連携 (本プロジェクトの範囲外の可能性が高い)
- `kind` の追加 (交代時の引き継ぎ用 `handoff` など。design.md §3.6)
