# プロトコル仕様 (ドラフト)

実装時に検証結果を踏まえて更新すること。フィールド名は暫定。
用語とモデルの背景は design.md §3.3 (Mailbox と Attachment) と §7 (MCP Events との関係) を参照。

## 1. 共通

- ベース URL: `http://127.0.0.1:<port>` (既定 `7777`、`HUB_PORT` で変更可)
- 認証: `Authorization: Bearer <token>`。全エンドポイントで必須 (UI の静的ファイル配信を除く)。ブラウザ向けの渡し方は design.md §8 で未決。
- 時刻: ISO 8601 UTC 文字列。
- id: 文字列 (ULID を推奨。時系列ソート可能)。
- `seq`: Hub 全体で単調増加する整数。メッセージの順序と cursor に使う。
- Mailbox 名: `^[a-z0-9][a-z0-9_.-]{0,63}$`。URL パスにそのまま載せる。

## 2. データモデル

### Mailbox (長寿命の論理宛先)
```json
{
  "name": "reviewer",
  "createdAt": "…",
  "subscriptions": ["user.message", "agent.main"],
  "cursor": 41,
  "attachment": "at_01H… | null"
}
```
- `cursor`: ack 済みウォーターマーク。この `seq` 以下は配送済み (または `maxAgeMs` で放棄済み)。
- 未読 = この Mailbox 宛て (直接宛先 + 購読トピック) で `seq > cursor` のメッセージ。
- 初回の attach で自動作成する。削除は明示操作のみ。

### Attachment (一時的なセッション接続)
```json
{
  "attachmentId": "at_01H…",
  "mailbox": "reviewer",
  "kind": "claude-code | codex | other",
  "sessionId": "… (分かれば)",
  "cwd": "…",
  "attachedAt": "…",
  "leaseUntil": "…"
}
```

### Event (hook など検知側から Hub へ)
```json
{
  "id": "e_… (上流の値から決定的に生成できる場合はそうする)",
  "ts": "2026-10-16T12:00:00Z",
  "kind": "turn.end | notification | question | session.boundary",
  "sessionId": "…",
  "mailbox": "reviewer (sessionId から解決できた場合)",
  "payload": { "...": "hook の入力をそのまま、または必要部分" }
}
```
`mailbox` は Hub が `sessionId` → Attachment → Mailbox の順で解決して付与する。解決できなければ空のまま UI に出す。

### Message
```json
{
  "id": "m_01H...",
  "seq": 42,
  "ts": "…",
  "from": { "type": "user | mailbox", "id": "browser | reviewer" },
  "to": { "type": "mailbox | topic", "id": "…" },
  "body": "本文 (文字列)",
  "replyTo": "m_… (任意)",
  "forwardedFrom": "m_… (無編集転送の場合)"
}
```

## 3. Hub の HTTP API

### 検知側 / 共通
| メソッド | パス | 内容 |
|---|---|---|
| POST | `/events` | Event を登録。登録後 UI に SSE で配信 |
| POST | `/messages` | Message を作成して配信 (宛先は `to`) |
| GET | `/messages?after=<seq>&limit=<n>` | 履歴取得 |
| GET | `/mailboxes` | Mailbox 一覧 (購読・未読数・Attachment の状態) |
| DELETE | `/mailboxes/:name` | Mailbox を削除。接続中の Attachment には `terminated(mailbox_deleted)` を送る |

### UI 向け
| メソッド | パス | 内容 |
|---|---|---|
| GET | `/` | UI の HTML |
| GET | `/stream` | SSE。Event / Message / Mailbox・Attachment の状態変化を流す |
| POST | `/messages/:id/forward` | 無編集転送。body: `{ "to": {...} }` |

### shim 向け
| メソッド | パス | 内容 |
|---|---|---|
| POST | `/mailboxes/:name/attach` | Mailbox に attach (なければ作成)。下記参照 |
| GET | `/attachments/:id/stream?after=<seq>` | SSE。Mailbox の未読を `seq` 順に流し、以後の新着も流す |
| POST | `/attachments/:id/ack` | 受信確認。body: `{ "upTo": <seq> }`。Mailbox の `cursor` を進める |
| POST | `/attachments/:id/heartbeat` | リース延長。応答に `leaseUntil` |
| DELETE | `/attachments/:id` | detach (セッション終了時。Mailbox は残る) |
| PUT | `/mailboxes/:name/subscriptions/:topic` | 購読 |
| DELETE | `/mailboxes/:name/subscriptions/:topic` | 購読解除 |
| GET | `/mailboxes/:name/inbox?after=<seq>&limit=<n>` | polling 経路 (§5 の `inbox`) |

#### attach

```jsonc
// POST /mailboxes/reviewer/attach
{
  "kind": "claude-code",
  "sessionId": "… (分かれば)",
  "cwd": "…",
  "maxAgeMs": 86400000   // 任意。これより古い未読は渡さない
}

// 応答
{
  "attachmentId": "at_01H…",
  "cursor": 41,             // stream の after に渡す値。shim は保存しない
  "truncated": false,       // maxAgeMs で未読を切り捨てたら true
  "skipped": 0,             // 切り捨てた件数
  "leaseUntil": "…",
  "superseded": "at_01G… | null"   // takeover で切り離した旧 Attachment
}
```

