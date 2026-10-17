# 設計書

## 1. 背景と動機

- 複数のエージェント (Claude Code セッション、将来的には Codex など) を併用すると、人間が間に入ってコピペで受け渡すことになる。
- ただし**人間が間で読むこと自体は価値がある** (誤解に気づく、文脈を足す、そもそも送らない判断をする)。自動化すべきは「運搬」だけ。
- よって方針は **human-in-the-loop を保ったまま、運搬を取り除く**。エージェントの自律オーケストレーションは目的ではない。

### 1.1 位置付け (2026-10-16、§8 の調査の後)

agent-hub は**大手の部品の上に乗る薄い層**とする。配送・検知・実行は大手から借り、自前で持つのは**記録・約束事・人間の判断点**の 3 つだけ。
汎用にするのはデータの形と約束事 (どの会社のエージェントでも同じ形)。用途に特化するのは自分の運用 (leader / deployer、評価) だけ。

| 層 | 持ち手 | 理由 |
|---|---|---|
| 実行・オーケストレーション・クラウド | 大手 | 費用とインフラが要る。大手が良いものを出す |
| セッションへの配送 (Channels、cross-session messaging) | 大手から借りる | 公式が動き続けている。自前で作っても目減りする |
| 状態の検知 (質問待ち・完了) | 大手から借りる | Agent View と Notification hook がある (§8.1) |
| 記録 (台帳・Mailbox・`kind`・`from`) | 自前 | 会社をまたいで同じ形で残り、乗り換えても自分のデータになる。大手には作る動機が薄い |
| 約束事 (role・メッセージの形・SCOPE・作業前の予約) | 自前 | 自分の仕事の進め方そのもの (§3.11、§8.4) |
| 人間の判断点 (Send を押す・ブラウザのコンソール) | 自前 | 世の流れが自律寄りなので、自分で守るしかない |
| つなぎ口 (配信アダプタ) | 自前、ただし薄く | 大手の部品が変わったら、ここだけ差し替える (§3.9) |

続けるかを決める基準:

1. 公式に同等の機能が出たら、自前の方を消す。自前の部分は、差し替えられる口として作る。
2. 自分が毎週使わない機能は作らない。汎用であることは、機能の数ではなくデータの形の中立さで満たす。
3. エージェントの振る舞いを比べる評価の場として使えることも、価値に数える。

構成の方針 (2026-10-16、ユーザ):

- **思想は Hub に集め、枝葉は差し替えられるようにする**。Hub はシンプルに保ちつつ、約束事 (§3.11) は精密に持つ。配信アダプタ (§3.9)・UI・クライアントは変わってもよい部分で、Hub への影響が小さくなるようにする。
- **GUI は自前にする**。UI は人間の判断点そのもので、外部のアプリに依存させる理由が薄い。他のツールは機能の参考にとどめる。
- **CLI を LLM の作業場所として前提にする**。公式の GUI に主戦場が移るという見方 (Relay の作者、2026-10) はあるが、CLI を外すのではなく、LLM が力を出しやすい場所として配慮する。LLM はテキストを書き、HTML での表現は Hub と UI が受け持つ (§3.11)。

実用だけが目的なら、既存のもの (mcp_agent_mail など) に UI を足す方が安い。それでも自前を続けるのは、「人間が押す」「role を宛先にできる」「送り手の属性を `meta` で本文から分ける」の 3 つが既存のものにないからである。これらが要らなくなれば、乗り換えを考える。

## 2. 要件

| ID | 要件 |
|---|---|
| R1 | エージェントの**セッション区切り**と**質問待ち**を、エージェントの外側から検知できる |
| R2 | ユーザーがブラウザで R1 の内容を確認できる |
| R3 | ユーザーがブラウザからメッセージを書き込み Hub に push できる。編集せず転送のみ (他エージェントへのメッセージパッシング) も可 |
| R4 | エージェントは**購読を明示的に宣言**する。Hub に push があると、購読しているエージェントだけが notify を受ける |
| R5 | セッションが一時的に閉じていても取りこぼさない (未読キュー) |
| R6 | **エージェントの交代** (`/clear`、再起動、モデル変更、別ツールへの乗り換え) をまたいで、宛先・購読・未読を引き継げる |
| R7 | エージェントは **role** (`reviewer`, `deployer` など) を持ち、role によって読むべきメッセージが分かれる |
| R8 | メッセージは**機械的に判別できる種別** (`kind`) を持ち、受信側と UI が扱い方を決められる |

### 非目標

- エージェントの自動実行・自律的なタスク分配
- 会話の要約・要点抽出 (中身は加工せずそのまま運ぶ)
- 人間の確認なしで他エージェントへ自動転送すること (既定は必ず人間の Send 操作を挟む)
- リモート公開・マルチユーザー対応 (127.0.0.1 限定)

## 3. アーキテクチャ

```
┌──────────────┐   SSE / HTTP    ┌──────────────────────────────────┐
│ ブラウザ UI   │ ◀────────────▶ │ Hub (常駐 daemon, 1 プロセス)       │
└──────────────┘                 │  - Mailbox 表 (購読・cursor・未読)   │
                                 │  - Attachment 表 (接続中セッション)  │
 hooks ── POST /events ────────▶ │  - メッセージ / イベントログ (JSONL) │
                                 └──────▲──────▲──────▲───────────────┘
                                        │ SSE  │      │   shim が Mailbox に attach
                              ┌─────────┴┐ ┌───┴─────┐ ┌┴────────┐
                              │ shim     │ │ shim    │ │ shim    │  channel MCP (stdio)
                              └────┬─────┘ └────┬────┘ └────┬────┘
                                   ▼            ▼           ▼
                              Claude         Claude      (Codex 等: inbox() polling)
                          mailbox=main   mailbox=rev-a
                                         role=reviewer
```

### 3.1 なぜ Hub と shim を分けるか

Channel MCP サーバーは **Claude セッションごとにサブプロセスとして起動**される。
MCP サーバー自身を HTTP の受け口にすると、複数セッションでポートが衝突し、状態も共有できない。
そのため状態と HTTP を **Hub (1 つ)** に集約し、**shim (セッション数ぶん)** は薄い橋渡しに徹する。

MCP Events (§7) の用語でいえば、Hub は「イベントを受けて保持し、クライアントに poll / push で渡す **Forward Proxy**」の位置にあたる。
SEP はクライアント側に購読状態の正本を置くが、agent-hub ではクライアント (shim) を無状態に保つため、その正本を代理人である Hub が持つ。

### 3.2 コンポーネント

**Hub**
- ホストのループバックからのみ到達できる HTTP サーバー。常駐 daemon として起動する (直接起動 / Docker は §3.8)。
- 保持するもの: Mailbox 表、Attachment 表、メッセージ、イベントログ、role 定義 (設定ファイルから読む)。
- ブラウザ UI の静的ファイルも配信する。
- 永続化は P0 では JSONL 追記ログ + メモリ (起動時にログから Mailbox 表を復元)、必要になれば SQLite (P2)。

**shim (channel MCP サーバー)**
- Claude Code が stdio で起動する薄い MCP サーバー。**状態を持たない。**
- 起動時に Mailbox 名と role を決めて Hub に **attach** し、Hub からの SSE を購読する (§3.3, §3.5)。
- Hub から配信されたメッセージを `notifications/claude/channel` として Claude に push する。
- role の説明を MCP の `instructions` に差し込み、エージェントに「自分は何を読み、何を返す係か」を伝える。
- エージェントが呼ぶツールを公開する: `attach` / `whoami` / `subscribe` / `unsubscribe` / `post_message` / `inbox` / `list_topics` / `report_event` (後回し。§3.4) (詳細は protocol.md)。

**hooks (検知側)**
- Claude Code の **HTTP hook** (`type: "http"`) で、hook の入力 JSON を Hub の `POST /events` に直接送る。スクリプトは書かない (§6.1)。設定例は `tools/hooks/settings.json`。
  `--settings` で渡すと誤動作する (§6.1f) ので、`.claude/settings.local.json` などに写して使う。`Authorization` は環境変数 `HUB_TOKEN` から展開されるので、Claude Code の起動環境に要る (`start-agent.ps1` は `.env` から渡す)。
- 機械的な検知を担う (下記 3.4)。

**ブラウザ UI**
- Hub が配信する 1 枚の HTML (まずはフレームワークなし)。
- 機能: イベント/メッセージのライブ表示 (SSE)、メッセージ作成・送信、受信メッセージの無編集転送ボタン、Mailbox 一覧 (接続状態・購読・未読数。切れていれば時刻と理由)。
- 画面は固定し、スクロールはスレッド (`#list`) と Mailbox 一覧 (サイドバー) だけ。上部はスレッド操作バー (表示の見せ方: Compact・Keep latest、今後のフィルタ・検索など)、下部はコンポーザー (送る操作: kind・宛先・本文・Send、今後の添付など) に置く。
- メッセージは送り手の role で色分けする (ラベルのチップと縁取り。role がなければ mailbox 名)。kind は枠線だけのバッジで示し、色には使わない。送信フォームの kind も同じバッジを並べたトグルにし、選んだものだけ塗る。
- 検知イベント (§3.4): スレッドに Message と時刻順に挟み、破線の枠で Message と区別する (縁取りは Mailbox の色)。中身は種類ごとに出す: 質問は質問文と選択肢、許可待ちと通知は文言、ターン終了は最終応答 (長ければ先頭だけ見せて開いて読む)。
  `question` と `permission` は人の手を待つものとして目立たせる。Mailbox のカードには最後に届いた Event の種類と時刻を出す (状態は推定しない)。Event の Reply は、その Mailbox 宛ての `request` を書き始める (Event は Message ではないので `replyTo` は付けない)。
  Compact は Message と Event を合わせて数える。`/events` のない古い Hub (404) では Event を出さない。
