# プロトコル仕様 (ドラフト)

実装時に検証結果を踏まえて更新すること。フィールド名は暫定。
用語とモデルの背景は design.md §3.3 (Mailbox と Attachment)、§3.5 (購読と role)、§3.6 (メッセージ種別)、§7 (MCP Events との関係) を参照。

## 1. 共通

- ベース URL: `http://127.0.0.1:<port>` (既定 `7777`、`HUB_PORT` で変更可)
- 認証: 全エンドポイントで必須 (UI の静的ファイル配信を除く)。
  - shim / hooks: `Authorization: Bearer <token>`。
  - ブラウザ: cookie。`GET /?token=<token>` でトークンを検証し、`HttpOnly; SameSite=Strict` の cookie を設定して `/` にリダイレクトする。
    cookie 認証の状態変更リクエストは `Origin` が Hub 自身のオリジンでなければ 403。
  - 認証なし・不正は 401。`Authorization` ヘッダーがあれば cookie より優先し、それだけで判定する。
  - cookie の値はトークンそのものではなく、トークンから導いた値にする。
- エラー応答: `{ "error": "<code>", "message"?: "…", "issues"?: [{ "path", "message" }] }`。
- 時刻: ISO 8601 UTC 文字列。
- id: 文字列 (ULID を推奨。時系列ソート可能)。
- `seq`: Hub 全体で単調増加する整数。メッセージの順序と cursor に使う。
- Mailbox 名・role 名: `^[a-z0-9][a-z0-9_.-]{0,63}$`。URL パスにそのまま載せる。

## 2. データモデル

### Mailbox (長寿命の論理宛先)
```json
{
  "name": "rev-a",
  "role": "reviewer | null",
  "createdAt": "…",
  "subscriptions": ["agent.main"],
  "cursor": 41,
  "attachment": "at_01H… | null"
}
```
- `subscriptions`: 個別購読のみ。実効購読は role の既定購読との和で、Hub が毎回計算する。
- `cursor`: ack 済みウォーターマーク。この `seq` 以下は配送済み (または `maxAgeMs` で放棄済み)。
- 未読 = この Mailbox 宛て (直接宛先 + 自分の role 宛て + 実効購読トピック) で `seq > cursor` のメッセージ。
- 初回の attach で自動作成する。削除は明示操作のみ。
- 作成時の `cursor` は 0。作成前に届いた直接宛て・role 宛ても未読になる (Mailbox は論理宛先なので、受け手がまだいなくても届く)。
  同名を削除して作り直した場合は、削除時点の `seq` から始める (削除前の直接宛ては再送しない)。
- トピック宛ては、**購読した時点の `seq` より後**のものだけが未読になる。role の既定購読は、その role を持った時点から数える。
  購読しただけで過去ログ全体が流れ込むのを防ぐため。

### Role 定義 (Hub の設定ファイル `roles.json`)
```json
{
  "reviewer": {
    "description": "変更のレビュー担当。review 依頼を読み、指摘を reply で返す",
    "subscribe": ["review.request"]
  },
  "deployer": {
    "description": "デプロイ担当。…",
    "subscribe": ["deploy.request"]
  }
}
```
- パスは `HUB_ROLES_FILE` (既定 `./roles.json`)。Hub 起動時に読み、変更は再起動で反映する (P2 で再読み込みを検討)。
- `description` は shim が MCP の `instructions` に差し込む。
- 定義にない role での attach は 400。

