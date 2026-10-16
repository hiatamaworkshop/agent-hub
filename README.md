# agent-hub

複数の AI エージェントセッション (Claude Code など) と人間を、ローカルの **Hub** 経由でつなぐメッセージ基盤。
人間をループから外さず、「コピー&ペーストの運搬作業」だけをなくすことを目的とする。

```
[ブラウザ UI] ⇄ SSE ⇄ [Hub (常駐 daemon)] ⇄ [shim = channel MCP × セッション数] → [Claude セッション]
                           ▲
         hooks (Stop / Notification / PreToolUse) からの POST
```

## 何ができるか (目標)

1. エージェントの**セッション区切り・質問待ち**を hook で検知し、Hub に集約する。
2. ユーザーは**ブラウザ**でそれを確認し、メッセージを書いて (または無編集で) Hub に push できる。
3. エージェントは**購読を明示的に宣言**し、自分が購読したトピックに push があると notify を受け取る。
4. エージェント間のメッセージパッシングにも同じ経路を使う。

## ステータス

構想段階。実装は未着手。まず [docs/design.md](docs/design.md) を読むこと。

## ドキュメント

| ファイル | 内容 |
|---|---|
| [docs/design.md](docs/design.md) | 背景・要件・アーキテクチャ・設計判断・未確認事項 |
| [docs/protocol.md](docs/protocol.md) | HTTP API・メッセージスキーマ・MCP ツール・配信保証 |
| [docs/roadmap.md](docs/roadmap.md) | フェーズ分割と受け入れ条件 (P0 → P2) |
| [CLAUDE.md](CLAUDE.md) | 実装エージェント向けの作業ルール |

## 発想の元

Claude と Codex を併用する開発者が、両アプリ間の手動コピペを「読む作業こそが仕事」と捉え、
運搬だけを自動化するツール (Relay) を作った、という記事に着想を得ている。
本プロジェクトはそれをアプリ非依存・MCP ベースで、自前の Hub として作り直す試み。
