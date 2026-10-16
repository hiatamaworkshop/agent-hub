# ロードマップ

各フェーズは「動く状態で終わる」ことを重視する。受け入れ条件を満たしてから次へ進む。

## P0: 1 セッションで往復する

**ゴール**: ブラウザで書いたメッセージが Claude セッションに届き、Claude が `post_message` で返信し、ブラウザに表示される。

- [x] Channels の仕様を公式資料で確認し、結果を design.md §6.1 に追記
- [x] hook・MCP の仕様を公式資料で確認し、design.md §6.1b に追記
- [ ] design.md §6.2 の 1〜4, 7 をプローブ (`tools/probe/`) で実機確認し、結果を §6 に記録
- [x] プロジェクト雛形 (package.json, tsconfig。作業順は [plan-p0.md](plan-p0.md))
- [ ] Hub: 認証付き HTTP (Bearer + ブラウザ向け cookie)、`/messages`、`/stream` (SSE)、JSONL 追記ログ
- [ ] Hub: Message の `kind` (`request` / `reply` / `notice`) の検証と、`from` の Hub 側付与
- [ ] Hub: Mailbox の最小実装 (attach で作成、購読、cursor)。リースと takeover は P2
- [ ] shim: channel MCP サーバー。`HUB_MAILBOX` で attach、Hub SSE 受信、`notifications/claude/channel` で push、`subscribe` / `post_message`
- [ ] UI: 1 枚の HTML。メッセージ一覧 (ライブ、`kind` の表示)、送信フォーム (`kind` の選択、既定 `request`)
- [ ] 起動手順を README に追記

**受け入れ条件**
1. Hub を起動し、Claude Code を channel 有効 (`--dangerously-load-development-channels`) で起動できる。
2. shim が `HUB_MAILBOX` (未指定ならフォルダ名) の Mailbox に attach する。
3. エージェントが `subscribe("user.message")` を呼ぶ。
4. ブラウザから `user.message` に送ると、Claude の会話に `<hub-message>` として入る。
5. Claude が `post_message` (`kind: reply`) で返信すると、ブラウザに `kind` 付きで表示される。
6. トークンなしの API 呼び出しは 401。127.0.0.1 以外からは到達しない。
7. ブラウザは起動時に表示された `?token=` 付き URL で開くと cookie で認証され、以後 URL にトークンが残らない。

## P1: 区切り・質問の検知

**ゴール**: エージェントが止まった/質問した時点がブラウザに出る。

- [ ] HTTP hook の設定例: `Stop` / `Notification` / `PreToolUse(AskUserQuestion)` → `POST /events` (`Authorization` と `X-Hub-Mailbox` をヘッダーで渡す)
- [ ] Hub: `sessionId` → Attachment → Mailbox の解決
- [ ] イベント ID を上流の値から決定的に生成し、`Stop` と `report_event` の重複を除去
- [ ] UI: 「質問待ち」「ターン終了」を Mailbox ごとに表示。時刻と該当内容
- [ ] `report_event` ツール (skill からの区切り申告)
- [ ] 検知イベントから、ブラウザ上で返信メッセージを作る導線

**受け入れ条件**
1. Claude が `AskUserQuestion` を呼ぶと、UI に質問内容が該当 Mailbox の下に出る。
2. ターン終了と許可待ちが区別して表示される。
3. UI の返信が該当セッションに届く。

## P2: 複数セッション・交代・メッセージパッシング

**ゴール**: 複数エージェントが購読ベースで互いにやり取りでき、交代や再起動をまたいで取りこぼさない。

- [ ] 複数 Mailbox の同時接続、Mailbox 一覧と接続状態・role・購読・未読数の UI 表示
- [ ] role: `roles.json` の読み込み、attach 時の role 指定 (`HUB_ROLE`)、既定購読との和で実効購読を計算、`to: role` 宛ての配信、`description` の `instructions` への差し込み
- [ ] Attachment のリースと heartbeat、detached 状態
- [ ] takeover (design.md §8 の方針決定後) と `terminated(superseded)`
- [ ] attach の `maxAgeMs` / `truncated` と、省略通知
- [ ] 無編集転送 (`/messages/:id/forward`) と UI ボタン
- [ ] `inbox()` による polling 経路 (Claude Code 以外向け。`events/poll` 互換の応答)
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

## 将来の検討 (未確定)

- 配信ルール (人間確認なしの自動転送) の opt-in 設計
- Channels の permission relay を使い、UI から tool 実行許可を出す (design.md §6.1)
- 配信経路として plugin の monitor を Channels と比較する (design.md §6.2-10)
- Claude Code が MCP Events に対応したら、shim に `io.modelcontextprotocol/events` (`events/stream`) を追加する (design.md §7)
- デスクトップアプリ向けの画面操作ベース連携 (本プロジェクトの範囲外の可能性が高い)
- `kind` の追加 (交代時の引き継ぎ用 `handoff` など。design.md §3.6)