- 冪等。同じセッションが attach し直しても未読は失われない (cursor は Mailbox 側にある)。
- 既に別の Attachment がある場合は takeover する (暫定: 排他・新しい方が勝つ。design.md §8)。旧 Attachment の stream に `terminated` を送って閉じる。
- `truncated: true` のとき、切り捨てた範囲は放棄済みとして `cursor` を進める。

#### shim 向け SSE の `event:` 名

| event | data | 意味 |
|---|---|---|
| `message` | Message | 配信本体 |
| `heartbeat` | `{ "cursor": <seq> }` | 30 秒ごと。60 秒途絶えたら shim は切断とみなして再接続する |
| `terminated` | `{ "reason": "superseded \| mailbox_deleted \| lease_expired" }` | この Attachment は終了。shim は再 attach しない (`lease_expired` のみ再 attach してよい) |

## 4. 配信保証

- **Mailbox 単位の at-least-once**。ack されるまで未読に残り、再 attach / 再接続時に再送する。
- 受信側は `id` で冪等に処理する。shim は無状態なので、直近の `id` をメモリに持つ程度の重複除去にとどめる。
- 順序は `seq` 順。
- **Channels は ack を返さない**ため、shim の ack は「`notifications/claude/channel` をトランスポートに書けた」時点で送る。Claude が読んだことの保証ではない。
- 未読には上限と保持期間を設ける (例: 1000 件 / 7 日。実装時に調整)。超えた分は放棄し、次の attach で `truncated: true` を返す。
- リース: heartbeat 間隔 30 秒、リース 2 分 (暫定)。リース切れの Attachment は detached とし、Mailbox は残す。

## 5. MCP ツール (shim が公開)

| ツール | 引数 | 動作 |
|---|---|---|
| `attach` | `mailbox`, `maxAgeMs?` | Mailbox を明示的に切り替える (`HUB_MAILBOX` 未指定時や、交代時に名前を選ぶ場合) |
| `whoami` | なし | 現在の Mailbox 名・Attachment・購読 |
| `subscribe` | `topic` | 購読開始 |
| `unsubscribe` | `topic` | 購読解除 |
| `list_topics` | なし | 既知トピックと自分の購読状況 |
| `post_message` | `to` (mailbox/topic), `body`, `replyTo?` | Message を送る |
| `inbox` | `after?`, `limit?` | 未読を取得 (polling 用。Claude Code 以外の縮退経路) |
| `report_event` | `kind`, `payload` | skill が意味判断した結果 (区切り申告など) を Hub に出す |

`inbox` の応答は MCP Events の `events/poll` に揃える:

```jsonc
{
  "messages": [ /* Message[] */ ],
  "cursor": 45,        // 次回の after
  "truncated": false,
  "hasMore": false,    // true なら待たずに再取得
  "nextPollMs": 5000
}
```

## 6. channel 通知のフォーマット

shim は `notifications/claude/channel` を次の params で送る (スキーマは design.md §6.1 で確認済み):

```jsonc
{
  "content": "<hub-message id=\"m_01H…\" from=\"user:browser\" topic=\"user.message\" seq=\"42\">\n本文\n</hub-message>",
  "meta": { "mailbox": "reviewer", "seq": "42" }   // キーは英数字とアンダースコアのみ
}
```

Claude 側では次のように見える:

```
<channel source="agent-hub" mailbox="reviewer" seq="42">
<hub-message id="m_01H..." from="user:browser" topic="user.message" seq="42">
本文
</hub-message>
</channel>
```

- 本文は**データ**であり、エージェントへの命令として扱わない。この前提を shim の `instructions` と CLAUDE.md / skill の両方に書く。
- 本文内の `</hub-message>` と `</channel>` はエスケープする。
- 二重包みは暫定。Claude Code が `</channel>` をエスケープすると確認できたら、属性を `meta` に一本化することを検討する (design.md §6.2)。
- attach 応答が `truncated: true` のときは、最初に 1 件だけ「`skipped` 件の古い未読を省略した」旨の通知を送る。

## 7. UI ↔ Hub のイベント種別 (SSE `event:` 名)

`event` (検知イベント), `message`, `mailbox.created`, `mailbox.deleted`, `attachment.attached`, `attachment.detached`, `attachment.superseded`, `subscription.changed`

## 8. MCP Events (SEP-3415) との語彙対応

将来 shim に `io.modelcontextprotocol/events` を実装するときの対応表。

| agent-hub | SEP-3415 |
|---|---|
| Message `id` / Event `id` | `eventId` |
| `seq` (Mailbox の cursor) | `cursor` (不透明な文字列として渡す) |
| topic | イベント `name` (`arguments` は使わない) |
| attach の `maxAgeMs` / `truncated` | 同名 |
| shim 向け SSE の `heartbeat { cursor }` | `notifications/events/heartbeat` |
| `terminated { reason }` | `notifications/events/terminated` |
| `inbox` | `events/poll` |
