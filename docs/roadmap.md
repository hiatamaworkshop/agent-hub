# ロードマップ

各フェーズは「動く状態で終わる」ことを重視する。受け入れ条件を満たしてから次へ進む。

## P0: 1 セッションで往復する (完了 2026-10-16)

**ゴール**: ブラウザで書いたメッセージが Claude セッションに届き、Claude が `post_message` で返信し、ブラウザに表示される。

- [x] Channels の仕様を公式資料で確認し、結果を design.md §6.1 に追記
- [x] hook・MCP の仕様を公式資料で確認し、design.md §6.1b に追記
- [x] design.md §6.2 の Channels・hook 関連をプローブ (`tools/probe/`) で実機確認し、結果を §6.1c に記録
- [x] プロジェクト雛形 (package.json, tsconfig。作業順は [plan-p0.md](plan-p0.md))
- [x] Hub: 認証付き HTTP (Bearer + ブラウザ向け cookie)、`/messages`、`/stream` (SSE)、JSONL 追記ログ
- [x] Hub: Message の `kind` (`request` / `reply` / `notice`) の検証と、`from` の Hub 側付与
- [x] Hub: Mailbox の最小実装 (attach で作成、購読、cursor)。リースと takeover は P2
- [x] shim: channel MCP サーバー。`HUB_MAILBOX` で attach、Hub SSE 受信、`notifications/claude/channel` で push、`subscribe` / `post_message`
- [x] UI: 1 枚の HTML。メッセージ一覧 (ライブ、`kind` の表示)、送信フォーム (`kind` の選択、既定 `request`)
- [x] 起動手順を README に追記

**受け入れ条件**
1. Hub を起動し、Claude Code を channel 有効 (`--dangerously-load-development-channels`) で起動できる。
2. shim が `HUB_MAILBOX` (未指定ならフォルダ名) の Mailbox に attach する。
3. エージェントが `subscribe("user.message")` を呼ぶ。
4. ブラウザから `user.message` に送ると、Claude の会話に `<channel source="agent-hub">` として入る。
5. Claude が `post_message` (`kind: reply`) で返信すると、ブラウザに `kind` 付きで表示される。
6. トークンなしの API 呼び出しは 401。127.0.0.1 以外からは到達しない。
7. ブラウザは起動時に表示された `?token=` 付き URL で開くと cookie で認証され、以後 URL にトークンが残らない。

**確認結果** (2026-10-16、Claude Code 2.1.301 / Haiku 5.5 / Windows 11)
- 1〜5, 7: 実セッションとブラウザで確認。`mailbox:agent-hub` 宛て (直接) と、`subscribe("user.message")` 後の `topic:user.message` 宛て (購読) の両方が届き、
  Claude が `post_message` (`to` 省略) で返した reply が `user:browser` 宛てとして UI に出た。
  購読していない `topic:agent-hub` 宛てと `user:agent-hub` 宛ては届かなかった (仕様どおり)。
- 6: 実起動した Hub に curl でトークンなしの 401 を確認。netstat で `127.0.0.1:<port>` のみで待ち受けていることを確認。

**調整予定** (P0 の実使用で見つかった点。P1 と並行して行う)
- [x] 誰にも届かない送信に気づけない: `topic:agent-hub` (購読者なし) と `user:agent-hub` (`mailbox` のつもりで種類を誤選択) が受理され、無反応だった。
  - [x] UI の宛先を「種類 + 名前」の 2 入力から、ドロップダウン 1 本にする。選択肢は `/mailboxes` から作る (Mailbox / role / 購読中のトピック / `user:browser`)。購読者のいないトピック用に「トピックを手入力」だけ残す。種類と名前の食い違いを構造的になくす
  - [x] `POST /messages` の応答に配信先 Mailbox の一覧を含め、0 件なら UI に「届く Mailbox がない」と警告する (手入力のトピック向け)
  - [x] `user` 宛ての名前を `browser` / `cli` に限る (protocol.md も更新)
- [x] 溜まった一覧を整理できない: UI に Compact (Keep latest n、既定 10) を追加。古い分は表示から外して 1 本のスタブにまとめ、Expand で戻す。表示だけで Hub・未読・配信には影響しない
- [ ] `kind` の選択を色付きのトグルボタン (アイコン化) にし、一覧の色分けと揃える (見た目の改善。優先度は低い)

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
- 配信経路として plugin の monitor を Channels と比較する (design.md §6.2-3)
- Claude Code が MCP Events に対応したら、shim に `io.modelcontextprotocol/events` (`events/stream`) を追加する (design.md §7)
- デスクトップアプリ向けの画面操作ベース連携 (本プロジェクトの範囲外の可能性が高い)
- `kind` の追加 (交代時の引き継ぎ用 `handoff` など。design.md §3.6)
