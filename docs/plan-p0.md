# P0 実装計画

[roadmap.md](roadmap.md) の P0 (1 セッションで往復する) を、コミット単位のステップに分けたもの。
各ステップは「テストが通る / 手で確認できる」状態で終える。

## 技術選定

| 項目 | 選択 | 理由 |
|---|---|---|
| ランタイム | Node.js 24 以上 (開発機は v26) | CLAUDE.md の既定 |
| 言語・実行 | TypeScript 5.9 + tsx (開発) / tsc (shim のビルド) | cairn と揃える |
| HTTP | Hono + `@hono/node-server` | design.md §5 |
| MCP | `@modelcontextprotocol/sdk` **~1.32.1 (1.x に固定)** | 2.x は channel が登録されない (design.md §6.1b) |
| ID | `ulid` | 時系列ソート可能 (protocol.md §1) |
| 検証 | `zod` (SDK 1.x の依存と同じ系統) | リクエスト本文と `kind` の検証 |
| テスト | `node --test` + tsx | cairn と揃える。Hub は `app.request()` でネットワークなしにテストする |

## ディレクトリ構成

```
src/
  shared/      型 (Message, Mailbox, Event)、kind の列挙、名前の検証、channel の meta 組み立てと本文エスケープ
  hub/         main.ts (起動), app.ts (Hono ルート), store.ts (JSONL 追記と復元), sse.ts, auth.ts
  shim/        main.ts (channel MCP サーバー)
public/        index.html (UI。Hub が配信する)
tools/probe/   §6.2 の実機検証用プローブ (本実装ではない)
```

1 パッケージに Hub と shim を同居させる。分ける理由 (別々に配布する、依存が衝突する) が出てから分ける。

## shim の起動方法

エージェントは agent-hub 以外のリポジトリで動くので、shim は**ユーザースコープ** (`~/.claude.json`) に絶対パスで登録する。
起動の速さと tsx への依存を避けるため、shim は `npm run build` で `dist/` に出力したものを `node` で動かす。

```jsonc
// ~/.claude.json の mcpServers (P0 の確認は agent-hub 自身で行うので、最初はプロジェクトの .mcp.json でもよい)
"agent-hub": {
  "command": "node",
  "args": ["C:/Users/kazuh/Desktop/Various/programming/DockerFiles/agent-hub/dist/shim/main.js"]
}
```

## ステップ

| # | 内容 | 終了条件 |
|---|---|---|
| 0 | **実機検証** (済): プローブで Channels・hook の挙動を確認し、design.md §6.1c に記録。meta 一本化と session_id 対応付けを反映 | 済 |
| 1 | 雛形: package.json, tsconfig, 依存 (済) | `npm install` が通り、tsx が動く (src がまだないので typecheck はステップ 2 から) |
| 2 | `shared/`: 型、`kind` 検証、名前の正規表現、channel の `meta` 組み立てと `</channel>` エスケープ | 単体テスト |
| 3 | `hub/store.ts`: JSONL 追記、起動時の復元、`seq` 採番 | 単体テスト (再起動後に Mailbox と cursor が戻る) |
| 4 | `hub/auth.ts` + `app.ts`: Bearer / cookie (`?token=` → Set-Cookie → リダイレクト) / `Origin` 検証。`POST /messages`、`GET /messages`、`GET /stream` (UI 向け SSE) | `app.request()` のテスト (401・403・cookie 発行・SSE 受信) |
| 5 | Mailbox: attach (作成と冪等性)、購読の PUT/DELETE、`/attachments/:id/stream` (未読の再送 + 新着)、ack で cursor 前進。リースと takeover は P2 | テスト (ack 前の再 attach で再送される) |
| 6 | `shim/main.ts`: `HUB_MAILBOX` → フォルダ名で attach (`CLAUDE_CODE_SESSION_ID` を sessionId として申告)、SSE を受けて `notifications/claude/channel` で push、ack。ツール `subscribe` / `post_message` / `whoami` (`_meta["anthropic/alwaysLoad"]: true`、design.md §6.1c) | 手動 (Claude Code 上で受け入れ条件 2〜5) |
| 7 | `public/index.html`: メッセージ一覧 (ライブ、`kind` 表示)、送信フォーム (`kind` 選択、既定 `request`) | 手動 (ブラウザで往復) |
| 8 | README に起動手順。受け入れ条件 1〜7 を通しで確認 | roadmap の P0 を完了にする |

## テスト方針

- **自動**: shared・store・Hub の HTTP は `node --test` で押さえる。Hub は Hono の `app.request()` を使い、ポートを開かずに検証する。
- **手動**: Channels は対話セッション + 開発用フラグでしか動かないので、shim と Claude Code の結合 (受け入れ条件 1, 4, 5) は手で確認する。
  確認手順は README に書き、再現できるようにする。

## リスク

- Channels は研究プレビューで、フラグや契約が変わりうる。shim の Channels 依存部分は 1 ファイルに閉じ込める。
- SDK 1.x 固定はいずれ外す必要がある。Claude Code が `2026-07-28` 上の channel に対応したら見直す (design.md §7 の MCP Events 移行と同時期になる見込み)。