- タブの未読: 非表示中に SSE で届いた、人間宛て (`to.type === 'user'`) の他者のメッセージ数と、`question` / `permission` の Event の数をタイトル `(n) agent-hub` と favicon のバッジで示す。agent 同士のメッセージ (`mailbox:*` / `role:*` / `topic:*` 宛て) は数えない。前面に戻るかフォーカスで消す。自分の送信と履歴読み込みは数えない。再接続後に取り直した分も同じ規則で数える。
- 接続の回復: SSE が開き直すたびに `GET /messages?after=<開いた時点の描画済みの最大 seq>` で取り直し、描画する (最初の接続は履歴の読み込みが受け持つ)。取り直しに失敗しても表示は止めず、次に開いたとき取り直す。Mailbox 一覧が失敗したら #err に出し、少し待って数回まで試す (SSE が開き直したときも試す)。履歴と新着は一覧の成否と独立に動く。
- 送信: 送信中に打ち足した本文と、送信後に足した画像は残す。送ったもの (送信時点の本文と画像) だけを消す。失敗したときは何も消さない。起動時の `/settings` は 1 回だけ読み、初期の宛先と Commands に使う (Commands のダイアログは開くたびに読み直す)。
- Mailbox の削除: 接続していない Mailbox のカードにだけ Delete を出す (確認のあと `DELETE /mailboxes/:name`)。カードの選択は起こさない。409 (その間に attach された) と、削除に対応しない古い Hub の 404 は #err に出し、カードは外さずに一覧を取り直す。`mailbox.deleted` を受けた他のタブも一覧を取り直す。
- Mailbox のカードの未読数: 新着 (`message`) と ack (`mailbox.acked`) で一覧を取り直し、ポーリングはしない。`effectiveSubscriptions` や `unread` を欠く古い Hub の応答では、購読は空、未読の項目は出さない (カード全体は描く)。
- UI の表示文言は英語にする (メッセージ本文は対象外で、そのまま表示する)。このドキュメント自体は日本語のまま。
- カスタムコマンド: 本文の `/name` (または `/name 引数`) を Send の瞬間に定義済みの text へ置換して送る。置換は UI が行い、Hub はコマンドを知らない (置換後の本文を普通のメッセージとして受ける)。スレッドに残るのも置換後の本文なので、何を送ったかがそのまま見える。人間が Send を押したときだけ動き、自動送信はしない。設定は Hub 側の `HUB_DATA_DIR/settings.json` にあり、手で編集できる (読みは毎回ファイルから行う)。Hub が `/settings` を持たない古い版のときは Commands を無効にし、送信はこれまでどおり。
- 初期の宛先 (To): 自動で選ぶのは (1) 前回送った宛先 (localStorage `agent-hub.lastTo`) → (2) settings.json の `defaultTo` (例 `mailbox:leader`) の順で、どちらも**接続中 (attach 中) の先だけ**を候補にする。mailbox は attach 中のもの、role と topic は attach 中の Mailbox が持つものに限る。user:browser は常に候補。どちらも候補になければ**未選択** (先頭表示は "Select a destination…")。先頭の Mailbox や topic:user.message への後退はしない。`defaultTo` は初回の判定より前に読む。
  - 自動で選んだ値 (autoTo) は Mailbox 一覧の更新 (buildTo) のたびに決め直す。だから attach されると、既定が正しい候補へ自動で移る。
  - 人が選んだら止まる: ドロップダウンを開く・キーを押す・値を変える・サイドバーの Mailbox を押す・Reply・Send のいずれかで自動フラグを外し、以後の一覧更新では動かさない。同じ値を選び直しても止まる (開いた時点で外す。開いてやめた場合も外れる)。
  - 未選択のまま Send は拒否し、`Choose a destination first.` を出す (何も投稿しない)。
  - 届く先の Mailbox が全部未接続の宛先 (`mailbox:` / `role:` / `topic:` のどれでも) に手で送ると、記録はされるが警告を出す (`Accepted, but nobody is reading … now; it will stay unread until it attaches`)。判定は `POST /messages` の `recipients` と Mailbox 一覧の接続状態で行い、一覧にない名前は未接続とみなさない。0 件の警告 (`No Mailbox will receive`) が出るときはそちらを優先する。
  - Reply は元の送り手を選ぶ (手動の選択として扱う)。

### 3.3 Mailbox と Attachment (R5, R6)

宛先の同一性を「どのプロセスが受け取っているか」ではなく「**論理的に誰宛てか**」で決める。
MCP Events (SEP-3415) が購読 ID をクライアント生成にせず、購読内容から決定的に導出しているのと同じ発想 (§7)。

| 層 | 寿命 | キー | 持つもの |
|---|---|---|---|
| **Mailbox** | 長寿命。明示的に削除するまで残る | 論理名 (例 `main`, `rev-a`) | role、購読トピック、cursor (ack 済みウォーターマーク)、未読キュー |
| **Attachment** | 一時的。セッションの生存期間 | Hub が払い出す `attachmentId` | `sessionId`、`client` (claude-code / codex など)、`cwd`、リース期限 |

- **Mailbox 名の決め方** (優先順): 環境変数 `HUB_MAILBOX` → MCP ツール `attach(mailbox)` の明示呼び出し → `HUB_ROLE` があれば role 名 → 未指定ならカレントフォルダ名。
  `HUB_MAILBOX` / `HUB_ROLE` が shim に渡るかは §6 で検証する。
- **attach は冪等**。同じ Mailbox に attach し直すと、Hub はその Mailbox の cursor 以降を再送する。shim は覚えなくてよい。
- **交代 (R6)** は「新しいセッションが同じ Mailbox に attach する」だけで成立する。購読・未読・cursor は Mailbox に残っている。
- **takeover (排他・新しい方が勝つ。§9-1 で決定)**: 既に Attachment がある Mailbox に別セッションが attach すると、旧 Attachment に `terminated(reason: superseded)` を送って切り離す。
  切り離された shim は attach し直さず (取り返しの応酬を避ける)、`post_message` は引き継がれた旨のエラーを返す。
  UI のカードには、今の Attachment が takeover で始まったことを `took over <時刻>` と出す (`GET /mailboxes` の `takeover`。Hub のメモリのみ)。
- **リース**: stream を開いている間はリースを保つ。stream を開かないクライアント (`inbox()` の polling 経路) は heartbeat でリースを延長する。リースが切れた Attachment は detached になり、その間のメッセージは Mailbox の未読キューに溜まる。Mailbox 自体はリース切れでは消えない。
  **決定 (2026-10-17)**: shim は heartbeat を送らない。shim は常に stream を開いていて、生死は stream の切断 (15 秒の猶予) で分かる。heartbeat を shim に義務づけると、更新前の shim を動かしたままの Claude Code が新しい Hub でリース切れになる。
  detached の理由 (`closed` / `disconnected` / `lease_expired`) は、次の attach まで Mailbox に添えて UI に出す。Hub のメモリにだけ持ち、再起動で消える。
- **後継への流し込み量の制御**: attach 時に `maxAgeMs` を指定でき、それより古い未読は渡さない。切り捨てがあれば `truncated: true` を返し、shim はその旨をエージェントに 1 件の通知で伝える。
  Channels は作業中に届いた通知を次のターンにまとめて渡すため、長期不在後の大量流し込みを防ぐ目的がある。

### 3.4 検知 (R1)

| 検知対象 | 手段 | 性質 |
|---|---|---|
| ターン終了 (区切り候補) | `Stop` hook | 確定的・機械的 |
| 許可待ち・入力待ち | `Notification` hook | 確定的 |
| エージェントからの質問 | `PreToolUse` hook (matcher: `AskUserQuestion`) | 確定的 |
| 質問への回答 | `PostToolUse` hook (matcher: `AskUserQuestion`) | 確定的。UI で質問待ちが終わったことを示し、質問の表示による `permission_prompt` を見分けるのに使う |
| 「ここでセッションを区切るべきか」の意味判断 | clear-timing skill のような skill | 意味的 (エージェント側の判断) |

機械的な検知は hook、意味的な判断は skill、と役割を分ける。
skill が「区切りに来た」と判断した場合は、エージェントが `report_event` で Hub に申告する (後回し。下記)。

**P1 で作る範囲 (公式 Agent View との分担、2026-10-16)**: 状態の検知は大手から借りる (§1.1)。agent-hub が作るのは「ブラウザで見て、ブラウザから返す」部分だけにする。
- 借りる (作らない): 全セッションの状態一覧 (Working / Idle / Completed / Failed の推定)、ターミナルからの返信、エージェント同士のアイドル通知 (`notify_when_idle` / `TeammateIdle`)。
  UI は Event から状態を推定しない。届いた Event をそのまま出す。
- 作る: hook → `POST /events` → Mailbox の解決 → UI で「質問待ち」「許可待ち」「ターン終了」を区別して出す。中身 (質問文、`last_assistant_message`、通知の文言) も出す。
  そこから返信を作り、今の送信 (Channels) でそのセッションに届ける。
- Agent View が使う Notification (`agent_needs_input` / `agent_completed`) も、ほかの Notification と同じ経路で取り込む。区別は Claude Code 用の変換で行う。
- 質問にはブラウザから答えられない。channel の通知は回答として扱われず、回答の後に届く (§6.1c)。UI はそう書いて、ターミナルで答えるよう促す。
- 許可プロンプトは P1 では表示だけにする。UI から許可を出す (Channels の permission relay) のは将来の検討 (§6.1)。Agent View もその場では答えられないので、ここは借りられない部分にあたる。
- 後回し: `report_event` と、`Stop` との重複除去。区切りの意味判断は、今はエージェントが人間への返事で言えば足りる。`Stop` の表示だけでは足りないと分かってから足す (§1.1 の基準 2)。

**hook イベントと Mailbox の対応付け**: 実機では stdio サーバーの環境に `CLAUDE_CODE_SESSION_ID` があり、hook の `session_id` と一致した (§6.1c)。
ただし公式資料に記載のない挙動なので、なくなっても動くように、shim と hook が同じ起動環境を共有することを使った手段を重ねる。
- 第一手段: shim が `CLAUDE_CODE_SESSION_ID` を attach の `sessionId` として申告する。Hub は hook 入力の `session_id` → Attachment → Mailbox で解決する。
  実行中に `attach` ツールで Mailbox を切り替えても、この対応は正しく追従する。
- 第二手段: HTTP hook の `headers` で `X-Hub-Mailbox: $HUB_MAILBOX` を送る (`allowedEnvVars` に `HUB_MAILBOX`)。shim も同じ `HUB_MAILBOX` で attach するので、名前で直接結びつけられる (実機で展開を確認済み)。
- 第三手段: ヘッダーも空なら、hook 入力の `cwd` から shim と同じ規則 (フォルダ名) で Mailbox 名を導く。
- 第二・第三手段で解決できたときは、そのイベントの `session_id` を Attachment に記録し、以後は第一手段と同じく扱う。
親 PID 照合は Windows でシェル経由の親子関係が崩れうるため採らない。

**イベント ID**: 同じ区切りが `Stop` hook と `report_event` の両方から届いても重複除去できるよう、イベント ID は可能なら上流の値 (`session_id` + hook 固有の値) から決定的に作る (SEP の `eventId` の考え方)。

engram (ユーザーの記憶 MCP) は**区切りで得た知見の永続化先**として使う。ライブのキューや購読表は engram に載せず Hub 内に持つ (応答性のため)。

### 3.5 購読と role (R4, R7)

**Mailbox と role は別の軸**として扱う。Mailbox は「誰か」(継続性・未読の持ち主)、role は「何をする係か」(読むべきもの) を表す。

- 購読は **Mailbox に紐づく**。エージェントは次のどちらかで**明示的に**購読を宣言したときだけ配信を受ける。
  - **role の宣言**: attach 時に role を指定すると、role 定義の既定購読が付く。role は Mailbox の属性として残り、交代後も引き継がれる。
  - **`subscribe(topic)`**: role の既定に加えて個別に購読する。
- 実効購読 = role の既定購読 ∪ 個別購読。Hub は role 定義から毎回計算し、Mailbox には個別購読だけを保存する (role 定義を変えると即座に反映される)。
  `unsubscribe` で外せるのは個別購読だけ。role の既定を外したい場合は role 定義を変える。
- **role 定義**は Hub の設定ファイル (`roles.json`) に置く。各 role は既定購読と説明 (`description`) を持ち、説明は shim の `instructions` に差し込む。
  定義にない role の attach は拒否する (typo で黙って何も届かない事故を防ぐため)。
- **宛先の種類**: `to` は `mailbox` (その Mailbox だけ) / `role` (その role を持つ全 Mailbox) / `topic` (購読者全員)。
  `mailbox` と `role` 宛ては購読なしでも受け取る。
