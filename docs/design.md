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
- **takeover (暫定: 排他・新しい方が勝つ)**: 既に Attachment がある Mailbox に別セッションが attach すると、旧 Attachment に `terminated(reason: superseded)` を送って切り離す。複数同時 attach を許すかは §8 で未決。
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

- **当面は Channels で配信し、語彙とデータモデルを SEP に寄せる。** Claude Code が対応したら、shim に `io.modelcontextprotocol/events` の push (`events/stream`) を追加して両方式を提供する。
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

## 8. 未決事項 (設計)

1. **takeover の方針**: 排他 (新しい方が勝つ、暫定) か、複数同時 attach (全員に配信 / どれか 1 つに配信) を許すか。
2. **Event を購読で配信するか**: hook 由来の Event は UI に出すだけか、`session.boundary` などのトピックとして他の Mailbox にも配信するか。
3. **Mailbox の削除と放置**: 長期間 attach のない Mailbox を自動で掃除するか、UI からの明示削除のみか。
4. **`maxAgeMs` の既定値**: 指定なしの attach で何時間分まで流すか。

(決定済み: ブラウザへのトークンの渡し方は cookie。§4)

## 9. 参考

- Channels reference: <https://code.claude.com/docs/en/channels-reference.md>
- SEP-3415 Events Extension: <https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3415>
- Triggers & Events WG charter: <https://modelcontextprotocol.io/community/working-groups/triggers-events>
- WG field report (stdio restart recovery): <https://github.com/modelcontextprotocol/experimental-ext-triggers-events/issues/6>
- Hookdeck mcp-events-bridge (monitor 経由の Claude Code 連携): <https://github.com/hookdeck/mcp-events-bridge/issues/26>