### Attachment (一時的なセッション接続)
```json
{
  "attachmentId": "at_01H…",
  "mailbox": "rev-a",
  "client": "claude-code | codex | other",
  "sessionId": "… (環境変数 CLAUDE_CODE_SESSION_ID。なければ省略)",
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
- hook からは HTTP hook が入力 JSON をそのまま `POST /events` に送ってくる (design.md §6.1b)。Hub はそれを `payload` に入れ、`hook_event_name` から `kind` を決める
  (`Stop` → `turn.end`、`Notification` → `notification`、`PreToolUse` + `AskUserQuestion` → `question`)。`report_event` からは `kind` を明示して送る。
- この対応付けは Claude Code の hook 用の変換で、クライアントごとに分けて持つ。他のクライアントの hook は、別の変換で同じ `kind` に揃える。`payload` は元の JSON のまま残し、Hub の保存形式と UI は `kind` だけに依存する (design.md §3.7)。
- `mailbox` は Hub が次の順で解決する: `payload.session_id` に一致する Attachment (shim の申告または記録済み) → `X-Hub-Mailbox` ヘッダー → `payload.cwd` のフォルダ名。解決できなければ空のまま UI に出す (design.md §3.4)。
- `id` は `session_id` と hook 固有の値 (`tool_use_id`、`prompt_id` など) から決定的に作る。

### Message
```json
{
  "id": "m_01H...",
  "seq": 42,
  "ts": "…",
  "kind": "request | reply | notice",
  "from": { "type": "user | mailbox", "id": "browser | rev-a", "role": "reviewer | null" },
  "to": { "type": "mailbox | role | topic | user", "id": "…" },
  "body": "本文 (文字列)",
  "replyTo": "m_… (kind=reply では必須)",
  "forwardedFrom": "m_… (無編集転送の場合)",
  "meta": { "files": [{ "id": "f_…", "mime": "image/png", "size": 27068, "width": 1568, "height": 784 }] }
}
```
- `kind`: 必須。列挙外は 400。`reply` で `replyTo` がなければ 400。意味は design.md §3.6。
- `from`: **Hub が付与する**。リクエストに含まれていても無視する。決め方は次のとおり。
  - cookie 認証 (ブラウザ): `user:browser`
  - Bearer + `X-Hub-Attachment: <attachmentId>` (shim): その Attachment の Mailbox と role。存在しない Attachment は 404
  - Bearer のみ (curl など): `user:cli`
- `to`: `replyTo` があれば省略でき、元メッセージの `from` (`user:browser` や `mailbox:rev-a`) が宛先になる。
- `to.type = user`: どの Mailbox にも配信せず、UI にだけ出る (ブラウザへの返信先。`from` と対称にするため)。
  `id` は Hub が付与する送り手と同じ `browser` / `cli` に限り、それ以外は 400 (`mailbox` のつもりで種類を誤選択した送信を受理しないため)。
- `to.type = role`: その role を持つ全 Mailbox に配信する。該当する Mailbox がなければ 400 ではなく受理し、後からその role で attach した Mailbox の未読になる。
- 無編集転送では `kind` も元のメッセージのまま運ぶ。
- `meta`: 任意。送り手が付ける JSON オブジェクト。直列化して 8KB まで。キーは `^[a-z][a-z0-9_]{0,31}$`。Hub が解釈するのは既知のキー `files` だけで、ほかのキーは触らずに通す。空の `{}` は保存しない。
- `meta.files`: `[{ "id": "f_…" }]` で送る (4 件まで。重複は 1 つにまとめる)。Hub は各 id が存在するかを確かめ (なければ 400、message に id)、保存するときは記録から `{ id, mime, size, width, height }` に書き直す。送り手が付けた mime や size は捨てる。

## 3. Hub の HTTP API

### 検知側 / 共通
| メソッド | パス | 内容 |
|---|---|---|
| POST | `/events` | Event を登録。登録後 UI に SSE で配信。HTTP hook の入力 JSON をそのまま受け付ける (ヘッダー `X-Hub-Mailbox` 任意)。応答は `{}` (hook の判断には関与しない) |
| POST | `/messages` | Message を作成して配信 (宛先は `to`)。body は `kind` / `to` / `body` / `replyTo?`。応答は 201 で、作成した Message に `recipients` (配信先 Mailbox 名の配列。未接続も含む) を足したもの。`recipients` は応答にだけ付き、Message には保存しない。`user` 宛て以外で空なら誰にも届いていない (受理はする)。`replyTo` が存在しなければ 400 |
| GET | `/messages?after=<seq>&limit=<n>` | 履歴取得 (`limit` 既定 100、最大 1000)。応答 `{ "messages": [...], "lastSeq": <seq> }` |
| GET | `/mailboxes` | Mailbox 一覧 (role・実効購読・未読数・Attachment の状態) |
| GET | `/roles` | role 定義の一覧 |
| DELETE | `/mailboxes/:name` | Mailbox を削除。接続中の Attachment には `terminated(mailbox_deleted)` を送る |

### UI 向け
| メソッド | パス | 内容 |
|---|---|---|
| GET | `/` | UI の HTML。`?token=` 付きなら cookie を設定してリダイレクト (§1) |
| GET | `/stream` | SSE。Event / Message / Mailbox・Attachment の状態変化を流す |
| POST | `/messages/:id/forward` | 無編集転送。body: `{ "to": {...} }` |
| GET | `/settings` | カスタムコマンドの設定。`{ "version": 1, "commands": [{ "name", "text" }] }`。ファイルがなければ空。手編集の `defaultTo` (文字列 `<type>:<id>`) があれば併せて返し、なければ省く (形式が合わない値は無視する)。毎回ファイルから読む。壊れていれば 500 `settings_invalid` (中身は返さない) |
| PUT | `/settings` | 設定を保存。body `{ "commands": [...] }` を検証し、保存後の設定を返す。違反は 400 (英語の `message`)。本文上限 64KB。ファイルの commands 以外のキーは保持する (`defaultTo` を含む。PUT は `defaultTo` を受け付けず、変えない)。壊れていたファイルは `settings.json.bak` に退避してから書く。保存先は `HUB_DATA_DIR/settings.json`。name は `^[a-z0-9][a-z0-9_-]{0,31}$`、重複不可、最大 100 個、text は 1〜8000 文字 |
| POST | `/files` | 画像を 1 枚保存する。本文は生のバイト列で、`Content-Type` は使わずデコードして判定する。PNG / JPEG / GIF / WebP のみ (SVG やデコードできないものは 400)。長辺 `HUB_FILE_MAX_EDGE` (既定 1568) に収まるよう縮小し、EXIF を落として再エンコードする。20MB を超えると 413。`?persistent=1` で持続扱いにする。応答は記録 (新規は 201、同じ内容の再送は既存の記録を 200 で返す) |
| GET | `/files/:id` | 保存した画像本体。`Content-Type` は記録の mime、`X-Content-Type-Options: nosniff`、`Content-Security-Policy: sandbox; default-src 'none'`、`Cache-Control: private, max-age=3600`。なければ 404 |
| GET | `/files/:id/meta` | 記録。`{ id, mime, size, width, height, persistent, createdAt, resized, original: { mime, size, width, height } }`。なければ 404 |
| PATCH | `/files/:id` | body `{ "persistent": true }` または `false` で持続扱いを切り替える。未知のキーや型違いは 400 |

- `id` は元の入力バイト列の sha256 の先頭 32 桁 (`f_` + 32 桁の 16 進)。不正な形式は 404。
- 持続でない画像は `HUB_FILE_TTL_DAYS` (既定 7 日。0 なら掃除しない) を過ぎると消す。起動時と 1 時間ごとに行い、消した件数をログに出す。消えた画像を参照するメッセージは履歴に残るので、表示側は 404 を「期限切れ」として扱う。

### shim 向け
| メソッド | パス | 内容 |
|---|---|---|
| POST | `/mailboxes/:name/attach` | Mailbox に attach (なければ作成)。下記参照 |
| GET | `/attachments/:id/stream?after=<seq>` | SSE。Mailbox の未読を `seq` 順に流し、以後の新着も流す |
| POST | `/attachments/:id/ack` | 受信確認。body: `{ "upTo": <seq> }`。Mailbox の `cursor` を進める |
| POST | `/attachments/:id/heartbeat` | リース延長。応答に `leaseUntil` |
| DELETE | `/attachments/:id` | detach (セッション終了時。Mailbox は残る) |
| PUT | `/mailboxes/:name/subscriptions/:topic` | 購読 |
| DELETE | `/mailboxes/:name/subscriptions/:topic` | 購読解除 (個別購読のみ。role の既定購読は外せない) |
| GET | `/mailboxes/:name/inbox?after=<seq>&limit=<n>` | polling 経路 (§5 の `inbox`) |

#### attach

```jsonc
// POST /mailboxes/rev-a/attach
{
  "client": "claude-code",
  "role": "reviewer",    // 任意。指定すると Mailbox の role を更新する。省略時は既存の role を保つ
  "sessionId": "… (環境変数 CLAUDE_CODE_SESSION_ID。なければ省略)",
  "cwd": "…",
  "maxAgeMs": 86400000   // 任意。これより古い未読は渡さない
}