- reviewer が 1 人のうちは `HUB_ROLE=reviewer` だけ指定すれば Mailbox 名も `reviewer` になる。2 人目が要るときは `HUB_MAILBOX=rev-b` を足すだけでよい。
- role は「何を読むか」の分離にとどめ、**「受け取ったら自動で動く」意味は持たせない** (非目標の自律オーケストレーションに入るため)。
- トピック例: `user.message`, `agent.<mailbox>`。Event はトピックに流さない (§9-2)
- SEP の `arguments` (購読時のフィルタ引数) は導入しない。トピック名の一致のみ。必要になったら追加する。

### 3.6 配信とメッセージ種別 (R8)

- **ルーティング (`to` / topic) と種別 (`kind`) を分ける**。topic は「誰に届くか」、`kind` は「受け取った側がどう扱うか」を表す。
  topic に種別を混ぜる (`review.request` / `review.result` …) と組み合わせの数だけトピックが増えるため。
- `kind` は Hub が検証する**閉じた列挙**。当面は次の 3 つ。列挙外は 400 で拒否する。必要になったら追加する (候補: 交代時の `handoff`)。

| kind | 意味 |
|---|---|
| `request` | 作業または応答を期待する |
| `reply` | ある Message への返答。`replyTo` 必須 |
| `notice` | 情報のみ。応答不要 |

- hook 由来の Event も `kind` (`turn.end` など) を持つが、Event は Message とは別の型であり、名前空間は混ぜない。
- Claude Code へは Channels の `notifications/claude/channel` で push する。**Claude Code は通知を ack しない**ため、shim の ack が意味するのは「トランスポートに書けた」まで (§6 の検証結果)。
- 送り手の属性 (`id` / `kind` / `from` / `to` / `seq`) は Channels では `meta` に載せ、外側の `<channel>` タグの属性として渡す。本文は包まない (protocol.md §6)。`</channel>` で外側を閉じられないことは実機で確認済み (§6.1c)。polling 経路だけ `<hub-message>` で包む。
- 配信保証は Mailbox 単位の at-least-once + `seq` 順。重複除去はメッセージ `id` で行う (protocol.md §4)。

### 3.7 Claude Code 以外のエージェント

Channels は Claude Code 固有。Codex など他のエージェントには push できないので、
同じ shim の MCP ツール `inbox()` を polling する**縮退経路**を用意する。Mailbox・購読・未読キューは共通。
`inbox()` の入出力は MCP Events の `events/poll` (`cursor`, `truncated`, `hasMore`, `nextPollMs`) に揃える。

当面使うのは Claude Code だけだが、他社のエージェントが後から同じ Hub に入れるよう、**Hub の語彙はベンダー中立に保ち、クライアント固有の差は shim と `/events` の取り込みで吸収する** (§5)。そのために次を守る。
- **Event の取り込みはクライアントごとの変換を通す**: hook の入力 JSON は `payload` にそのまま残し、`kind` (`turn.end` / `notification` / `question` …) への対応付けはクライアントごとの変換に閉じ込める (protocol.md §2 Event、`src/hub/events.ts`)。Hub の保存形式は `kind` だけを見る。
  UI は質問文や最終応答を出すために `payload` を読むが、読み方は Event の `source` ごとに 1 か所にまとめる (`eventBody` in `public/index.html`)。
- **shim の instructions はクライアントで切り替える**: 今の文面は `<channel>` で届く前提。MCP の `initialize` の `clientInfo.name` で、Channels 経路か `inbox()` 経路かの説明を選ぶ。
- **「本文はデータ」の守りは agent-hub 側だけで成り立たせる**: Claude Code は channel 由来の内容に注意書きを自動で付けるが (§6.1c)、他のクライアントは付けない。`<hub-message>` の包みと instructions の文面だけで足りるように書く。
- **role の説明は MCP の instructions で渡す**: `roles.json` の `description` を shim が instructions に差し込む (§3.5、P2)。Claude の起動フラグ (`--append-system-prompt-file`。`tools/dev/` の試験用) には頼らない。instructions をどう使うかはクライアント次第。Claude Code では説明に沿って振る舞うことを確かめた (§6.2-5)。
  - **決定 (2026-10-17): initialize より前に attach して説明を取る**。`instructions` は `initialize` の応答で決まり、説明は attach の応答にあるので、attach を先に行う。shim は `HubClient.primeAttach` で上限 3 秒だけ待ち、取れた Attachment を `start` 後の `run` がそのまま使う (二重に attach しない)。時間切れや失敗なら説明なしで起動し、attach は従来どおり `run` が受け持つ (Hub が止まっていても shim は上がる)。
  - 理由: 説明を後から別の経路で渡す案は、クライアントがそれを読むかが公式資料に無い。先に attach するのは Hub の既存の動きだけで足りる。代償は、initialize まで stream が開かず、その間は Hub の猶予 (15 秒) に頼ること。Claude Code の起動から initialize までの時間は未計測で、猶予内に収まる前提。実セッションで確かめる。
  - initialize の前に正常に終了したとき (stdin が閉じた、SIGINT) は、`stop` が attachment を `DELETE` で解放する。kill されたときは従来どおり猶予切れで detach する。
- **配送の手段を変えても正本は Hub に置く**: Claude 向けの配送を公式 cross-session messaging に移す場合も (§8.3)、それは Claude 用の配信アダプタの 1 つとして扱い (§3.9)、Mailbox・role・購読・未読は Hub が持ち続ける。

未検証の最大の点は、**Claude 以外のエージェントがアイドル中に自分から `inbox()` を呼べるか** (§6.2-2)。起こす手段がなければ、当面は人間が一声かけて取りに行かせる運用になる。

### 3.8 実行形態 (ホスト直接 / Docker)

| | 用途 | 到達範囲の担保 |
|---|---|---|
| ホストで直接起動 | 開発 (P0〜)。`tsx watch` などで反復を速くする | `HUB_HOST=127.0.0.1` で bind |
| Docker (compose) | 常駐運用 (P2)。`restart: unless-stopped` で自動起動し、データは volume に置く | コンテナ内は `0.0.0.0` で listen し、公開を `ports: "127.0.0.1:7777:7777"` に限定する |

- Docker に載せるのは **Hub だけ**。shim は Claude Code が stdio で起動する子プロセス、hooks はホスト上のコマンドなので、どちらもホストで動く。
- Docker の `ports` を `7777:7777` と書くと全インターフェースに公開されるため、`127.0.0.1:` の前置は必須。
- トークンは起動時の自動生成ではなく `HUB_TOKEN` (`.env`) で固定し、ホスト側の shim/hooks と共有する。
- Hub はホストのファイル (hook ペイロードの `transcript_path` など) を読まない。`Stop` の入力には `last_assistant_message` が含まれるので、最終応答の表示には足りる。どちらの実行形態でも同じ挙動になる。
- Hub のコードは bind 先・ポート・トークン・データの保存先を環境変数で受け取るだけにし、どちらの形態でも動くようにする。

### 3.9 配信アダプタ (起こす / 中身を渡す)

エージェントへの配信を 2 つの働きに分け、クライアントや配送手段の違いは shim の**配信アダプタ**に閉じ込める。

| 働き | 内容 | 手段 |
|---|---|---|
| **起こす (ping)** | 「未読がある」とだけ伝え、エージェントのターンを始めさせる | Channels、公式 cross-session messaging (§8)、MCP Events の `events/stream` (§7)、MCP 標準の `notifications/resources/updated` など。アダプタごとに違う |
| **中身を渡す** | 未読の本文を送り手の属性と一緒に渡す | `inbox()` ツール (`<hub-message>` で包む)。全クライアント共通 |

- **最低限の約束は「中身は必ず `inbox()` で取れる」だけ**にする。起こし方はアダプタの付け足しで、配送手段が増えても変わっても Hub と `inbox()` は変えない。
- アダプタは 3 段階:
  1. **中身ごと届ける**: 起こすのと同時に本文も渡す。今の Channels (`meta` + 本文)。通知 1 回で済む。
  2. **起こすだけ**: 本文を載せない通知で起こし、エージェントに `inbox()` を呼ばせる。
  3. **起こせない**: エージェントが自分で `inbox()` を呼ぶか、人間が一声かける。
- **起こすだけの方式は「本文はデータ」の守りにも効く**: 外部由来の文章が通知としてエージェントに直接入らず、必ず `inbox()` の `<hub-message>` を通る。守る経路が 1 本になる (§3.7)。代わりに通知のたびにツール呼び出しが 1 回増えるので、Claude Code では 1 (Channels) を残し、ほかは 2 か 3 を使う。
- 今は Channels のコードを [src/shim/channel.ts](../src/shim/channel.ts) に閉じ込めてあり、これが最初のアダプタに当たる。差し替え口 (インターフェース) は **2 つ目の配信手段を足すときに作る**。1 つしかないうちに抽象化は作らない。
- 未確認: MCP 標準の `resources/subscribe` + `notifications/resources/updated` で未読を知らせたとき、クライアントがモデルのターンを始めるか。始めないクライアントが多いと見込まれる。

### 3.10 画像の添付

ブラウザで貼ったスクリーンショットを agent に届ける。画像は別に保存し、メッセージには id だけを載せる。

- **Message は開いた `meta` を持つ**。Hub が解釈するのは `meta.files` だけで、ほかのキーは通す。将来の機能はキーを足すだけで済む。`files` は送り手が付ける値なので、Hub が記録から書き直し、送り手の mime や size は使わない。
- **配信は 1 属性にまとめる** (`meta` = JSON 文字列)。Hub 付与の属性 (`id` / `from` など) と名前が重ならず、送り手が偽れない。
- **正規化してから保存する**: 長辺 1568px (`HUB_FILE_MAX_EDGE`) に収まるよう縮小し、EXIF の向きを反映して位置情報などを落とし、再エンコードする。デコードできないデータと SVG はここで落とす (Content-Type は信用しない)。agent が受け取るのは保存した画像なので、ブラウザで見える画像と一致する。上限より大きい画像をそのまま読ませると、トークンと時間の無駄になる。
- **id は内容の sha256 の先頭 32 桁**。同じ画像は同じ id になり、再送しても重複しない (冪等)。既存なら保存せずに返す。
- **記録を別に持つ**: `<id>.json` に寸法・mime・サイズ・元の寸法・持続扱いを書く。画像本体を先に書き、記録を最後に書く (記録があれば完成とみなす)。
- **揮発を前提にする**: 持続でない画像は `HUB_FILE_TTL_DAYS` (既定 7 日) で消す。持続扱いは消さない。画像は Hub の状態の一部なので、消えたときの表示 (「期限切れ」) も設計に含める。
- **参考にした慣習**: ブログやメディア管理で一般的な次の方法に倣った。(a) メディアごとに寸法・mime・サイズを本体と別の記録に持つ、(b) アップロード時に EXIF を落として向きを正規化する、(c) 内容ハッシュで重複を排除する、(d) 参照されなくなった一時メディアを期限で掃除する、(e) 表示用の派生物と原本を分ける。今回は原本を保持せず派生物だけを残す (将来、派生物を足す余地は残す)。
- **依存は sharp** (§5)。ブラウザ側の canvas での縮小は UI 経由の送信しか守れないので採らない。
- **shim は画像を取り、パスを渡す**: 配信の直前に `meta.files` の各画像を `GET /files/:id` で取り、`<HUB_FILES_DIR>/<mailbox>/<id>.<ext>` (既定は OS の一時フォルダの `agent-hub/`) に保存する。ファイル名は検証済みの id と ext だけで作り、Hub から来た文字列をパスに入れない。同じ id は再取得しない。書き込みは一時ファイルから rename する。agent は `Read` でそのパスを開いて画像を見る。
  - 配信は `meta` 属性に `path` を足した JSON になる。取得に失敗したら `path` の代わりに `error` を足す (`expired` は 404、ほかは `fetch_failed`)。メッセージは落とさない。
  - 取得は 15 秒でタイムアウトし、25MB を超えると失敗にする。Hub の値は書き換えず、配信用のコピーに足す。
  - 保存先は shim の起動時に、24 時間より古い画像を消す (起動時だけ。終了時には消さない)。
  - 保存先は作業フォルダの外なので、`Read` の許可が要る。`tools/dev/start-agent.ps1` は `--add-dir` で保存先を許可する。
  - shim は Hub の `files.ts` を import しない。`sharp` を shim に持ち込まないため。

