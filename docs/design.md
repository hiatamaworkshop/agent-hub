# 設計書

## 1. 背景と動機

- 複数のエージェント (Claude Code セッション、将来的には Codex など) を併用すると、人間が間に入ってコピペで受け渡すことになる。
- ただし**人間が間で読むこと自体は価値がある** (誤解に気づく、文脈を足す、そもそも送らない判断をする)。自動化すべきは「運搬」だけ。
- よって方針は **human-in-the-loop を保ったまま、運搬を取り除く**。エージェントの自律オーケストレーションは目的ではない。

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
- エージェントが呼ぶツールを公開する: `attach` / `whoami` / `subscribe` / `unsubscribe` / `post_message` / `inbox` / `list_topics` / `report_event` (詳細は protocol.md)。

**hooks (検知側)**
- Claude Code の **HTTP hook** (`type: "http"`) で、hook の入力 JSON を Hub の `POST /events` に直接送る。スクリプトは書かない (§6.1)。
- 機械的な検知を担う (下記 3.4)。

**ブラウザ UI**
- Hub が配信する 1 枚の HTML (まずはフレームワークなし)。
- 機能: イベント/メッセージのライブ表示 (SSE)、メッセージ作成・送信、受信メッセージの無編集転送ボタン、Mailbox 一覧 (接続状態・購読・未読数)。
- 画面は固定し、スクロールはスレッド (`#list`) と Mailbox 一覧 (サイドバー) だけ。上部はスレッド操作バー (表示の見せ方: Compact・Keep latest、今後のフィルタ・検索など)、下部はコンポーザー (送る操作: kind・宛先・本文・Send、今後の添付など) に置く。
- メッセージは送り手の role で色分けする (ラベルのチップと縁取り。role がなければ mailbox 名)。kind は枠線だけのバッジで示し、色には使わない。
- タブの未読: 非表示中に SSE で届いた、人間宛て (`to.type === 'user'`) の他者のメッセージ数をタイトル `(n) agent-hub` と favicon のバッジで示す。agent 同士のメッセージ (`mailbox:*` / `role:*` / `topic:*` 宛て) は数えない。前面に戻るかフォーカスで消す。自分の送信と履歴読み込みは数えない。
- UI の表示文言は英語にする (メッセージ本文は対象外で、そのまま表示する)。このドキュメント自体は日本語のまま。
- カスタムコマンド: 本文の `/name` (または `/name 引数`) を Send の瞬間に定義済みの text へ置換して送る。置換は UI が行い、Hub はコマンドを知らない (置換後の本文を普通のメッセージとして受ける)。スレッドに残るのも置換後の本文なので、何を送ったかがそのまま見える。人間が Send を押したときだけ動き、自動送信はしない。設定は Hub 側の `HUB_DATA_DIR/settings.json` にあり、手で編集できる (読みは毎回ファイルから行う)。Hub が `/settings` を持たない古い版のときは Commands を無効にし、送信はこれまでどおり。

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
- **takeover (暫定: 排他・新しい方が勝つ)**: 既に Attachment がある Mailbox に別セッションが attach すると、旧 Attachment に `terminated(reason: superseded)` を送って切り離す。複数同時 attach を許すかは §9 で未決。
- **リース**: shim は heartbeat でリースを延長する。リースが切れた Attachment は detached になり、その間のメッセージは Mailbox の未読キューに溜まる。Mailbox 自体はリース切れでは消えない。
- **後継への流し込み量の制御**: attach 時に `maxAgeMs` を指定でき、それより古い未読は渡さない。切り捨てがあれば `truncated: true` を返し、shim はその旨をエージェントに 1 件の通知で伝える。
  Channels は作業中に届いた通知を次のターンにまとめて渡すため、長期不在後の大量流し込みを防ぐ目的がある。

### 3.4 検知 (R1)

| 検知対象 | 手段 | 性質 |
|---|---|---|
| ターン終了 (区切り候補) | `Stop` hook | 確定的・機械的 |
| 許可待ち・入力待ち | `Notification` hook | 確定的 |
| エージェントからの質問 | `PreToolUse` hook (matcher: `AskUserQuestion`) | 確定的 |
| 「ここでセッションを区切るべきか」の意味判断 | clear-timing skill のような skill | 意味的 (エージェント側の判断) |

