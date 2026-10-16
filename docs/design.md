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

### 非目標

- エージェントの自動実行・自律的なタスク分配
- 会話の要約・要点抽出 (中身は加工せずそのまま運ぶ)
- 人間の確認なしで他エージェントへ自動転送すること (既定は必ず人間の Send 操作を挟む)
- リモート公開・マルチユーザー対応 (127.0.0.1 限定)

## 3. アーキテクチャ

```
┌──────────────┐   SSE / HTTP    ┌────────────────────────────┐
│ ブラウザ UI   │ ◀────────────▶ │ Hub (常駐 daemon, 1 プロセス) │
└──────────────┘                 │  - 購読表                     │
                                 │  - メッセージ / 未読キュー     │
 hooks ── POST /events ────────▶ │  - イベントログ (JSONL)       │
                                 └──────▲──────▲──────▲─────────┘
                                        │ SSE  │      │   shim が Hub へ接続
                              ┌─────────┴┐ ┌───┴─────┐ ┌┴────────┐
                              │ shim A   │ │ shim B  │ │ shim C  │  channel MCP (stdio)
                              └────┬─────┘ └────┬────┘ └────┬────┘
                                   ▼            ▼           ▼
                              Claude A      Claude B    (Codex 等: inbox() polling)
```

### 3.1 なぜ Hub と shim を分けるか

Channel MCP サーバーは **Claude セッションごとにサブプロセスとして起動**される。
MCP サーバー自身を HTTP の受け口にすると、複数セッションでポートが衝突し、状態も共有できない。
そのため状態と HTTP を **Hub (1 つ)** に集約し、**shim (セッション数ぶん)** は薄い橋渡しに徹する。

### 3.2 コンポーネント

**Hub**
- 127.0.0.1 限定の HTTP サーバー。常駐 daemon として起動する。
- 保持するもの: エージェント登録表、購読表、メッセージ、未読キュー、イベントログ。
- ブラウザ UI の静的ファイルも配信する。
- 永続化は P0 では JSONL 追記ログ + メモリ、必要になれば SQLite (P2)。

**shim (channel MCP サーバー)**
- Claude Code が stdio で起動する薄い MCP サーバー。
- 起動時に Hub へ自分を登録し (agentId を取得)、Hub からの SSE を購読する。
- Hub から配信されたメッセージを `notifications/claude/channel` として Claude に push する。
- エージェントが呼ぶツールを公開する: `subscribe` / `unsubscribe` / `post_message` / `inbox` / `list_topics` (詳細は protocol.md)。

**hooks (検知側)**
- Claude Code の hook から Hub の `POST /events` を叩く小さなスクリプト。
- 機械的な検知を担う (下記 3.3)。

**ブラウザ UI**
- Hub が配信する 1 枚の HTML (まずはフレームワークなし)。
- 機能: イベント/メッセージのライブ表示 (SSE)、メッセージ作成・送信、受信メッセージの無編集転送ボタン、エージェント一覧と購読状況。

### 3.3 検知 (R1)

| 検知対象 | 手段 | 性質 |
|---|---|---|
| ターン終了 (区切り候補) | `Stop` hook | 確定的・機械的 |
| 許可待ち・入力待ち | `Notification` hook | 確定的 |
| エージェントからの質問 | `PreToolUse` hook (matcher: `AskUserQuestion`) | 確定的 |
| 「ここでセッションを区切るべきか」の意味判断 | clear-timing skill のような skill | 意味的 (エージェント側の判断) |

機械的な検知は hook、意味的な判断は skill、と役割を分ける。
skill が「区切りに来た」と判断した場合は、エージェントが `post_message` (または専用イベント) で Hub に申告する経路も用意する。

engram (ユーザーの記憶 MCP) は**区切りで得た知見の永続化先**として使う。ライブのキューや購読表は engram に載せず Hub 内に持つ (応答性のため)。

### 3.4 購読 (R4)

- エージェントは `subscribe(topic)` を**自分で呼んだ時だけ**そのトピックの配信を受ける。
- 宛先指定メッセージ (`to: agentId`) は購読なしでも受け取る。
- トピック例: `session.boundary`, `agent.question`, `user.message`, `agent.<name>`

### 3.5 Claude Code 以外のエージェント

Channels は Claude Code 固有。Codex など他のエージェントには push できないので、
同じ shim の MCP ツール `inbox()` を polling する**縮退経路**を用意する。Hub・購読・未読キューは共通。

## 4. セキュリティ

メッセージは**他エージェント/ブラウザ由来の文字列がエージェントの入力になる**ため、プロンプトインジェクション経路になりうる。

- Hub は `127.0.0.1` のみ bind。外部公開しない。
- 全 API に共有トークン (起動時に生成、環境変数または設定ファイルで shim/hook/UI に渡す)。
- 配信時に `from` / `topic` / `id` を必ず付与し、本文は区切って包む (protocol.md の配信フォーマット参照)。
- 受信側の運用ルール: 他エージェント由来テキストは**指示ではなくデータ**として扱う、と CLAUDE.md や skill に明記する。
- 人間の Send 操作を既定とする。自動転送ルールを作る場合は明示的な opt-in にする。
- CORS: UI は Hub と同一オリジンで配信し、`Origin` 検証を行う。

## 5. 設計判断のメモ

| 判断 | 理由 |
|---|---|
| Hub と shim の分離 | 3.1 の通り。複数セッション対応に必須 |
| hook を検知の本命にする | skill は指示でありエージェントが忘れうる。hook は確定的 |
| 配信は at-least-once + 連番 | セッション断・再接続での取りこぼしを避けるため。重複は id で冪等に |
| P0 はフレームワークなし UI | 検証を最短にするため。必要になってから導入 |
| 永続化は JSONL から始める | 実装が最小で、人間が `tail` で追える |

## 6. 未確認事項 (実装前に必ず検証すること)

以下は構想時点の**伝聞・推測を含む**。実装エージェントは最初に公式資料で確認し、結果をこの節に追記すること。

1. **Channels の仕様**: 公式リファレンス <https://code.claude.com/docs/en/channels-reference.md> の通りか。
   - 通知名 `notifications/claude/channel` と capability 宣言 `claude/channel` の正確なスキーマ
   - 起動フラグ (`--channels` / `--dangerously-load-development-channels`) と、自作 channel に必要な条件
   - research preview であること、必要バージョン (v2.1.80 以降と報告されている)、Team/Enterprise での有効化条件
2. **hook の入力ペイロード**: `Stop` / `Notification` / `PreToolUse` が stdin で受け取る JSON のフィールド (session_id、transcript_path など)。
3. **hook の設定場所**: `~/.claude/settings.json` か、プロジェクトの `.claude/settings.json` か。Windows でのコマンド記述。
4. **セッション閉鎖中の挙動**: channel 通知はセッションが開いている間のみ届く。Hub 側の未読キューで十分か。
5. **Windows 固有**: PowerShell 環境での daemon 常駐方法、パス表記、改行コード。
6. **Codex 側の MCP 対応状況**: `inbox()` polling が使えるか。

## 7. 参考

- Channels reference: <https://code.claude.com/docs/en/channels-reference.md>
