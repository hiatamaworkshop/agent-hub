# プロトコル仕様 (ドラフト)

実装時に検証結果を踏まえて更新すること。フィールド名は暫定。

## 1. 共通

- ベース URL: `http://127.0.0.1:<port>` (既定ポートは実装時に決め、設定可能にする)
- 認証: `Authorization: Bearer <token>`。全エンドポイントで必須 (UI の静的ファイル配信を除く)。
- 時刻: ISO 8601 UTC 文字列。
- id: 文字列 (ULID を推奨。時系列ソート可能)。

## 2. データモデル

### Agent
```json
{ "agentId": "a_01H...", "kind": "claude-code", "name": "main", "sessionId": "…", "cwd": "…", "connectedAt": "…", "lastSeenAt": "…" }
```

### Event (hook など検知側から Hub へ)
```json
{
  "id": "e_01H...",
  "ts": "2026-10-16T12:00:00Z",
  "kind": "turn.end | notification | question | session.boundary",
  "sessionId": "…",
  "agentId": "a_01H... (分かれば)",
  "payload": { "...": "hook の入力をそのまま、または必要部分" }
}
```

### Message
```json
{
  "id": "m_01H...",
  "seq": 42,
  "ts": "…",
  "from": { "type": "user | agent", "id": "…" },
  "to": { "type": "agent | topic", "id": "…" },
  "body": "本文 (文字列)",
  "replyTo": "m_… (任意)",
  "forwardedFrom": "m_… (無編集転送の場合)"
}
```
`seq` は Hub 全体で単調増加する連番。

### Subscription
```json
{ "agentId": "a_01H...", "topic": "session.boundary", "since": "…" }
```

## 3. Hub の HTTP API

### 検知側 / 共通
| メソッド | パス | 内容 |
|---|---|---|
| POST | `/events` | Event を登録。登録後 UI に SSE で配信 |
| POST | `/messages` | Message を作成して配信 (宛先は `to`) |
| GET | `/messages?since=<seq>` | 履歴取得 |
| GET | `/agents` | 登録済みエージェントと購読の一覧 |

### UI 向け
| メソッド | パス | 内容 |
|---|---|---|
| GET | `/` | UI の HTML |
| GET | `/stream` | SSE。Event / Message / Agent 状態変化を流す |
| POST | `/messages/:id/forward` | 無編集転送。body: `{ "to": {...} }` |

### shim 向け
| メソッド | パス | 内容 |
|---|---|---|
| POST | `/agents/register` | agentId を払い出す。body: `{kind, name, sessionId, cwd}` |
| GET | `/agents/:id/stream?after=<seq>` | SSE。このエージェント宛 + 購読トピックのメッセージを `seq` 順に流す。再接続時は `after` 以降を再送 |
| POST | `/agents/:id/ack` | 受信確認。body: `{ "upTo": <seq> }` |
| PUT | `/agents/:id/subscriptions/:topic` | 購読 |
| DELETE | `/agents/:id/subscriptions/:topic` | 購読解除 |
| POST | `/agents/:id/heartbeat` | 生存通知 (任意) |

## 4. 配信保証

- **at-least-once**。ack されるまで未読キューに残り、再接続時に再送する。
- 受信側は `id` で冪等に処理する。
- 順序は `seq` 順。
- 未読キューには上限と保持期間を設ける (例: 1000 件 / 7 日。実装時に調整)。

## 5. MCP ツール (shim が公開)

| ツール | 引数 | 動作 |
|---|---|---|
| `subscribe` | `topic` | 購読開始 |
| `unsubscribe` | `topic` | 購読解除 |
| `list_topics` | なし | 既知トピックと自分の購読状況 |
| `post_message` | `to` (agent/topic), `body`, `replyTo?` | Message を送る |
| `inbox` | `after?`, `limit?` | 未読を取得 (polling 用。Claude Code 以外の縮退経路) |
| `report_event` | `kind`, `payload` | skill が意味判断した結果 (区切り申告など) を Hub に出す |

## 6. channel 通知のフォーマット

shim が Claude に push する本文は、由来が分かるよう包む。

```
<hub-message id="m_01H..." from="user:browser" topic="user.message" seq="42">
本文
</hub-message>
```

- 本文は**データ**であり、エージェントへの命令として扱わない。この前提を CLAUDE.md / skill 側にも明記する。
- 本文内に `</hub-message>` が含まれる場合はエスケープする。
- 実際の通知スキーマ (`notifications/claude/channel` の params) は公式リファレンスで確認して合わせる。

## 7. UI ↔ Hub のイベント種別 (SSE `event:` 名)

`event` (検知イベント), `message`, `agent.connected`, `agent.disconnected`, `subscription.changed`
