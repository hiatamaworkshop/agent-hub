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
- エラー応答: `{ "error": "<code>", "message"?: "…", "issues"?: [{ "path", "message" }] }`。本文の上限超過 (413) も同じ形で返す。
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
- 初回の attach で自動作成する。削除は `DELETE /mailboxes/:name` の明示操作のみ。接続中 (attach 中) の Mailbox は削除できない (409)。
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
- パスは `HUB_ROLES_FILE` (既定はリポジトリ直下の `roles.json`。相対パスは起動したフォルダから解決する)。Hub 起動時に 1 度だけ読み、変更は再起動で反映する。見本は `roles.example.json`。
- 項目: `description` (必須、文字列) と `subscribe` (必須、トピック名の配列。Mailbox 名と同じ規則)。**それ以外の項目は読み捨てず保持する**。後でメッセージの形の宣言 (design.md §3.11) を足すときに形を変えずに済ませるため。今の Hub は参照しない。
- 形が違うとき (JSON として読めない、role 名や topic 名が規則に合わない、必須の項目がない・型が違う) は、Hub が起動時に止まり、ファイル名と場所を出す。黙って既定に戻さない。
- ファイルがないときは P0 と同じ動きをする (role 名は検証せず、既定購読も説明もない)。
- `description` は shim が MCP の `instructions` に差し込む (attach の `roleDescription`。shim は initialize より前に attach して取る。design.md §3.7)。
- 定義にない role での attach は 400 `unknown_role` (ファイルがあるとき)。

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
  "id": "e_…",
  "ts": "2026-10-16T12:00:00Z",
  "kind": "turn.end | question | question.answered | permission | notification | session.boundary",
  "source": "claude-code",
  "sessionId": "…",
  "mailbox": "reviewer (解決できた場合だけ)",
  "changes": { "head": "…", "changed": ["…"], "untracked": ["…"] },
  "payload": { "...": "hook の入力をそのまま (agent_hub_git を含むことがある)" }
}
```
- hook からは HTTP hook が入力 JSON をそのまま `POST /events` に送ってくる (design.md §6.1b)。Hub はそれを `payload` にそのまま入れ、変換で `kind` を決める。`source` は変換したクライアント (今は `claude-code` だけ) で、`payload` の形はこれで決まる。
- Claude Code の hook 用の変換 (`src/hub/events.ts`):

| hook 入力 | `kind` |
|---|---|
| `Stop` | `turn.end`。入力に `agent_hub_git` があれば `changes` に載せる (下の「変更の事実」) |
| `PreToolUse` + `tool_name: AskUserQuestion` | `question` |
| `PostToolUse` + `tool_name: AskUserQuestion` | `question.answered` |
| `Notification` + `notification_type: permission_prompt` | `permission`。ただし、同じ session の直前の Event が 60 秒以内の `question` なら取り込まない (質問の表示でも出るため。design.md §6.1c) |
| ほかの `Notification` (`idle_prompt`、`agent_needs_input`、`elicitation_dialog` など) | `notification`。種類は `payload.notification_type` で見る |
| それ以外の hook、`AskUserQuestion` 以外のツール | 取り込まない |

- **変更の事実** (`changes`、design.md §3.11 の未決 1 の決定): `tools/hooks/post-event.mjs` (Stop の command hook) が入力に足す `agent_hub_git` を検査して `changes` に載せる。Hub は git を実行しない。
  - 形: `agent_hub_git: { head: string, changed: string[], untracked: string[] }`。`head` は HEAD の full sha (1〜64 文字)、`changed` は `git diff --name-only HEAD`、`untracked` は `git ls-files --others --exclude-standard`。パスはリポジトリのルートからの相対パスで、どちらの配列も 1000 件まで。
  - 形が合わなければ `changes` だけ捨て、Event は記録する。`payload` には入力のまま残る。欄がない古い hook は従来どおり (`changes` なし)。
  - UI は `turn.end` に `changed + untracked` の件数を出す。`changes` がなければ何も出さない。
- `report_event` からは `kind` を明示して送る (`session.boundary` はこの経路用。`report_event` は後回し。design.md §3.4)。
- Event は UI に出すだけで、トピックとして Mailbox には配信しない (design.md §9-2)。
- 変換はクライアントごとに分けて持つ。他のクライアントの hook は、別の変換で同じ `kind` に揃える。Hub の保存形式は `kind` だけに依存する (design.md §3.7)。UI は表示の中身 (質問文など) を読むために `source` ごとに `payload` のキーを知る。
- `mailbox` は Hub が次の順で解決する: `payload.session_id` に対応する Mailbox (shim の attach の申告か、下の記録) → `X-Hub-Mailbox` ヘッダー (Mailbox 名の規則に合うときだけ) → `payload.cwd` のフォルダ名 (その名前の Mailbox があるときだけ)。解決できなければ空のまま UI に出す (design.md §3.4)。
  ヘッダーか cwd で解決できたら、その `session_id` を覚えて以後は第一手段で引く (Hub のメモリだけ。再起動したら shim の attach で戻る)。
- `id` は上流に一意の値があるときだけ決定的に作る。今は `question` / `question.answered` だけで、`session_id` と `tool_use_id` から作る。同じ `id` が再び届いたら記録せず、`duplicate: true` を返す。
  `Stop` と `Notification` には一意の値がない (同じ prompt の中で何度も出うる) ので Hub が採番する。違う待ちを 1 つにまとめて隠すより、重複を見せる方を選んでいる。

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
| POST | `/events` | Event を登録。登録後 UI に SSE (`event`) で配信。HTTP hook の入力 JSON をそのまま受け付ける (ヘッダー `X-Hub-Mailbox` 任意)。応答は 200 で、取り込んだら `{ id, kind, mailbox, duplicate }`、取り込まなかったら `{ ignored: "<理由>" }` (`unsupported_hook` / `unsupported_tool` / `question_prompt` / `no_hook_event_name`)。hook の判断には関与しない。本文が JSON オブジェクトでなければ 400、1MB を超えると 413 `payload_too_large` |
| GET | `/events?limit=<n>` | 新しい方から `limit` 件 (既定 100、最大 1000) を古い順に返す。応答 `{ "events": [...] }` |
| POST | `/messages` | Message を作成して配信 (宛先は `to`)。body は `kind` / `to` / `body` / `replyTo?`。応答は 201 で、作成した Message に `recipients` (配信先 Mailbox 名の配列。未接続も含む) を足したもの。`recipients` は応答にだけ付き、Message には保存しない。`user` 宛て以外で空なら誰にも届いていない (受理はする)。`replyTo` が存在しなければ 400。本文上限 1MB (超えると 413 `payload_too_large`) |
| GET | `/messages?after=<seq>&limit=<n>` | 履歴取得 (`limit` 既定 100、最大 1000)。応答 `{ "messages": [...], "lastSeq": <seq> }` |
| GET | `/mailboxes` | Mailbox 一覧 (role・実効購読・未読数・Attachment の状態) |
| GET | `/roles` | role 定義の一覧 (**未実装**。P2 で roles.json の読み込みは入ったが、この API はまだない。必要になったら足す) |
| DELETE | `/mailboxes/:name` | Mailbox を削除し、応答は 200 `{}`。購読・role・cursor・未読の状態を消す。Message のログは消さない。接続中 (attach 中) の Mailbox は削除せず 409 `mailbox_attached` (先に detach する)。未知の名前は 404 `mailbox_not_found`。SSE `mailbox.deleted` (`{ name }`) を流す。同名で作り直すと cursor は削除時点の `seq` から始まる (§2) |

### UI 向け
| メソッド | パス | 内容 |
|---|---|---|
| GET | `/` | UI の HTML。`?token=` 付きなら cookie を設定してリダイレクト (§1) |
| GET | `/stream` | SSE。Event / Message / Mailbox・Attachment の状態変化を流す |
| POST | `/messages/:id/forward` | 無編集転送。body: `{ "to": {...} }` |
| GET | `/settings` | カスタムコマンドの設定。`{ "version": 1, "commands": [{ "name", "text" }] }`。ファイルがなければ空。手編集の `defaultTo` (文字列 `<type>:<id>`) があれば併せて返し、なければ省く (形式が合わない値は無視する)。毎回ファイルから読む。壊れていれば 500 `settings_invalid` (中身は返さない) |
| PUT | `/settings` | 設定を保存。body `{ "commands": [...] }` を検証し、保存後の設定を返す。違反は 400 (英語の `message`)。本文上限 64KB (超えると 413 `payload_too_large`)。ファイルの commands 以外のキーは保持する (`defaultTo` を含む。PUT は `defaultTo` を受け付けず、変えない)。壊れていたファイルは `settings.json.bak` に退避してから書く。保存先は `HUB_DATA_DIR/settings.json`。name は `^[a-z0-9][a-z0-9_-]{0,31}$`、重複不可、最大 100 個、text は 1〜8000 文字 |
| POST | `/files` | 画像を 1 枚保存する。本文は生のバイト列で、`Content-Type` は使わずデコードして判定する。PNG / JPEG / GIF / WebP のみ (SVG やデコードできないものは 400)。長辺 `HUB_FILE_MAX_EDGE` (既定 1568) に収まるよう縮小し、EXIF を落として再エンコードする。20MB を超えると 413 `file_too_large`。`?persistent=1` で持続扱いにする。応答は記録 (新規は 201、同じ内容の再送は既存の記録を 200 で返す) |
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
| POST | `/attachments/:id/heartbeat` | リース延長。応答は `{ "leaseUntil": "…" }`。stream を開いていないクライアント向け (§4)。存在しない Attachment は 404 |
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
- 既に別の Attachment がある場合は takeover する (排他・新しい方が勝つ。design.md §9-1)。旧 Attachment の stream に `terminated` を送って閉じる。
- `truncated: true` のとき、切り捨てた範囲は放棄済みとして `cursor` を進める。
- Attachment は Hub のメモリにだけあり、永続化しない。Hub の再起動後は stream / ack が 404 (`attachment_not_found`) になるので、shim は attach し直す。
  attach し直したら、stream の `after` は応答の `cursor` から数え直す (`data/` を消した Hub では seq が 1 から振り直されるため、前の Hub の seq を使わない)。
  `terminated` を受け取った後は attach し直さない (取り返しの応酬を避ける)。
- **role の検証**: `roles.json` があるとき、定義にない role は 400 `unknown_role` で拒み、Mailbox も作らない。`role` を省いた (undefined) ときと `null` は通す (`null` は role を外す)。`roles.json` がないときは role 名を照合せず受け付ける (P0 と同じ)。
- **`roleDescription`**: 持っている role の `description`。定義がない・role がない・`roles.json` がないときは `null`。
- **P2 で残っている範囲**: `maxAgeMs` は受け取るが切り捨てはしない (`truncated: false`)。

#### stream

- 開くと `after` (省略時 0) と Mailbox の `cursor` の大きい方より後の未読を `seq` 順に送り、続けて新着を送る。SSE の `id:` には `seq` を入れる。
- 同じ Attachment で stream を開き直すと、古い stream は `terminated` なしで閉じる。
- 相手から切られた stream が 15 秒開き直されなければ、Hub はその Attachment を detach する (`reason: "disconnected"`)。
  Windows では shim が kill されると終了処理 (`DELETE /attachments/:id`) が走らないため。shim の再接続はこの猶予内に収まる前提。
  attach の後に一度も stream を開かない Attachment は、この猶予ではなくリース (§4) で detach する (`reason: "lease_expired"`)。
- `DELETE /attachments/:id` (detach) でも stream は `terminated` なしで閉じる (shim 自身が切ったため。`reason: "closed"`)。
- detach した Attachment は、次の attach か Mailbox の削除まで `GET /mailboxes` の `detached` に残る (Hub のメモリのみ。再起動で消える)。

#### 応答の形

- `GET /mailboxes`: `{ "mailboxes": [Mailbox + { "effectiveSubscriptions", "unread": <件数>, "attachment": Attachment | null, "detached": DetachedAttachment | null, "takeover": { "at", "previous": Attachment } | null }] }`
  - `detached` は接続していない Mailbox で最後に detach した Attachment に `detachedAt` と `reason` (`closed` / `disconnected` / `lease_expired`) を足したもの。接続中・この Hub の起動後に attach がない・takeover で切り離されただけのときは `null`。古い Hub はこの項目を返さない
  - `takeover` は今の Attachment が takeover で始まったときの時刻 (`at`) と切り離した旧 Attachment (`previous`)。今の Attachment が終わるまで出す (Hub のメモリのみ)。それ以外は `null`。古い Hub はこの項目を返さない
- `PUT` / `DELETE /mailboxes/:name/subscriptions/:topic`: `{ "subscriptions": [...], "effectiveSubscriptions": [...] }`。Mailbox がなければ 404
- `DELETE` で外せるのは**個別購読だけ**。role の既定購読 (`roles.json` の `subscribe`) のトピックは外れず、`effectiveSubscriptions` に残る。応答の形は変えていない。残ったかどうかは `effectiveSubscriptions` で分かる (shim の `unsubscribe` ツールは、残ったときに `note` を足す)。
- `POST /attachments/:id/ack`: `{ "cursor": <進めた後の値> }`。`cursor` は後退せず、採番済みの `seq` を超えない

#### shim 向け SSE の `event:` 名

| event | data | 意味 |
|---|---|---|
| `message` | Message | 配信本体 |
| `heartbeat` | `{ "cursor": <seq> }` | 30 秒ごと。60 秒途絶えたら shim は切断とみなして再接続する |
| `terminated` | `{ "reason": "superseded \| lease_expired" }` | この Attachment は終了。shim は再 attach しない (`lease_expired` のみ再 attach してよい)。stream を開いている間はリースが切れないので、Hub は今 `lease_expired` を送らない |

## 4. 配信保証

- **Mailbox 単位の at-least-once**。ack されるまで未読に残り、再 attach / 再接続時に再送する。
- 受信側は `id` で冪等に処理する。shim は無状態なので、直近の `id` をメモリに持つ程度の重複除去にとどめる。
- 順序は `seq` 順。
- **Channels は ack を返さない**ため、shim の ack は「`notifications/claude/channel` をトランスポートに書けた」時点で送る。Claude が読んだことの保証ではない。
- 未読には上限と保持期間を設ける (例: 1000 件 / 7 日。実装時に調整)。超えた分は放棄し、次の attach で `truncated: true` を返す。
- リース: 2 分 (暫定)。attach・stream を開く・ack・`POST /attachments/:id/heartbeat` で延びる。stream を開いている間は期限が来ても延ばし直す。stream を開かないクライアントは 2 分より短い間隔 (例: 30 秒) で heartbeat を送る。
  リース切れの Attachment は detached (`reason: "lease_expired"`) とし、Mailbox は残す。shim は stream を開いているので heartbeat を送らない (design.md §3.3)。

## 5. MCP ツール (shim が公開)

| ツール | 引数 | 動作 |
|---|---|---|
| `attach` | `mailbox`, `role?`, `maxAgeMs?` | Mailbox を明示的に切り替える (`HUB_MAILBOX` 未指定時や、交代時に名前を選ぶ場合) |
| `whoami` | なし | 現在の Mailbox 名・role・Attachment・実効購読 |
| `subscribe` | `topic` | 個別購読を追加 |
| `unsubscribe` | `topic` | 個別購読を解除 |
| `list_topics` | なし | 既知トピックと自分の購読状況 (role 由来か個別かを区別) |
| `post_message` | `kind`, `body`, `to?`, `reply_to?` | Message を送る。`kind` は必須。`to` は channel の属性と同じ `type:id` 表記 (`mailbox:rev-a`、`user:browser` など)。`reply_to` があれば `to` は省略でき、送り手に返る。結果は `id` / `seq` / `to` と、`user` 宛てなら `delivered` (UI に出る旨。Mailbox を経由しないので `recipients` は返さない。空の配列をモデルが未達と読んだため)、それ以外なら `recipients`。`recipients` が空なら `warning` を添える |
| `inbox` | `after?`, `limit?` | 未読を取得 (polling 用。Claude Code 以外の縮退経路) |
| `report_event` | `kind`, `payload` | skill が意味判断した結果 (区切り申告など) を Hub に出す。後回し (design.md §3.4) |

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
| Channels (Claude Code) | `meta` (外側の `<channel>` タグの属性になる)。**`files` の既知のキーだけ**を載せる (下記) | 本文そのまま (`</channel>` だけエスケープ) |
| `inbox()` (polling) | `<hub-message>` タグの属性 | `<hub-message>` の中 (`</hub-message>` をエスケープ) |

`meta` を持つメッセージは、`inbox()` では全部の `meta` を、Channels では次の制限を付けて、属性 `meta` (JSON 文字列) を 1 つ足す。Hub 付与の属性とは名前が重ならないので、送り手が偽れない。
**Channels に載せるのは `files` の要素のうち既知のキー `id` `mime` `size` `width` `height` `path` `error` だけ**で、ほかのキーと送り手の `meta` は載せない (属性値の `"` `<` `>` `&` の扱いが未確認のため。design.md §6.2-4)。値は変換しない。残るものがなければ `meta` 属性を足さない。ほかの送り手の `meta` は `inbox()` からだけ読める。確認できたら制限を外す。shim は配信の直前に `meta.files` の各画像を取得し、配信用のコピーに `path` (ローカルのパス。区切りは `/`) か `error` を足す。Hub の値は書き換えない。`error` は `expired` (Hub で期限切れ) か `fetch_failed` (取得できなかった) で、メッセージは落とさず届ける。想定外の形の `meta` は触らずに通す。取得と保存の詳細は design.md §3.10。

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

`event` (検知イベント), `message`, `mailbox.created`, `mailbox.deleted`, `mailbox.acked`, `attachment.attached`, `attachment.detached`, `attachment.superseded`, `subscription.changed`

- `event` は記録した Event (§2)。重複 (`duplicate: true`) と取り込まなかったものは流さない。
- `mailbox.created` は作成された Mailbox (`name` `role` `createdAt` `subscriptions` `cursor` `attachment`。作成直後なので `attachment` は null)。`mailbox.deleted` は `{ "name": "<名前>" }`。UI は両方で一覧を取り直す。
- `attachment.detached` は §3 の `detached` と同じ形 (Attachment + `detachedAt` + `reason`)。`attachment.superseded` は Attachment + `reason: "superseded"`。UI はどちらでも一覧を取り直す。
- `mailbox.acked` は `{ "name": "<名前>", "cursor": <進めた後の値> }`。`POST /attachments/:id/ack` で cursor が実際に進んだときだけ流す (同じ値・後退では流さない)。未読数が減るのはこのとき。UI は一覧を取り直す。古い UI は知らない名前として無視し、古い Hub は送らないので、どちらの組み合わせでも壊れない。

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