// 応答
{
  "attachmentId": "at_01H…",
  "role": "reviewer | null",
  "roleDescription": "… | null",   // shim が instructions に差し込む
  "cursor": 41,             // stream の after に渡す値。shim は保存しない
  "truncated": false,       // maxAgeMs で未読を切り捨てたら true
  "skipped": 0,             // 切り捨てた件数
  "leaseUntil": "…",
  "superseded": "at_01G… | null"   // takeover で切り離した旧 Attachment
}
```

- 冪等。同じセッションが attach し直しても未読は失われない (cursor は Mailbox 側にある)。
- 既に別の Attachment がある場合は takeover する (暫定: 排他・新しい方が勝つ。design.md §9)。旧 Attachment の stream に `terminated` を送って閉じる。
- `truncated: true` のとき、切り捨てた範囲は放棄済みとして `cursor` を進める。
- Attachment は Hub のメモリにだけあり、永続化しない。Hub の再起動後は stream / ack が 404 (`attachment_not_found`) になるので、shim は attach し直す。
  `terminated` を受け取った後は attach し直さない (取り返しの応酬を避ける)。
- **P0 の範囲**: role 名は `roles.json` と照合せず受け付け、`roleDescription` は常に `null`。リースは値を返すだけで期限切れを判定しない。`maxAgeMs` は受け取るが切り捨てはしない (`truncated: false`)。いずれも P2。

#### stream

- 開くと `after` (省略時 0) と Mailbox の `cursor` の大きい方より後の未読を `seq` 順に送り、続けて新着を送る。SSE の `id:` には `seq` を入れる。
- 同じ Attachment で stream を開き直すと、古い stream は `terminated` なしで閉じる。
- stream が開かれていない状態 (attach 直後、または相手から切られた後) が 15 秒続いた Attachment は Hub が detach する (UI には `attachment.detached` と `reason: "disconnected"`)。
  Windows では shim が kill されると終了処理 (`DELETE /attachments/:id`) が走らないため。shim の再接続はこの猶予内に収まる前提。P2 のリースで置き換える。
- `DELETE /attachments/:id` (detach) でも stream は `terminated` なしで閉じる (shim 自身が切ったため)。

#### 応答の形

- `GET /mailboxes`: `{ "mailboxes": [Mailbox + { "effectiveSubscriptions", "unread": <件数>, "attachment": Attachment | null }] }`
- `PUT` / `DELETE /mailboxes/:name/subscriptions/:topic`: `{ "subscriptions": [...], "effectiveSubscriptions": [...] }`。Mailbox がなければ 404
- `POST /attachments/:id/ack`: `{ "cursor": <進めた後の値> }`。`cursor` は後退せず、採番済みの `seq` を超えない

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
| `attach` | `mailbox`, `role?`, `maxAgeMs?` | Mailbox を明示的に切り替える (`HUB_MAILBOX` 未指定時や、交代時に名前を選ぶ場合) |
| `whoami` | なし | 現在の Mailbox 名・role・Attachment・実効購読 |
| `subscribe` | `topic` | 個別購読を追加 |
| `unsubscribe` | `topic` | 個別購読を解除 |
| `list_topics` | なし | 既知トピックと自分の購読状況 (role 由来か個別かを区別) |
| `post_message` | `kind`, `body`, `to?`, `reply_to?` | Message を送る。`kind` は必須。`to` は channel の属性と同じ `type:id` 表記 (`mailbox:rev-a`、`user:browser` など)。`reply_to` があれば `to` は省略でき、送り手に返る。結果は `id` / `seq` / `to` / `recipients`。`user` 宛て以外で `recipients` が空なら `warning` を添える |
| `inbox` | `after?`, `limit?` | 未読を取得 (polling 用。Claude Code 以外の縮退経路) |
| `report_event` | `kind`, `payload` | skill が意味判断した結果 (区切り申告など) を Hub に出す |

P0 で実装するのは `post_message` / `subscribe` / `unsubscribe` / `whoami`。いずれも `_meta["anthropic/alwaysLoad"]: true` を付ける (design.md §6.1c)。

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

送り手の属性は**本文と区別できる形**で渡す。経路ごとに形が違う。

| 経路 | 属性の置き場所 | 本文 |
|---|---|---|
| Channels (Claude Code) | `meta` (外側の `<channel>` タグの属性になる) | 本文そのまま (`</channel>` だけエスケープ) |
| `inbox()` (polling) | `<hub-message>` タグの属性 | `<hub-message>` の中 (`</hub-message>` をエスケープ) |

`meta` を持つメッセージは、どちらの経路でも属性 `meta` (JSON 文字列) を 1 つ足す。Hub 付与の属性とは名前が重ならないので、送り手が偽れない。shim は配信の直前に `meta.files` の各画像を取得し、配信用のコピーに `path` (ローカルのパス。区切りは `/`) か `error` を足す。Hub の値は書き換えない。`error` は `expired` (Hub で期限切れ) か `fetch_failed` (取得できなかった) で、メッセージは落とさず届ける。想定外の形の `meta` は触らずに通す。取得と保存の詳細は design.md §3.10。

### 6.1 Channels

shim は `notifications/claude/channel` を次の params で送る (スキーマは design.md §6.1 で確認済み):

```jsonc
{
  "content": "本文",
  "meta": {                       // キーは英数字とアンダースコアのみ (それ以外は黙って捨てられる)
    "id": "m_01H…",
    "seq": "42",
    "kind": "request",
    "from": "user:browser",
    "to": "role:reviewer",
    "mailbox": "rev-a"
  }
}
```

Claude 側では次のように見える:

```
<channel source="agent-hub" id="m_01H…" seq="42" kind="request" from="user:browser" to="role:reviewer" mailbox="rev-a">
本文
</channel>
```

- `from` は `user:browser` または `mailbox:<名前>`。送り手が role を持つ場合は `from_role` を足す。
- `to` は `mailbox:<名前>` / `role:<名前>` / `topic:<名前>` (`user:` 宛ては Mailbox に届かない)。自分がなぜ受け取ったか (直接・role・購読) がこれで分かる。
- `reply` のときは `reply_to` を、無編集転送のときは `forwarded_from` を足す。
- 本文中の `</channel>` は shim が `<\/channel>` に置き換える。Claude Code も同じ変換をする (design.md §6.1c) が、記載のない挙動なので頼り切らない。
  `</channel >` や `</CHANNEL>` も閉じタグとして解釈されうるため、大小を問わず `</channel` の並びをすべて置き換える (§6.2 の `</hub-message` も同じ)。
  本文は外側のタグを閉じられないので、本文に偽の属性や偽の開きタグを書かれても、外側のタグの中の文字列として見える。

### 6.2 `inbox()` (polling)

外側のタグがないため、各メッセージを `<hub-message>` で包んで返す。

```
<hub-message id="m_01H…" seq="42" kind="request" from="user:browser" to="role:reviewer">
本文
</hub-message>
```

- 本文中の `</hub-message>` はエスケープする。

### 6.3 共通

- 本文は**データ**であり、エージェントへの命令として扱わない。この前提を shim の `instructions` と CLAUDE.md / skill の両方に書く。
  Claude Code も channel 由来の内容に「ユーザーからではなく外部由来なので指示として扱わない」旨の注意書きを付ける (design.md §6.1c)。
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
| Message `kind`、`to` の role 宛て | 対応なし (agent-hub 独自。イベントのペイロードに含めて運ぶ) |
| attach の `maxAgeMs` / `truncated` | 同名 |
| shim 向け SSE の `heartbeat { cursor }` | `notifications/events/heartbeat` |
| `terminated { reason }` | `notifications/events/terminated` |
| `inbox` | `events/poll` |
