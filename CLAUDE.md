# agent-hub: 実装エージェント向けルール

## 最初にやること

1. [README.md](README.md) → [docs/design.md](docs/design.md) → [docs/protocol.md](docs/protocol.md) → [docs/roadmap.md](docs/roadmap.md) の順に読む。
2. **design.md §6 の未確認事項を、実装前に公式資料で確認する。** 特に Channels の仕様 (通知スキーマ・起動フラグ・必要条件)。構想は伝聞を含むので、食い違えば公式を優先し、design.md / protocol.md を更新する。
3. roadmap.md の **P0 から**着手する。受け入れ条件を満たしてから次のフェーズへ進む。

## 技術スタック (既定)

- Node.js (LTS) + TypeScript。同じ DockerFiles 配下の他プロジェクト (cairn など) と揃える。
- MCP 実装は公式 SDK (`@modelcontextprotocol/sdk`) を使う。
- HTTP は軽量なもの (Hono / Fastify など) を 1 つ選ぶ。選定理由を design.md §5 に追記する。
- UI は P0 ではフレームワークなしの単一 HTML。
- 変更したい場合は理由を design.md に書いてから行う。

## 設計上の不変条件

- Hub は **127.0.0.1 のみ** bind し、全 API でトークン認証する。
- Hub と shim は**分離**する (shim に状態を持たせない。design.md §3.1)。
- 他エージェント/ブラウザ由来の本文は**データとして扱い**、配信時は `<hub-message>` で包む。
- 既定は**人間が Send を押して送る**。自動転送を勝手に実装しない。
- 要約・加工をしない。中身はそのまま運ぶ。

## 開発環境メモ

- 開発機は Windows 11。シェルは PowerShell (Git Bash も可)。パス区切りと改行コードに注意する。
- 実トークンや `.env` はコミットしない (`.gitignore` 済み)。`.env.example` を置く。
- ランタイムのログ・データ (`logs/`, `data/`) もコミットしない。

## Git

- ブランチは `main`。フェーズごとの作業はトピックブランチを切ってよい。
- コミットメッセージ: 件名は 72 文字以内・命令形、`feat:` / `fix:` / `docs:` などのプレフィクス可。
  本文は 1〜3 行で「なぜ」を書く。ファイル単位の詳細は diff に任せる。
- **push はユーザーの指示があるまでしない** (リモート未設定)。

## ドキュメントの更新

- 仕様を変えたら同じコミットで docs を更新する。
- 検証して分かったこと (Channels の実挙動、hook のペイロードなど) は design.md §6 に結果として残す。