機械的な検知は hook、意味的な判断は skill、と役割を分ける。
skill が「区切りに来た」と判断した場合は、エージェントが `report_event` で Hub に申告する。

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
- トピック例: `session.boundary`, `agent.question`, `user.message`, `agent.<mailbox>`
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
- **Event の取り込みはクライアントごとの変換を通す**: hook の入力 JSON は `payload` にそのまま残し、`kind` (`turn.end` / `notification` / `question` …) への対応付けはクライアントごとの変換に閉じ込める (protocol.md §2 Event)。Hub の保存形式と UI は `kind` だけを見る。
- **shim の instructions はクライアントで切り替える**: 今の文面は `<channel>` で届く前提。MCP の `initialize` の `clientInfo.name` で、Channels 経路か `inbox()` 経路かの説明を選ぶ。
- **「本文はデータ」の守りは agent-hub 側だけで成り立たせる**: Claude Code は channel 由来の内容に注意書きを自動で付けるが (§6.1c)、他のクライアントは付けない。`<hub-message>` の包みと instructions の文面だけで足りるように書く。
- **role の説明は MCP の instructions で渡す**: `roles.json` の `description` を shim が instructions に差し込む (§3.5、P2)。Claude の起動フラグ (`--append-system-prompt-file`。`tools/dev/` の試験用) には頼らない。ただし instructions をどう使うかはクライアント次第で、未確認。
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

### 3.11 メッセージの形の宣言と検査 (構想、未実装)

エージェント間のメッセージの形を宣言し、Hub が受け付ける前に検査する。発想は vcp の C96 (thesis での OWL の読み直し) から借りた。
OWL は開世界、agent-hub は閉世界。**持ち込むのは「関係と形を宣言し、閉じた集合で検査する」ことだけ**で、RDF / Turtle や開世界の推論は持ち込まない (重すぎる)。

- **宣言するもの**: role とメッセージの関係。例: leader は deployer に request を出せる / deployer の reply には `CHANGED` と `VERIFIED` が要る / `meta` に使ってよいキー。
  置き場所は P2 の `roles.json` を広げる (role ごとに送ってよい相手と kind、メッセージの必須見出し)。形は小さな JSON で足りる。
- **検査するのは Hub**: `post_message` が届いた時点で宣言に照らし、合わなければ 400 で返す。エラーは送ったエージェントに返るので、エージェントは書き直すだけで、宣言を読む必要はない (エージェントの負担を増やさない)。
  vcp の「LLM を確定層から外す」と同じで、形の判断を LLM の自己申告ではなく Hub の決定的な処理に置く。
- **本文は書き換えない**: 検査は受理するかどうかを決めるだけ。「要約・加工しない」に反しない。
- **人間が管理する**: 宣言はブラウザで見て編集できるようにする。エージェントには自分に関係する部分だけを instructions で渡す (§3.7)。
- **依頼ごとの SCOPE の検査**: 依頼の `SCOPE:` に書いたファイルの範囲と、作業後の `git diff --name-only` を突き合わせる。範囲外の変更を LLM の判断に頼らず機械的に拾える。プロジェクト全体の定義は要らず、依頼の `SCOPE:` 行で足りる。
- **実装の中身は宣言しない**: プロジェクトの実装はコード・テスト・docs がすでに定義であり、閉世界の検査はテストと型チェックが担っている。別に宣言を持つと正本が 2 つになり、すぐ古くなる。宣言の対象は「エージェント間のやり取りの形」と「依頼ごとの SCOPE」までにする。

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

### 6.2 未検証

1. **Windows 固有**: パス表記、改行コード。daemon の常駐は Docker (§3.8) で解決する見込み。
   Docker Desktop (WSL2) で `ports: "127.0.0.1:7777:7777"` がホストのループバックだけに公開されることを確認する。