### 3.11 依頼の台帳と整合点 (構想、未実装)

プロジェクト管理の芯を、**依頼 (request) 一件を単位にした台帳**と、境界ごとに必ず通る**整合点**に置く。
Hub に置くのはこの約束事だけで、配信アダプタ・UI・クライアントは差し替えられる枝葉とする (§1.1)。

発想は 2 つから借りた。
- vcp の C96 (thesis での OWL の読み直し)。OWL は開世界、agent-hub は閉世界。**持ち込むのは「関係と形を宣言し、閉じた集合で検査する」ことだけ**で、RDF / Turtle や開世界の推論は持ち込まない (重すぎる)。
- thesis の引用ブリッジ (cite-bridge。SKILL.md と構想メモ §2・§10.7・§16.6)。AI の書いた文と根拠のずれを、書く欄と導く欄・指紋・人の承認で止める仕組みで、構造が同じなので作法を写す。

| 引用ブリッジ | agent-hub |
|---|---|
| 引用一件 (原稿の一文 → 抜き書き → 原典の所在) | 依頼一件 (request → reply → 作業ツリーの変更) |
| (b) 実在の文献に言っていないことを言わせる | 報告が実際の変更とずれる (範囲外の変更、`CHANGED` の漏れ、報告の後の編集) |
| 書く欄 (逐語・要約・解釈) と、道具が書く `@` の欄 | エージェントが書く見出し (`GOAL` / `SCOPE` / `CHANGED` …) と、道具が導く欄 (実際の変更ファイル、範囲外、紐づけ、状態) |
| 承認は本文と根拠の指紋に結び付き、変われば要再確認 | 受け入れは reply と変更の指紋に結び付き、変われば要再確認 |
| 承認の HTML (逐語を先に、AI の候補を後に見せる) | ブラウザ UI の依頼のカード (導いた事実を先に、エージェントの報告を後に見せる) |
| 分類器は印を立てるだけ。人だけが上げる | Hub の規則は警告と要再確認への格下げだけ。受け入れと転送は人だけ |

- **単位は依頼一件**。request から reply までを `replyTo` でつなぎ、担当の role、`SCOPE`、状態を持つ。エージェントが交代しても、「いま開いている依頼」は Hub の上で決まる。
- **書く欄と導く欄を分ける**。エージェントが書くのは判断の欄 (見出し付きの本文) だけ。導く欄は決定的な処理が書き、エージェントは書けない。`from` を Hub が付けるのと同じ原則の延長。
  - Hub はホストのファイルを読まないので (§3.8)、変更の事実 (`git diff --name-only`、HEAD) を導くのはホスト側の決定的な処理になる。shim か hook のどちらにするかは未決 (下記)。
- **整合点は 2 段**。引用ブリッジの ERROR / NOTE と同じ分け方にする。
  - 構造の崩れ (必須の見出しがない、存在しない依頼への reply、宣言にない相手と `kind`) は、機械で決まるので 400 で返す。エラーは送ったエージェントに返り、書き直すだけで済む (宣言を読ませなくてよい)。
  - 確認待ち (範囲外の変更、指紋の食い違い) は受理し、UI に警告する。判断は人に渡す。
- **状態と指紋**。依頼の状態は 未完了 / 報告済 / 受け入れ済 / 差し戻し / 差し戻し後に直された の 5 つ。受け入れは reply の本文と変更の指紋を残し、どちらかが変われば要再確認に戻る。
  報告の後もエージェントが編集を続けることは実際に起きた (2026-10-16、leader / deployer の試験)。指紋はこれを機械で拾う。
- **役割と持ち主**。道具 (Hub・shim) が導いて検査する、deployer が書く、leader (model) が確かめる、人が受け入れる。誰が確かめ、誰が受け入れたか (human / model) を記録する。エージェントは自分の出した依頼を受け入れない。
- **判断の画面は自前の HTML**。依頼のカードに、導いた事実 (変更ファイル、範囲外、指紋の状態) を先に、エージェントの報告を後に並べ、報告に判断が引っ張られないようにする。
  UI は表示した時点の指紋を受け入れの要求に付け、Hub は今の指紋と合わなければ拒む (見ていないものへの受け入れを防ぐ)。
- **規則は下げる方向だけ**。Hub の決定的な規則が選べるのは「何もしない / 警告する / 要再確認に下げる」だけ。上げるのは人だけ。新しい検査は警告だけで始め、人の判断との一致を見てから 400 に上げる。
- **網羅の範囲を正直に出す**。「確認待ち 0」は Hub を通った依頼についての状態で、Hub の外でした作業は含まない。
- **本文は書き換えない**。検査は受理するかどうかを決め、導く欄を足すだけ。「要約・加工しない」に反しない。
- **宣言は人が管理する**。置き場所は P2 の `roles.json` を広げる (role ごとに送ってよい相手と `kind`、必須の見出し)。ブラウザで見て編集できるようにし、エージェントには自分に関係する部分だけを instructions で渡す (§3.7)。
- **実装の中身は宣言しない**。実装はコード・テスト・docs がすでに定義で、閉世界の検査はテストと型チェックが担っている。別に宣言を持つと正本が 2 つになり、すぐ古くなる。宣言の対象は「やり取りの形」と「依頼ごとの `SCOPE`」までにする。
- **LLM に HTML を書かせない**。エージェントは CLI で決まった形のテキストを書き、Hub が形を知っているので UI が描ける。描き方は後から変えられる。

未決:
1. **決定 (2026-10-17、ユーザー): hook で導く。`Stop` の command hook だけ** (`PostToolUse(Edit|Write)` は作らない)。`tools/hooks/post-event.mjs` が入力 JSON に `agent_hub_git: { head, changed, untracked }` を 1 つ足して `POST /events` に送る。Hub は git を実行せず、形を検査して Event の `changes` に載せるだけ (protocol.md の Event)。
   - `head` は HEAD の full sha。`changed` は `git diff --name-only HEAD`、`untracked` は `git ls-files --others --exclude-standard` (どちらもルートからの相対パス、`-z` で区切る)。
   - 5 秒で打ち切り、どの失敗でも exit 0。取れなければ入力をそのまま送る。HTTP hook の `Stop` と併記すると `turn.end` が 2 件になるので、置き換えて使う (`tools/hooks/settings.command.json`)。
   - shim で `post_message` の時点に diff を取る案は採らない (送るたびに作業フォルダを読むことになり、状態を持たない計算もここでは要らない)。
2. 指紋の対象。`SCOPE` の範囲の diff か、作業ツリー全体の diff か、HEAD か。複数のエージェントが同じ作業ツリーを使う間は、他者の変更で指紋が揺れる (§9-6 の worktree と合わせて決める)。
3. いつ作るか。§1.1 の基準 2 に従い、宣言の語彙は leader / deployer の運用で毎回使っている見出しから始め、先に語彙を設計しない。

### 3.12 ドキュメントの作法と照らし方 (構想、2026-10-17)

AI との共同開発で効果があったのは、結局ドキュメントの作法 (いつ・何を読み・何を足すか) だった。これは §1.1 の「約束事」の中心で、Hub はそれを照らす基板になれる。
ただし書面の決まりは、守ったかを照らすものがないと、いずれ乱れる。そこで作法を表にまとめ、照らす仕組みを 3 層に分ける。

**作法の表** (地図は CLAUDE.md の「文書の地図」。起動時に全部は読まず、節を Grep してから Read する)

| 時点 | 読む | 足す | 今の担い手 |
|---|---|---|---|
| セッション開始 | 文書の地図 | — | CLAUDE.md (自動で読み込まれる) |
| leader が依頼を組む | 関係する節 (§9 の決定、§2 の非目標) | 仕様に触れるなら、SCOPE に docs、DONE WHEN に docs の更新 | leader.md |
| deployer が実装する前 | §6 の検証の記録 | 未検証なら公式資料で確かめ、§6 に足す | CLAUDE.md |
| deployer の報告 | — | NOTES の行 (下の行き先に振り分ける) | deployer standard の形式 |
| leader が確かめる | 変更に関係する節 | — (`git diff --name-only` に docs があるか、内容が実装と合うかを見る) | leader.md |
| 決定した | — | §9 の該当項目に「決定 (日付)」と理由 | 慣習 |
| 区切り (commit・項目の完了) | — | roadmap のチェック、engram、MEMORY | clear-timing skill、全体の CLAUDE.md |

- **NOTES の行き先**: 確かめた事実 (Channels・hook の実挙動など) は §6、決めたことは §9 の決定、決められなかったことは §9 の未決、後でやることは roadmap。
- **§9 の書き方**: 項目の問いを残したまま、下に「決定 (YYYY-MM-DD)」と理由を足す。消さない。
- 今はこの表の担い手が CLAUDE.md・leader.md・deployer.md・全体の CLAUDE.md・skill に散っている。各ファイルはこの表を指すだけにしていく。

**照らし方の 3 層**

1. **決定的な検査 (AI なし)**。乱れの大半はここで拾う。ホスト側のスクリプト (例 `npm run docs:check`) にする。Hub は作業ツリーを読まないので (§3.8)、動かすのは leader の確認の手順か Stop hook で、結果は notice か Event として Hub に送り、UI に並べる。
   - 地図のずれ: CLAUDE.md の地図の § が見出しとして実在するか。地図にない見出しが増えていないか。
   - 宣言と表のずれ: `app.ts` のルートが protocol.md §3 の表に全部あるか。`EVENT_KINDS` / `MESSAGE_KINDS` が protocol.md と一致するか。
   - 追記漏れ: deployer の `CHANGED` (DCP 形式なので Hub でも読める) に `src/` があって `docs/` がない。
   - 書き方の崩れ: §9 の「決定」に日付がない。
   引用ブリッジの「本文が変わったら要再確認に戻す」に当たるのは、コードの宣言と docs の表の突き合わせ。
2. **軽量ジャッジ** (thesis の Jev のようなもの)。層 1 で決まらないもの、例えば「この NOTES の行は事実か・決定か・どちらでもないか」の振り分けだけを任せる。
3. **leader と人**。docs の記述が実装の意味と合っているか。微妙なずれはここに残る。

