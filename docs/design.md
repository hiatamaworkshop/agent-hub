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
                          mailbox=main   mailbox=reviewer
```

### 3.1 なぜ Hub と shim を分けるか

Channel MCP サーバーは **Claude セッションごとにサブプロセスとして起動**される。
MCP サーバー自身を HTTP の受け口にすると、複数セッションでポートが衝突し、状態も共有できない。
そのため状態と HTTP を **Hub (1 つ)** に集約し、**shim (セッション数ぶん)** は薄い橋渡しに徹する。

MCP Events (§7) の用語でいえば、Hub は「イベントを受けて保持し、クライアントに poll / push で渡す **Forward Proxy**」の位置にあたる。
SEP はクライアント側に購読状態の正本を置くが、agent-hub ではクライアント (shim) を無状態に保つため、その正本を代理人である Hub が持つ。

### 3.2 コンポーネント

**Hub**
- 127.0.0.1 限定の HTTP サーバー。常駐 daemon として起動する。
- 保持するもの: Mailbox 表、Attachment 表、メッセージ、イベントログ。
- ブラウザ UI の静的ファイルも配信する。
- 永続化は P0 では JSONL 追記ログ + メモリ (起動時にログから Mailbox 表を復元)、必要になれば SQLite (P2)。

**shim (channel MCP サーバー)**
- Claude Code が stdio で起動する薄い MCP サーバー。**状態を持たない。**
- 起動時に Mailbox 名を決めて Hub に **attach** し、Hub からの SSE を購読する (§3.3)。
- Hub から配信されたメッセージを `notifications/claude/channel` として Claude に push する。
- エージェントが呼ぶツールを公開する: `subscribe` / `unsubscribe` / `post_message` / `inbox` / `list_topics` / `report_event` (詳細は protocol.md)。

**hooks (検知側)**
- Claude Code の hook から Hub の `POST /events` を叩く小さなスクリプト。
- 機械的な検知を担う (下記 3.4)。

**ブラウザ UI**
- Hub が配信する 1 枚の HTML (まずはフレームワークなし)。
- 機能: イベント/メッセージのライブ表示 (SSE)、メッセージ作成・送信、受信メッセージの無編集転送ボタン、Mailbox 一覧 (接続状態・購読・未読数)。

### 3.3 Mailbox と Attachment (R5, R6)

宛先の同一性を「どのプロセスが受け取っているか」ではなく「**論理的に誰宛てか**」で決める。
MCP Events (SEP-3415) が購読 ID をクライアント生成にせず、購読内容から決定的に導出しているのと同じ発想 (§7)。

| 層 | 寿命 | キー | 持つもの |
|---|---|---|---|
| **Mailbox** | 長寿命。明示的に削除するまで残る | 論理名 (例 `main`, `reviewer`) | 購読トピック、cursor (ack 済みウォーターマーク)、未読キュー |
| **Attachment** | 一時的。セッションの生存期間 | Hub が払い出す `attachmentId` | `sessionId`、`kind`、`cwd`、リース期限 |

- **Mailbox 名の決め方** (優先順): 環境変数 `HUB_MAILBOX` → MCP ツール `attach(mailbox)` の明示呼び出し → 未指定ならカレントフォルダ名。
  `HUB_MAILBOX` が shim に渡るかは §6 で検証する。
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

**hook イベントと Mailbox の対応付け**: hook の入力には `session_id` が来る想定。Hub は Attachment の `sessionId` を引いてイベントを Mailbox に結びつける。
そのため shim は attach 時に自セッションの `sessionId` を申告する必要がある。shim がそれを知る手段は未確認 (§6)。
代替案として、shim と hook がどちらも同じ Claude Code プロセスの子孫であることを使う (親 PID 照合) 方法があるが、Windows ではシェル経由で親子関係が崩れうるため最後の手段とする。

**イベント ID**: 同じ区切りが `Stop` hook と `report_event` の両方から届いても重複除去できるよう、イベント ID は可能なら上流の値 (`session_id` + hook 固有の値) から決定的に作る (SEP の `eventId` の考え方)。

engram (ユーザーの記憶 MCP) は**区切りで得た知見の永続化先**として使う。ライブのキューや購読表は engram に載せず Hub 内に持つ (応答性のため)。

### 3.5 購読 (R4)

- 購読は **Mailbox に紐づく**。エージェントが `subscribe(topic)` を**自分で呼んだ時だけ**そのトピックの配信を受ける。
- 宛先指定メッセージ (`to: mailbox`) は購読なしでも受け取る。
- トピック例: `session.boundary`, `agent.question`, `user.message`, `agent.<mailbox>`
- SEP の `arguments` (購読時のフィルタ引数) は導入しない。トピック名の一致のみ。必要になったら追加する。

### 3.6 配信

- Claude Code へは Channels の `notifications/claude/channel` で push する。**Claude Code は通知を ack しない**ため、shim の ack が意味するのは「トランスポートに書けた」まで (§6 の検証結果)。
- 本文は `<hub-message>` で包んでから `content` に入れる (protocol.md §6)。Claude 側では Channels がさらに `<channel source="...">` で包む。
- 配信保証は Mailbox 単位の at-least-once + `seq` 順。重複除去はメッセージ `id` で行う (protocol.md §4)。

### 3.7 Claude Code 以外のエージェント

Channels は Claude Code 固有。Codex など他のエージェントには push できないので、
同じ shim の MCP ツール `inbox()` を polling する**縮退経路**を用意する。Mailbox・購読・未読キューは共通。
`inbox()` の入出力は MCP Events の `events/poll` (`cursor`, `truncated`, `hasMore`, `nextPollMs`) に揃える。

## 4. セキュリティ

メッセージは**他エージェント/ブラウザ由来の文字列がエージェントの入力になる**ため、プロンプトインジェクション経路になりうる。

- Hub は `127.0.0.1` のみ bind。外部公開しない。
- 全 API に共有トークン (起動時に生成、環境変数または設定ファイルで shim/hook/UI に渡す)。ブラウザへの渡し方は §8 で未決。
- 配信時に `from` / `topic` / `id` を必ず付与し、本文は区切って包む (protocol.md の配信フォーマット参照)。
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

### 6.2 未検証

1. **Channels の必要バージョン** (v2.1.80 以降と報告されている) と、claude.ai 認証 / Console API キーの要件。
2. **channel タグの閉じタグ偽装**: 本文に `</channel>` が含まれた場合に Claude Code がエスケープするか。結果次第で `<hub-message>` の二重包みをやめ、属性を `meta` に一本化する。
3. **shim が自セッションの `session_id` を知る手段** (環境変数・MCP の初期化情報など)。hook イベントと Mailbox の対応付け (§3.4) の前提。
4. **`.mcp.json` の環境変数**: 起動時の `HUB_MAILBOX` が shim に継承されるか、`${VAR}` 展開が効くか。
5. **hook の入力ペイロード**: `Stop` / `Notification` / `PreToolUse` が stdin で受け取る JSON のフィールド (session_id、transcript_path など)。
6. **hook の設定場所**: `~/.claude/settings.json` か、プロジェクトの `.claude/settings.json` か。Windows でのコマンド記述。
7. **`AskUserQuestion` 待機中に channel 通知が来たときの挙動**: 回答として扱われるのか、次のターンの入力になるのか。
8. **Windows 固有**: PowerShell 環境での daemon 常駐方法、パス表記、改行コード。
9. **Codex 側の MCP 対応状況**: `inbox()` polling が使えるか。
10. **代替の配信経路: plugin の monitor**。Hookdeck の mcp-events-bridge は Channels を使わず、plugin の monitor で poll クライアントを動かし、1 行出力を通知として Claude に届けている (Claude Code 2.1.275 以降)。開発用フラグと警告ダイアログが不要になる可能性がある。アイドル中のセッションを起こせるかを含めて比較する。

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
| ペイロードは信頼できないデータ | `<hub-message>` と運用ルール (§4) |

- 採用しないもの: webhook 配信一式 (HMAC 署名、SSRF 対策、エンドポイント検証)、3 配信モードの全部、`principal`、購読の `arguments`。いずれも 127.0.0.1・単一ユーザーの agent-hub には不要。

### 参考になった実験報告

WG の field report (experimental-ext-triggers-events #6) は、クライアント側に「眠っている goal・購読設定・処理済み eventId」を永続化すれば、ランタイム再起動後も同じ論理 goal が再開し、再配送も重複除去できたと報告している。
また「イベントをどのセッション/goal に結びつけるか、続行・新規起動・まとめのどれにするか」はプロトコルではなくランタイム側の責務と結論づけている。agent-hub の Hub はこのランタイム側の役割を担う。

## 8. 未決事項 (設計)

1. **takeover の方針**: 排他 (新しい方が勝つ、暫定) か、複数同時 attach (全員に配信 / どれか 1 つに配信) を許すか。
2. **Event を購読で配信するか**: hook 由来の Event は UI に出すだけか、`session.boundary` などのトピックとして他の Mailbox にも配信するか。
3. **ブラウザへのトークンの渡し方**: `EventSource` は `Authorization` ヘッダーを付けられない。cookie (HttpOnly, SameSite=Strict) かクエリパラメータか。
4. **Mailbox の削除と放置**: 長期間 attach のない Mailbox を自動で掃除するか、UI からの明示削除のみか。
5. **`maxAgeMs` の既定値**: 指定なしの attach で何時間分まで流すか。

## 9. 参考

- Channels reference: <https://code.claude.com/docs/en/channels-reference.md>
- SEP-3415 Events Extension: <https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3415>
- Triggers & Events WG charter: <https://modelcontextprotocol.io/community/working-groups/triggers-events>
- WG field report (stdio restart recovery): <https://github.com/modelcontextprotocol/experimental-ext-triggers-events/issues/6>
- Hookdeck mcp-events-bridge (monitor 経由の Claude Code 連携): <https://github.com/hookdeck/mcp-events-bridge/issues/26>