2. **Codex 側の MCP 対応状況**: `inbox()` polling が使えるか。
3. **代替の配信経路: plugin の monitor**。Hookdeck の mcp-events-bridge は Channels を使わず、plugin の monitor で poll クライアントを動かし、1 行出力を通知として Claude に届けている (Claude Code 2.1.275 以降)。開発用フラグと警告ダイアログが不要になる可能性がある。アイドル中のセッションを起こせるかを含めて比較する。

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

### 8.2 機能ごとの重なり

| agent-hub の機能 | 重なり | 根拠 |
|---|---|---|
| セッションへの即時配信 (Channels + shim) | 大 | 公式 cross-session messaging が同じことを、研究プレビューと開発用フラグなしで行う |
| 名前による宛先 | 大 | 公式はセッション名を宛先にできる |
| leader / worker と role | 中 | agent teams とサブエージェント定義がある。ただし公式の role は起動の仕方で、宛先にはならない |
| 区切りの検知 (P1) | 中 | `notify_when_idle` / `TeammateIdle` が近い。ただし通知先はセッションで、人間の UI ではない |
| 交代しても残る論理 Mailbox と未読の引き継ぎ | 小 | 公式の宛先は生きているセッションで、保留は最大 100 件。agent teams は resume できない。mcp_agent_mail にはある |
| role / topic への fan-out | 小 | 公式は「全員に送るには 1 人ずつ送る」と明記している |
| 全メッセージを一画面で見てブラウザから書ける人間のコンソール | 固有 | 公式のメッセージは各ターミナルに 1 行のプレビューで散る。mcp_agent_mail の UI は閲覧が中心 |
| 人間が Send を押す方針 | 固有 | 世の流れは自律寄り (タスクの self-claim、計画の自動承認、PR で人間がレビュー)。公式も「監視して舵を取る」ことは勧めている |

### 8.3 示唆

配送を公式の受信口に任せ、Hub はログ・UI・論理 Mailbox・fan-out に専念する構成が考えられる。Channels と開発用フラグへの依存がなくなる。採否は §9-5 で決める。検証すること:

1. **shim に受信口の情報が渡るか**: 公式資料では `CLAUDE_CODE_MESSAGING_SOCKET` / `CLAUDE_CODE_MESSAGING_TOKEN` は hook と Bash に渡すとあり、stdio MCP サーバーの環境に入るかは書かれていない。
2. **shim からの投函が受理されるか**: 自分の子プロセスからの投函は受信側の設定なしで受理される (own-child)。ネイティブ Windows ではトークンでしか子プロセスを確認できないので、1 が前提になる。
3. **配信元の属性をどう渡すか**: cross-session のメッセージは平文で、Channels の `meta` に当たるものがない。送り手の属性を本文と区別して渡す不変条件 (protocol.md §6) を、本文の書式で守る必要がある。

## 9. 未決事項 (設計)

1. **takeover の方針**: 排他 (新しい方が勝つ、暫定) か、複数同時 attach (全員に配信 / どれか 1 つに配信) を許すか。
2. **Event を購読で配信するか**: hook 由来の Event は UI に出すだけか、`session.boundary` などのトピックとして他の Mailbox にも配信するか。
3. **Mailbox の削除と放置**: 長期間 attach のない Mailbox を自動で掃除するか、UI からの明示削除のみか。
4. **`maxAgeMs` の既定値**: 指定なしの attach で何時間分まで流すか。
5. **配送を公式 cross-session messaging に移すか**: Channels のまま続けるか、shim から自セッションの受信口へ投函する形に移すか (§8.3)。P1 に入る前に決める。
   どちらでも Mailbox・role・未読の正本は Hub に置く (§3.7)。移す場合は、配信アダプタの差し替え口をここで作る (§3.9)。
6. **メッセージの形を宣言して検査するか** (§3.11): 違反を 400 で拒否するか、受理して UI に警告するだけにするか。SCOPE の検査を Hub が行うか (Hub は作業ツリーを読まない。§3.8)、leader が `git diff` で行うか。

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
- mcp_agent_mail: <https://github.com/Dicklesworthstone/mcp_agent_mail>
- Kanban 系の比較 (第三者): <https://nimbalyst.com/blog/best-multi-agent-coding-tools-2026/>