**軽量ジャッジに要るもの** (引用ブリッジの評価、2026-10-15 から。あからさまな改変は 20/20 拾い、微妙なものは 1/12、実際の誤読は 2/7 だった):
- 問いを 1 つに絞り、閉じた順序つきのラベルで答えさせる (例: 一致 < 古い < 矛盾)。記録より重いと判断したときだけ旗を立てる。
- 入力は決定的に切り出して渡す (地図と変更ファイルから、比べる組を作る)。ジャッジには探させない。
- 評価用の材料は運用の中で先に貯める (層 1 が逃し、leader や人が見つけたずれ)。誤りを見つけた後に作った例で測ると、成績が水増しになる。
- 警告だけにする。位置づけは「あからさまなずれの番犬」。

**進め方**: 層 1 から作る。層 2 は、層 1 が逃したずれが貯まってから、作る価値を測る。材料がないうちは、何を用意すれば適切に動くかが決まらないので作らない (§1.1 の基準 2)。

### 3.13 セッションの寿命と文脈 (構想、2026-10-17)

**起動と停止をどこが受け持つか**

| どこから | 可否 | 理由 |
|---|---|---|
| Hub | 不可 | Docker に載せる前提で、ホストのプロセスを起動できない (§3.8) |
| shim | 非推奨 | MCP にクライアントを終わらせる手段がない。親プロセスの kill は作法の外で、Windows では親の特定も怪しい (§3.4) |
| ホスト側の監督役 | 可 | `turn.end` (§3.4) の後に一定時間動きがなければ止め、未読が来たら起動して attach させる。Mailbox が未読と購読を持つので、落としても依頼は失われない (R5 / R6) |

- **壁**: Channels は対話セッションが必須で、起動のたびに警告ダイアログが出る (§6.1)。無人で起動するなら `claude -p` と `inbox()` (P2) の経路になる。
- **方針との境目**: 人が Send を押した依頼で起動するのは、運搬の自動化の範囲。エージェント間の request で別のエージェントが自動で起動するのは、自律オーケストレーション (§2 の非目標) に入る。入れるなら、配信ルールの opt-in と同じ扱いにする。
- **channel の本文はコマンドにならない**: `/clear` などを送っても、本文として届くだけ (§6.1h)。文脈を捨てたいときは、セッションを終了して同じ Mailbox で起動し直す (交代、§3.3)。

**文脈とキャッシュ**

- アイドル中のセッションはトークンを使わない。prompt cache は数分 (設定によって 1 時間) で切れ、切れた後の再開は、生かしておいても `--resume` でも、全履歴を読み直す費用はほぼ同じ。compaction も接頭部が変わってキャッシュが切れる。落とすかどうかは費用ではなく、**文脈を持ち越すかどうか**で決める。
- 世の中のオーケストレーターの型 (2026-10 の調査): 委任で lead を薄く保つ (サブエージェントは新しい文脈で動き、要約だけ返す)、状態をファイルに書き出して compaction や再起動の後に読み直す、自動 compaction、1 回ごとに新しいセッションを起動するループ。共通する芯は**文脈は使い捨て、状態は外に置く**。
  頭の中にしかない状態は compaction で消える (agent teams の lead が compaction でチームの存在を忘れた報告がある。2.1.34)。
- 役ごとの目安: deployer は依頼ごとに新規でよい (依頼文が `GOAL` / `SCOPE` / `SPEC` / `DONE WHEN` で自己完結している)。leader は長く生かすか resume し、区切りで `/clear`。持ち越したい知見は engram か、将来の `handoff` (§3.6) に移す。
- **欠けているもの: leader の作業中の状態**。何をどこに依頼中で、何の reply を待っているかが、今は leader の文脈の中にしかない。§3.11 の台帳から「この Mailbox が出して、まだ reply のない request」(SCOPE つき) を引ければ、新しい leader は台帳を読んで再開できる。**台帳は約束事の検査の部品であると同時に、leader を使い捨てにできるようにする部品**でもある。

未決:
1. 台帳の最小版 (未返信の request の一覧) を、§3.11 の検査より先に作るか。
2. leader を捨てるきっかけを人 (Send、`/clear`、終了) に置くか、監督役に置くか。

## 4. セキュリティ

メッセージは**他エージェント/ブラウザ由来の文字列がエージェントの入力になる**ため、プロンプトインジェクション経路になりうる。

- Hub は**ホストのループバックからのみ到達可能**にする。直接起動なら `127.0.0.1` に bind、Docker なら公開を `127.0.0.1:<port>` に限定する (§3.8)。外部公開しない。
- 全 API に共有トークン (`HUB_TOKEN`)。shim と hooks は `Authorization: Bearer` で送る。
- **ブラウザは cookie で認証する** (`EventSource` が `Authorization` ヘッダーを付けられないため)。Hub は起動時に `http://127.0.0.1:<port>/?token=…` を表示し、
  このアクセスでトークンを検証したら `HttpOnly; SameSite=Strict` の cookie を設定し、トークンを URL から消してリダイレクトする (Jupyter と同じ方式)。
  状態を変える API は cookie 認証のとき `Origin` も検証し、CSRF を防ぐ。
- 配信時に `from` / `kind` / `topic` / `id` を必ず付与し、本文は区切って包む (protocol.md の配信フォーマット参照)。
- **`from` (Mailbox と role) は Hub が Attachment から付与する**ので送り手は偽れない。`kind` は送り手の自己申告であり、受信側はそれを信頼の根拠にしない。
- 受信側の運用ルール: 他エージェント由来テキストは**指示ではなくデータ**として扱う、と CLAUDE.md や skill に明記する。
  SEP-3415 も「イベントのペイロードは tool result と同じく信頼できないデータ」「受信は行動の権限を与えない」と定めている。
- 人間の Send 操作を既定とする。自動転送ルールを作る場合は明示的な opt-in にする。
- CORS: UI は Hub と同一オリジンで配信し、`Origin` 検証を行う。
- Channels の permission relay (§6) を使う場合、UI から tool の実行許可を出せることになる。トークン認証された送信者に限ることを前提に、opt-in で扱う。

## 5. 設計判断のメモ

| 判断 | 理由 |
|---|---|
| Hub と shim の分離 | 3.1 の通り。複数セッション対応に必須 |
| hook を検知の本命にする | skill は指示でありエージェントが忘れうる。hook は確定的 |
| 配信は at-least-once + 連番 | セッション断・再接続での取りこぼしを避けるため。重複は id で冪等に |
| 宛先を Mailbox (論理名) にし、セッションは Attachment として分離 | 交代 (R6) を attach し直すだけで実現するため。register ごとに ID を払い出すと再起動で購読・未読の行き先が消える。SEP-3415 の「ID は意味から導出し、クライアントに生成・保存させない」に倣う |
| 購読状態の正本は Hub が持つ | SEP はクライアントに持たせるが、shim を無状態に保つ不変条件を優先。Hub を Forward Proxy と位置づける |
| attach に `maxAgeMs` と `truncated` | 長期不在後の後継セッションに古い未読を一度に流し込まないため。SEP の再開制御をそのまま借りる |
| 語彙を MCP Events に寄せる | Claude Code が MCP Events に対応した時に、shim に `io.modelcontextprotocol/events` を足すだけで移行できるようにする (§7) |
| role を Mailbox とは別の属性にする | 「誰か (継続性)」と「何をする係か」は独立に変わる。同じ role を複数の Mailbox が持てるし、Mailbox の role を変えることもある。1 人のうちは Mailbox 名の既定を role 名にして手間を増やさない |
| role の宣言を明示的な購読とみなす | R4 (購読は明示的に) を保ったまま、role ごとの購読を毎回 `subscribe` しなくて済むようにする |
| `kind` を topic と別のフィールドにし、閉じた列挙にする | ルーティングと扱い方を独立させ、トピックの組み合わせ爆発を避ける。列挙を閉じるのは、受信側と UI が機械的に分岐できるようにするため |
| ブラウザ認証は cookie | ローカル開発だけが対象なので大きな差はないが、トークンが URL・履歴・ログに残り続けない方を選んだ |
| Channels では送り手の属性を `meta` に一本化し、`<hub-message>` は polling 経路だけにする | Claude Code が `</channel>` をエスケープし、本文から外側のタグを閉じられないことを実機で確認した (§6.1c)。二重包みと独自エスケープを減らせる。記載のない挙動なので、shim 側でも `</channel>` をエスケープする |
| HTTP は Hono (`@hono/node-server`) | 同じ DockerFiles 配下の cairn と揃える。`app.request()` でネットワークなしにテストでき、SSE ヘルパー (`streamSSE`) もある |
| shim は MCP TypeScript SDK 1.x に固定 | SDK 2.x はプロトコル `2026-07-28` を交渉し、その channel サーバーは v2 ランタイムで登録されない (§6.1)。1.32 系の最新対応は `2025-11-25` |
| hook は HTTP hook で Hub に直接送る | スクリプトが不要になり、Windows のシェル差異 (Git Bash / PowerShell) を避けられる。トークンと Mailbox 名はヘッダーの環境変数展開で渡せる |
| Docker に載せるのは Hub だけ、P0 はホストで直接起動 | shim/hooks は構造上ホストで動く。常駐 (Windows での daemon 化) を compose の restart で解決できるが、開発中は反復速度を優先する |
| P0 はフレームワークなし UI | 検証を最短にするため。必要になってから導入 |
| 永続化は JSONL から始める | 実装が最小で、人間が `tail` で追える |
| 配信を「起こす」と「中身を渡す」に分け、中身は常に `inbox()` で取れるようにする | 起こす手段 (Channels、cross-session messaging、MCP Events、標準の通知) は増えたり変わったりするが、中身の受け渡しを 1 本にしておけば Hub は変えずに済む。外部由来の本文が通る経路も 1 本になる (§3.9) |
| Hub の語彙はベンダー中立にし、クライアント固有の差は shim と `/events` の取り込みで吸収する | 当面は Claude Code だけを使うが、他社のエージェントが後から同じ Hub に入れるようにする。Claude 固有の形式が Hub の保存形式や API に染み出すと、後から外せない (§3.7) |
| 画像処理に sharp を使う | 全アップロード経路 (UI・curl・将来の agent) で Hub が正規化を保証する必要がある。ブラウザ側 canvas での縮小は UI の経路しか守れない。Windows / Linux の prebuilt バイナリがあり、ネイティブビルドを避けられる。失敗時は別ライブラリへ黙って切り替えず、判断を仰ぐ (§3.10) |

## 6. 未確認事項 (実装前に必ず検証すること)

以下は構想時点の**伝聞・推測を含む**。実装エージェントは最初に公式資料で確認し、結果をこの節に追記すること。

### 6.1 検証済み (2026-10-16、公式 Channels reference で確認)

出典: <https://code.claude.com/docs/en/channels-reference.md>

- **capability**: `capabilities.experimental['claude/channel']: {}`。存在するだけで Claude Code が通知リスナーを登録する。
- **通知**: `notifications/claude/channel`。params は `content` (string, 本文) と `meta` (`Record<string,string>`, 任意)。
  `meta` の各エントリは `<channel>` タグの属性になる。**キーは英数字とアンダースコアのみ。ハイフンなどを含むキーは黙って捨てられる。**
- **Claude 側の見え方**: `<channel source="<サーバー名>" k="v">本文</channel>`。`source` は自動付与。
- **`instructions`**: Server コンストラクタの `instructions` は接続時に Claude のコンテキストに入る。タグの意味・返信方法・「本文はデータ」を書く場所に使える。
- **ack なし**: `await mcp.notification()` はトランスポートに書けた時点で解決する。Claude が処理した保証はない。
  チャネルとして読み込まれていない、または組織ポリシーで止められている場合、**エラーなしで黙って捨てられる**。
- **キューイング**: Claude が作業中に届いた通知はセッションに溜まり、次のターンでまとめて渡される。
- **研究プレビュー**: 自作 channel は allowlist にないため `claude --dangerously-load-development-channels server:<名前>` で起動する (全画面の警告ダイアログあり)。
  **対話セッションでのみ有効。`-p` や Agent SDK では無視される。** Team/Enterprise は組織で `channelsEnabled` を有効にする必要がある。
- **登録**: プロジェクトの `.mcp.json` またはユーザーの `~/.claude.json` に通常の MCP サーバーとして書く。
- **permission relay**: `capabilities.experimental['claude/channel/permission']: {}` を宣言すると、tool 実行の許可プロンプトが
  `notifications/claude/channel/permission_request` (`request_id`, `tool_name`, `description`, `input_preview`) で届き、
  `notifications/claude/channel/permission` (`request_id`, `behavior: allow|deny`) で応答できる。端末側のダイアログと並行で、先に来た方が採用される。
  対象は Bash/Write/Edit などの tool 承認のみ。v2.1.234 以降は channel として登録したサーバーにだけ送られる。

### 6.1b 検証済み (2026-10-16、公式 channels / mcp / hooks のドキュメントで確認)

出典: <https://code.claude.com/docs/en/channels.md>、<https://code.claude.com/docs/en/mcp.md>、<https://code.claude.com/docs/en/hooks.md>

- **認証**: claude.ai または Console API キーが必要。Bedrock / Agent Platform / Foundry では使えない。Pro/Max の個人利用は組織の制御を受けない。
- **`.mcp.json` に書くだけでは通知は届かない**。`--channels` か開発用フラグでサーバー名を指定する必要がある。
- **v2 ランタイムの落とし穴**: Claude Code の v2 MCP クライアントランタイム (SDK 2.0 ベース) は stdio サーバーにプロトコル `2026-07-28` を打診する。
  **それで交渉した channel サーバーは channel として登録されない**。channel サーバーは `2026-07-28` 非対応の SDK 1.x を使う (1.32.1 の最新は `2025-11-25`) か、
  利用者側で `MCP_PROTOCOL_NEGOTIATION=legacy` を設定する。
- **`.mcp.json` の環境変数展開**: `${VAR}` と `${VAR:-default}` が `command` / `args` / `env` / `url` / `headers` で効く。未定義で既定なしは文字列のまま残り、警告が出る。
  `CLAUDE_PROJECT_DIR` は stdio サーバーの環境には設定されるが、Claude Code 自身の環境にはないため、`args` では `${CLAUDE_PROJECT_DIR:-.}` と書く。
- **`session_id` の受け渡し**: hook には JSON 入力の `session_id` として届く。`CLAUDE_SESSION_ID` のような環境変数はなく、MCP サーバーへ渡す仕組みも記載がない (§3.4 の対応付け方針はこれを前提にする)。
- **hook の共通入力**: `session_id`, `prompt_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `permission_mode`, `effort`, `hook_event_name`。サブエージェント内では `agent_id` / `agent_type` が付く。
  - `Stop`: `stop_hook_active`, `last_assistant_message`, `background_tasks`, `session_crons`
  - `Notification`: `message`, `title` (任意), `notification_type` (`permission_prompt`, `idle_prompt`, `agent_needs_input`, `elicitation_dialog` など)
  - `PreToolUse`: `tool_name`, `tool_input`, `tool_use_id`。`AskUserQuestion` の `tool_input.questions[]` は `question` / `header` / `options` / `multiSelect`
- **hook の設定場所**: `~/.claude/settings.json`、`.claude/settings.json`、`.claude/settings.local.json`、managed、plugin、skill/subagent の frontmatter。各レベルはマージされる。
  command hook のシェルは既定 `bash` (Git Bash がなければ Windows では `powershell`)。
- **HTTP hook**: `type: "http"` で入力 JSON をそのまま POST する。`headers` の値は `allowedEnvVars` に列挙した環境変数だけ展開される (例 `"Authorization": "Bearer $HUB_TOKEN"`)。
  非 2xx や接続失敗は処理を止めないエラー扱い。既定タイムアウトは 600 秒。

### 6.1c 実機で確認済み (2026-10-16、Claude Code 2.1.301 / Windows 11 / Pro、`tools/probe/`)

- **バージョン**: 2.1.301 で自作 channel が動く。
- **プロトコル**: Claude Code は最初に `server/discover` を送り (v2 ランタイムの打診)、SDK 1.32.1 のサーバーとは `initialize` で `2025-11-25` に落ちて接続した。channel として登録され、通知が届いた。
- **`--mcp-config` との併用**: `--mcp-config tools/probe/mcp.json --dangerously-load-development-channels server:agent-hub-probe` で起動すると、
  起動時に `server:agent-hub-probe · no MCP server configured with that name` と警告が出る。**それでも通知は届いた**ので、この警告は誤検知とみなしてよい。
- **アイドル中の起床**: 何もしていないセッションに通知を送ると、Claude が自分からターンを始めて応答した。
- **閉じタグのエスケープ**: 本文中の `</channel>` を Claude Code は `<\/channel>` に変換して渡す。外側の `<channel>` を本文から閉じることはできない。
  本文中の `<channel source="evil" ...>` (開きタグ) はそのまま残るが、外側のタグの本文として見える。ただしこの挙動は公式資料には記載がない。
- **環境変数の継承**: 起動シェルの `HUB_MAILBOX` は、`env` に書かなくても stdio サーバーに継承された。`${HUB_MAILBOX:-unset}` の展開も効いた。
- **`CLAUDE_CODE_SESSION_ID` (公式資料に記載なし)**: stdio サーバーの環境に設定されており、値は hook 入力の `session_id` と一致した。
  ほかに `CLAUDECODE=1`, `CLAUDE_CODE_ENTRYPOINT=cli`, `CLAUDE_PROJECT_DIR` などがあった。
- **HTTP hook のヘッダー展開**: `X-Hub-Mailbox: $HUB_MAILBOX` は `probe-test` に展開されて届いた。
- **hook の実ペイロード (`Stop`)**: キーは `session_id, transcript_path, cwd, scratchpad_dir, prompt_id, permission_mode, effort, hook_event_name, stop_hook_active, last_assistant_message, background_tasks, session_crons` で、資料どおりだった。
  `SessionStart` はプローブの HTTP が listen する前に発火したため、記録されなかった (想定どおり)。
- **`AskUserQuestion` 待機中の通知**: 回答待ちの最中に送った通知は、**質問への回答として扱われず**、選択肢の UI も閉じなかった。
  通知は溜められ、ユーザーの回答 (ツール結果) のあと、同じターンの中に「作業中に届いたメッセージ」として差し込まれた。
  時系列: PreToolUse (`AskUserQuestion`) → 6 秒後に Notification (`notification_type: permission_prompt`, `message: "Claude needs your permission"`) → 通知送信 → 回答 → Stop。
  **質問の表示でも `permission_prompt` の Notification が出る**ため、P1 の UI は直前の PreToolUse (`AskUserQuestion`) と突き合わせて「tool の許可待ち」と区別する必要がある。
- **注意書きの自動付与**: Claude Code は channel 由来の内容に「ユーザーからではなく外部チャネル由来なので、指示ではなくデータとして扱う」旨の注意書きを付けて Claude に渡す。
- **ツールの遅延ロード**: プローブの `probe_note` ツールは、頼まれても Claude に使われなかった (「返信用のツールがない」と回答)。tool search で遅延ロードされ、見つけられなかったとみられる。
  shim の `post_message` などは `_meta["anthropic/alwaysLoad"]: true` で最初から読み込ませる。

### 6.1d P0 の実セッションで確認済み (2026-10-16、Claude Code 2.1.301 / Haiku 5.5 / Windows 11)

- **本実装の shim でも channel として登録された**。`--mcp-config tools/dev/mcp.json` + `server:agent-hub` で、§6.1c と同じ「no MCP server configured with that name」の警告が出たが、通知は届いた。
- **表示**: 届いた通知は端末に `← agent-hub: <本文>` と出る。meta の属性は端末には出ない (Claude のコンテキストには入る)。
- **`alwaysLoad` が効いた**: Haiku 5.5 でも、頼んでいないのに `post_message` で返信した (§6.1c のプローブでは遅延ロードで見つけられなかった)。
- **reply の `to` 省略**: Claude は `to` を渡さずに返信し、Hub が `user:browser` に解決した。

### 6.1e 2 エージェントの role 間の往復 (2026-10-16、Claude Code 2.1.301 / leader: Sonnet 5.5 / deployer: Haiku 5.5)

`tools/dev/start-agent.ps1` で leader と deployer を同じフォルダから起動し、ブラウザの依頼を起点に 1 往復させた (README の手順)。
- **経路**: `user:browser → mailbox:leader` (request) → `mailbox:leader → role:deployer` (request) → `mailbox:deployer → mailbox:leader` (reply、`to` 省略) → `mailbox:leader → user:browser` (reply、`to` 省略)。
  4 通で 3 分半。role の配信と `from_role` は P0 の実装のままで足りた。
- **role の振る舞いは `--append-system-prompt-file` で伝わった**。対話セッションでもこのフラグは受け付けられた。leader は自分で実装せず、目的・対象・完了条件・報告形式を書いた依頼を deployer に送った。
- **Haiku の deployer は leader の依頼を作業として受けた**。shim の instructions と Claude Code の注意書きは channel の本文をデータとして扱うよう求めるが、ユーザーが system prompt で与えた role の説明 (「from_role=leader の request は承認済みの作業依頼」) が優先された。
- **受領確認の往復は起きなかった**。role の説明に「reply と notice には返信しない」と書いたため。
- **leader は依頼を送った後でターンを終え、deployer の reply で起床した** (§6.1c のアイドル中の起床と同じ)。
- **注意**: leader の依頼には「実際に Hub を起動してメッセージを流して確認」という例があった。deployer はこれをせず、fetch / EventSource を差し替えて確認したが、
  稼働中の Hub に試験メッセージを流すと自分たちを起こしうる。試験用 Hub は別の `HUB_PORT` / `HUB_DATA_DIR` で立てるよう deployer の role の説明に追記した。

### 6.1f `--settings <file>` でモデル名が誤認される (2026-10-16、Claude Code 2.1.301 / Windows 11)

- `start-agent.ps1 -Role leader` で output style 用に `--settings tools/dev/settings/leader.json` (中身は `{"outputStyle":"Concise"}` だけ) を渡すと、
  起動時の表示が `--settings with high effort` になり、`Model "--settings" isn't recognized · context assumed to be 200k tokens` と警告された。
- スクリプトが渡す引数は正しかった (`claude` を引数を表示する関数に差し替えて確認。leader では `--model` 自体を渡していない)。
  中継の `claude.ps1` / `claude.cmd` も `$args` / `%*` をそのまま渡しているだけなので、Claude Code 側の引数の扱いとみられる。原因は特定していない。
- 対処: `--settings` を渡すのをやめ、leader のターミナル応答を簡潔にする指示は role の説明 (`--append-system-prompt-file`) に書いた。
  output style を `/output-style` で切り替えると `.claude/settings.local.json` に保存され、同じフォルダの全セッション (deployer も) に効くので使わない。

### 6.1g 公式 cross-session messaging の受信口 (§8.3 の検証 1・2、2026-10-16、Claude Code 2.1.301 / Windows 11)

- **検証 1: shim に受信口の情報は渡る (公式資料に記載なし)**。Claude Code が stdio の MCP サーバーとして起動したプローブ (`logs/probe.jsonl` の 07:50 の startup) の環境に、
  `CLAUDE_CODE_MESSAGING_SOCKET` (`\\.\pipe\LOCAL\cc-msg…` の名前付きパイプ) と `CLAUDE_CODE_MESSAGING_TOKEN` があった。公式資料は hook と Bash に渡すとしか書いていない。
- **検証 2: 投函の形式が公開されておらず、試せない**。公式資料にあるのは 1 行目の `{"type":"auth","token":"…"}` だけで、その後に送るメッセージ本体の形式は cross-session messaging・env-vars・hooks のどの資料にもない。
  自分のセッションの受信口に auth 行と推測した形式 (`{"type":"message","text":"…"}`) を送ったところ、応答もエラーもなく、メッセージも届かなかった (黙って捨てられた)。これ以上の推測は非公開の仕様の解析になるので止めた。
  **追記 (再調査)**: open-agent-bridge の README は、auth 行の後に `{"type":"user","message":{"role":"user","content":"…"}}` を送るとしている (公式には載っていない。Windows での動作は書かれていない)。未確認。
- **含意**: 配送を移すと、記載のない環境変数 (検証 1) と非公開の形式 (検証 2) の 2 つに依存することになる。Channels (研究プレビュー、開発用フラグ) より安定とは言えない。形式が公開されるまでは Channels のままが妥当 (§9-5)。

### 6.1h channel の本文のスラッシュコマンド (2026-10-17、ユーザーの実使用で観察。バージョンは記録していない)

- ブラウザから `/clear` などを本文として送っても、コマンドとしては実行されず、本文としてモデルに届いた。
- 理由: スラッシュコマンドは CLI が入力欄で解釈する。channel の通知は入力欄を通らず、モデルの文脈に `<channel>` 付きで直接入る。外部の本文でコマンドが動かないのは、「本文はデータ」(protocol.md §6) の守りとも一致する。
- 自作のコマンドや skill は、モデルが Skill ツールで呼ぶことはありうる (モデルの判断で、確実ではない)。`/clear` や `/compact` などの組み込みは呼べない。代わりの手段は §3.13。

### 6.1i command hook と git の事実 (2026-10-17、公式 hooks のドキュメントで確認)

出典: <https://code.claude.com/docs/en/hooks.md>
- **command hook の入力**: stdin に JSON が届く (HTTP hook は POST 本文)。共通入力は §6.1b の欄。
- **`timeout`**: 秒。command hook の既定は 600 秒。`tools/hooks/settings.command.json` は 6 秒で、スクリプト自身の 5 秒の上限が先に効く。
- **`${CLAUDE_PROJECT_DIR}`**: セッションを起動したプロジェクトのルート。worktree に入っても元のルートを指す。
- **exec 形式**: `"command": "node", "args": [...]` と書くと、シェルを通さずに直接起動する。Windows の既定シェル (Git Bash / PowerShell) の差を避けられる。
- **Stop の入力**: `last_assistant_message` は公式で確認。ただし Stop の全欄は取得が途中で切れたので未確認。スクリプトが読むのは §6.1b で実機確認した `session_id` / `cwd` だけ。
- **実機の検証の範囲**: 別インスタンスの Hub (稼働中の Hub とは別のポートと保存先) に対して、`node tools/hooks/post-event.mjs` へ Stop の入力を流して確かめた。
- **実機 (2026-10-17、Claude Code の leader / deployer セッション)**: `.claude/settings.local.json` の `Stop` を `settings.command.json` の形に置き換えたところ、exec 形式・`${CLAUDE_PROJECT_DIR}` の展開・stdin の受け渡しが働き、`turn.end` 6 件すべてに `changes` が付いた。HTTP の `Stop` を外したので、`turn.end` は 1 ターン 1 件だった。
- **許可待ちとモード**: `permission_mode` が `auto` のセッションでは `permission_prompt` の Notification が出ない (許可を求めないため)。既定のモードの deployer では、ファイル作成の許可待ちで `permission` が出た。

### 6.2 未検証

1. **Windows 固有**: パス表記、改行コード。daemon の常駐は Docker (§3.8) で解決する見込み。
   Docker Desktop (WSL2) で `ports: "127.0.0.1:7777:7777"` がホストのループバックだけに公開されることを確認する。
2. **Codex 側の MCP 対応状況**: `inbox()` polling が使えるか。
3. **代替の配信経路: plugin の monitor**。Hookdeck の mcp-events-bridge は Channels を使わず、plugin の monitor で poll クライアントを動かし、1 行出力を通知として Claude に届けている (Claude Code 2.1.275 以降)。開発用フラグと警告ダイアログが不要になる可能性がある。アイドル中のセッションを起こせるかを含めて比較する。
4. **Channels の `meta` 属性値のエスケープ (未検証)**: `toChannelParams` は `meta` の JSON 文字列を `"` `<` `>` `&` を変換せずに渡す (`escapeAttr` は polling 経路だけ)。公式資料 (§6.1) にも §6.1c の実機確認にも、属性値のエスケープの記載はない。確認済みなのは本文の `</channel>` だけ (§6.1c)。
   **暫定の制限**: 確認するまで、Channels に載せる `meta` は `files` の既知のキー (`id` `mime` `size` `width` `height` `path` `error`) だけにする (`channelMeta` in `src/shared/format.ts`)。ほかのキーと送り手の `meta` は `inbox()` (`<hub-message>`) からだけ読める。値は変換しない。確認できたら制限を外す。
   Claude Code が属性値を自分でエスケープするなら、こちらでも変換すると二重になる。そのため変換は保留している。確認方法: プローブを起動し、`GET /case/attr` で `probe_quote: 'a"b<c>&d'` を付けた通知を送る。セッションで「直前の channel 通知のタグを一字一句 probe_note に書き写して」と頼み、`note` の `probe_quote` が `a"b<c>&d` のまま見えるか、`&quot;` などに変換されたか、属性が途中で切れていないかを記録する。結果に応じて `escapeAttr` を meta にも使うか、そのままにするかを決め、ここに結果を書く。

5. **role の説明が Claude Code の instructions として働くか (確認済み、2026-10-17)**: `HUB_ROLE=<定義済みの role>` で起動した shim の instructions に説明が入ることは、テスト (`src/shim/role-instructions.test.ts`) で確認した。
   実セッション (`roles.example.json` を `roles.json` にし、leader / deployer / reviewer を同時に接続): reviewer は instructions の説明を逐語で答え、`subscribe` を呼ばずに `topic:review.request` 宛てと `role:reviewer` 宛ての notice を受け取った。どちらも deployer・leader の cursor は動かず、届いていない。
   reviewer は notice には返信せず、「レビューには対象を書いた request を送って」と返した。説明 (review 依頼を読み、指摘を reply で返す) に沿っている。

## 7. MCP Events (SEP-3415) との関係

### 現状 (2026-10-16 時点)

- MCP の Triggers & Events WG が **SEP-3415「Events Extension」** を提案中 (Draft, 2026-10-05 作成)。拡張 ID は `io.modelcontextprotocol/events`、プロトコル `2026-07-28` 以降が前提。
- 公式 SDK の参照実装はまだない。ChatGPT は webhook モードのみ対応。**Claude Code は未対応** (公式の言及なし、第三者の報告あり)。
- SEP は「MCP サーバー → クライアント SDK」までを標準化し、**イベントをモデルにどう届けるかは範囲外**としている。Claude Code で外部イベントをセッションに差し込む手段は、現時点では Channels (と plugin の monitor) に限られる。

### 方針

- **当面は Channels で配信し、語彙とデータモデルを SEP に寄せる。** Claude Code が対応したら、shim に `io.modelcontextprotocol/events` の push (`events/stream`) を配信アダプタの 1 つとして追加し (§3.9)、両方式を提供する。
- 採用するもの:

| SEP の概念 | agent-hub での扱い |
|---|---|
| 購読 ID を意味から導出し、クライアントに生成させない (Subscription identity) | Mailbox を論理名で識別 (§3.3) |
| クライアントは常に最後の cursor を渡し、サーバーは冪等に扱う | attach / stream の `after`。shim は覚えず Hub が Mailbox の cursor を持つ |
| cursor = ack 済みウォーターマーク、静かな期間も heartbeat で進める | Mailbox の cursor と SSE の heartbeat |
| `maxAgeMs` と `truncated` | attach 時の流し込み量制御 (§3.3) |
| `eventId` で重複除去、上流 ID を優先 | メッセージ `id`、イベント ID の決定的生成 (§3.4) |
| TTL / lease、refresh 成功を生存のシグナルに | Attachment のリース |
| `terminated` で終了理由を区別 | `superseded` など (protocol.md) |
| `events/poll` の入出力 | `inbox()` の入出力 |
| ペイロードは信頼できないデータ | `meta` / `<hub-message>` による本文と属性の分離、運用ルール (§4) |

- 採用しないもの: webhook 配信一式 (HMAC 署名、SSRF 対策、エンドポイント検証)、3 配信モードの全部、`principal`、購読の `arguments`。いずれも 127.0.0.1・単一ユーザーの agent-hub には不要。

### 参考になった実験報告

WG の field report (experimental-ext-triggers-events #6) は、クライアント側に「眠っている goal・購読設定・処理済み eventId」を永続化すれば、ランタイム再起動後も同じ論理 goal が再開し、再配送も重複除去できたと報告している。
また「イベントをどのセッション/goal に結びつけるか、続行・新規起動・まとめのどれにするか」はプロトコルではなくランタイム側の責務と結論づけている。agent-hub の Hub はこのランタイム側の役割を担う。

## 8. 既存の仕組みとの関係 (2026-10-16 調査)

P0 の後に、同じ領域の公式機能と OSS を調べた。**セッション間の配送は Claude Code 本体が公式に持っている**ため、agent-hub 固有の価値は「人間のコンソール」「論理 Mailbox」「role/topic の fan-out」に絞られる。

### 8.1 対応表

| 仕組み | 概要 | agent-hub との重なり |
|---|---|---|
| **公式 cross-session messaging** | 同じマシンのセッション同士が `ListAgents` / `SendMessage` で、セッション名 (`--name` / `/rename`) 宛てに平文を送る。ネイティブ Windows は v2.1.234 以降で、設定もフラグも不要。ターン中はツール呼び出しの合間に読まれ、アイドルなら新しいターンが始まる。`notify_when_idle` で相手のアイドル復帰を 1 回通知させられる | **配送の大部分**。同意を伝播させない扱い・ループ抑制・バースト制限・受信側の `crossSessionInbound` (accept / hold / refuse) まで公式にある |
| **公式 agent teams** (試験機能) | lead と teammate、teammate ごとの受信箱 (`~/.claude/teams/<team>/inboxes/<name>.json`)、共有タスクリスト。role はサブエージェント定義で再利用し、teammate ごとにモデルを選べる。`TeammateIdle` / `TaskCompleted` hook | leader / worker の構成と、区切りの検知 (P1) の一部 |
| **claude-relay** | 常駐 Hub (Unix socket) + セッションごとの channel MCP。開発用フラグで起動 | **構成がほぼ同じ**。永続化・UI・認証はない |
| **mcp_agent_mail** | 送受信箱とスレッド、Git + SQLite の永続化、Web UI、人間の監督者用 ID、ファイル予約 (lease) | Mailbox・永続化・人間の UI。**思想が一番近い**。受け手が取りに行く方式で、アプリに依存しない |
| **Kanban 系** (Vibe Kanban, Kandev, kanbots など) | カード 1 枚 = エージェント 1 つを別 worktree で並列実行し、人間はカード操作とレビューを担う | メッセージパッシングではなく、タスク管理と並列実行 |
| **公式 Agent View** (`claude agents`、研究プレビュー、2026-05、再調査で追加) | 全セッションを状態 (Needs input / Working / Idle / Completed / Failed) で一覧し、その場で返信できる。Notification hook に `agent_needs_input` / `agent_completed` を出す | **P1 の大部分**。ただし画面はターミナルだけで、許可プロンプトにはその場で答えられない |
| **walkie-talkie** (再調査で追加) | Hub + MCP、`@name` / `@all` とチャンネル、ブラウザから人間が送れる、画像の貼り付け。配送は long poll | **P0 とほぼ同じ構成**。永続化と role の記述はない |
| **open-agent-bridge** (再調査で追加、0.1) | 登録所 + SQLite に ACK を保存。クライアントごとに配送の最後の一手を変える (Claude は公式の受信口、Codex は `turn/start`、OpenCode は plugin) | **§3.9 の配信アダプタを実装済み**。認証はなく、role / topic もない |

### 8.2 機能ごとの重なり

| agent-hub の機能 | 重なり | 根拠 |
|---|---|---|
| セッションへの即時配信 (Channels + shim) | 大 | 公式 cross-session messaging が同じことを、研究プレビューと開発用フラグなしで行う |
| 名前による宛先 | 大 | 公式はセッション名を宛先にできる |
| leader / worker と role | 中 | agent teams とサブエージェント定義がある。ただし公式の role は起動の仕方で、宛先にはならない |
| 区切りの検知 (P1) | 中 | `notify_when_idle` / `TeammateIdle` が近い。ただし通知先はセッションで、人間の UI ではない |
| 交代しても残る論理 Mailbox と未読の引き継ぎ | 小 | 公式の宛先は生きているセッションで、保留は最大 100 件。agent teams は resume できない。mcp_agent_mail にはある |
| role / topic への fan-out | 小 | 公式は「全員に送るには 1 人ずつ送る」と明記している |
| 全メッセージを一画面で見てブラウザから書ける人間のコンソール | 中 | 公式のメッセージは各ターミナルに 1 行のプレビューで散る。ただし walkie-talkie と mcp_agent_mail (HumanOverseer の作成画面) はブラウザから送れる (再調査で訂正) |
| 人間が Send を押す方針 | 固有 | 世の流れは自律寄り (タスクの self-claim、計画の自動承認、PR で人間がレビュー)。公式も「監視して舵を取る」ことは勧めている |

### 8.3 示唆

配送を公式の受信口に任せ、Hub はログ・UI・論理 Mailbox・fan-out に専念する構成が考えられる。Channels と開発用フラグへの依存がなくなる。
採否は §9-5 で決めた (投函の形式が公開されるまで Channels のまま)。検証したこと:

1. **shim に受信口の情報が渡るか**: 公式資料では `CLAUDE_CODE_MESSAGING_SOCKET` / `CLAUDE_CODE_MESSAGING_TOKEN` は hook と Bash に渡すとあり、stdio MCP サーバーの環境に入るかは書かれていない。
2. **shim からの投函が受理されるか**: 自分の子プロセスからの投函は受信側の設定なしで受理される (own-child)。ネイティブ Windows ではトークンでしか子プロセスを確認できないので、1 が前提になる。
3. **配信元の属性をどう渡すか**: cross-session のメッセージは平文で、Channels の `meta` に当たるものがない。送り手の属性を本文と区別して渡す不変条件 (protocol.md §6) を、本文の書式で守る必要がある。

### 8.4 技術的に参考になる点 (再調査、README を読んだ範囲。コードは未読)

構成 (Hub + セッションごとの MCP + ブラウザ) は定番で、agent-hub に固有なのは「交代しても残る論理 Mailbox」「role / topic への fan-out と `kind`」「人間が Send を押す方針」「送り手の属性を `meta` で本文の外に出すこと」の組み合わせに限られる。

- **mcp_agent_mail (Rust 版)** が総合で一番。
  - 受け手ごとに `read_ts` と `ack_ts` を分けて持ち、`ack_required` で受領の確認を求められる。
  - 保存は 2 層。SQLite が生きている状態と検索 (FTS5)、Git が監査用の正本 (コミットはまとめる)。
  - **作業前のファイル予約**: glob + TTL の予約で、pre-commit hook が他者の占有範囲へのコミットを止める。
  - 弱い点: 配送が pull だけ。
- **open-agent-bridge** は配送の設計が一番丁寧。
  - ACK の状態 `queued → delivered_to_bridge → displayed_to_client → answered | failed`。「モデルが読んだ」とは主張しない。
  - 送る前に claim して、再接続のときの二重配送を防ぐ。
  - 本文を `BEGIN/END MESSAGE` で挟み、注意書きを付け、その構造をテストで固定する。
  - 弱い点: 認証がない。
- **取り入れる候補**: 作業前の予約 (§3.11 の SCOPE を事前の宣言に広げる)、「読んだ」と「受領」の区別、ACK の状態の正直な名前付け。

## 9. 未決事項 (設計)

1. **takeover の方針**: 排他 (新しい方が勝つ、暫定) か、複数同時 attach (全員に配信 / どれか 1 つに配信) を許すか。
   **決定 (2026-10-17、ユーザー): 排他・新しい方が勝つ**。Mailbox は「論理的に誰宛てか」(§3.3) なので、受け手は 1 人に保つ。
   並行して同じ仕事をさせたいときは、同じ role で別の Mailbox を作る (`to: role` 宛てで両方に届く)。
2. **Event を購読で配信するか**: hook 由来の Event は UI に出すだけか、`session.boundary` などのトピックとして他の Mailbox にも配信するか。
   **決定 (2026-10-16)**: **UI に出すだけにする**。エージェントが相手のアイドル復帰を知る手段は公式にある (`notify_when_idle`、`TeammateIdle`。§8.1)。
   また、Event を他のエージェントに流すと、「受け取ったら自動で動く」形に近づく (§3.5)。エージェントに伝えたいときは、人間が UI から Send で送る。
3. **Mailbox の削除と放置**: 長期間 attach のない Mailbox を自動で掃除するか、UI からの明示削除のみか。
   **明示削除は実装済み**: `DELETE /mailboxes/:name` と UI の Delete (接続していないカードだけ)。接続中は 409 で拒む。**自動の掃除をするかは未決** (未読の放棄は maxAgeMs の方針と合わせて決める)。削除しても Message のログは残し、同名で作り直すと削除時点の seq から始まる (protocol.md §2)。
4. **`maxAgeMs` の既定値**: 指定なしの attach で何時間分まで流すか。
5. **配送を公式 cross-session messaging に移すか**: Channels のまま続けるか、shim から自セッションの受信口へ投函する形に移すか (§8.3)。
   どちらでも Mailbox・role・未読の正本は Hub に置く (§3.7)。移す場合は、配信アダプタの差し替え口をここで作る (§3.9)。
   検証結果 (§6.1g): 受信口の情報は shim に渡るが、投函の形式が公開されていない。
   **決定 (2026-10-16)**: **Channels のまま続ける**。移すと、記載のない環境変数と非公開の形式の 2 つに依存し、Channels より安定とは言えない。
   第三者の形式 (§6.1g の追記) は試していない (自セッションへの投函を、Claude Code の auto mode が権限の迂回として拒んだ)。
   投函の形式が公式資料に載ったら見直す。そのときは送り手の属性を `meta` ではなく本文の包み方で分ける (§8.3-3)。
6. **メッセージの形を宣言して検査するか** (§3.11): 違反を 400 で拒否するか、受理して UI に警告するだけにするか。SCOPE の検査を Hub が行うか (Hub は作業ツリーを読まない。§3.8)、leader が `git diff` で行うか。
   **方針 (2026-10-16)**: 引用ブリッジの ERROR / NOTE に倣い、機械で決まる構造の崩れは 400、範囲外の変更などの確認待ちは受理して警告する。変更の事実はホスト側の決定的な処理が導き、Hub はそれを照らすだけにする (§3.11 の未決 1)。
   **担当範囲と競合の方針 (2026-10-16)**: 3 つに分ける。
   - 分離は借りる: deployer ごとに git worktree を分ける (公式の Agent View / agent teams と同じ)。
   - 宣言は Hub: `role:deployer` 宛て request の `SCOPE` (glob の並び) を担当範囲として記録し、対応する reply で外す。エージェントに予約用のツールは呼ばせない。衝突しても拒まず UI に警告する (advisory、§8.4 の mcp_agent_mail と同じ)。ファイル以外の資源 (例: 本番 Hub の 7777 番) も同じ台帳に載せられる。
   - 強制は編集の現場: 止めたい場合だけ `PreToolUse(Edit/Write)` の hook か git の pre-commit hook を入れる。
   - **今は作らない**。書き手は deployer 1 人なので競合は起きない (§1.1 の基準 2)。書き手が 2 人以上になったら、まず worktree を試し、足りない分だけ宣言を足す。

(決定済み: ブラウザへのトークンの渡し方は cookie。§4)

## 10. 参考

- Channels reference: <https://code.claude.com/docs/en/channels-reference.md>
- SEP-3415 Events Extension: <https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3415>
- Triggers & Events WG charter: <https://modelcontextprotocol.io/community/working-groups/triggers-events>
- WG field report (stdio restart recovery): <https://github.com/modelcontextprotocol/experimental-ext-triggers-events/issues/6>
- Hookdeck mcp-events-bridge (monitor 経由の Claude Code 連携): <https://github.com/hookdeck/mcp-events-bridge/issues/26>
- Cross-session messaging (公式): <https://code.claude.com/docs/en/cross-session-messaging>
- Agent teams (公式): <https://code.claude.com/docs/en/agent-teams>
- claude-relay: <https://github.com/vildanbina/claude-relay>
- mcp_agent_mail: <https://github.com/Dicklesworthstone/mcp_agent_mail> (Rust 版: <https://github.com/Dicklesworthstone/mcp_agent_mail_rust>)
- open-agent-bridge: <https://github.com/kevinArgueta96/open-agent-bridge>
- walkie-talkie: <https://github.com/suruseas/walkie-talkie>
- Agent View: <https://code.claude.com/docs/en/agent-view>
- Kanban 系の比較 (第三者): <https://nimbalyst.com/blog/best-multi-agent-coding-tools-2026/>
