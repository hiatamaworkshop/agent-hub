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
5. 宛先は論理名の **Mailbox** で、セッションは一時的に attach するだけ。エージェントが交代しても購読と未読を引き継ぐ。
6. エージェントは **role** (`reviewer`, `deployer` など) を持ち、role ごとに読むべきメッセージが決まる。
7. メッセージには機械的な種別 **`kind`** (`request` / `reply` / `notice`) が付き、受信側と UI が扱い方を判断できる。

## ステータス

P0 (1 セッションで往復する) を実装済み。P1 (質問待ち・ターン終了の検知) は実装済みで、実セッションでの受け入れ確認はまだ。Claude Code 上での受け入れ確認は手動で行う (下の手順)。設計は [docs/design.md](docs/design.md) から読む。
Channels の仕様は公式資料と実機で確認済み (design.md §6.1〜6.1c)。MCP Events (SEP-3415, Draft) との関係は design.md §7。

## 使い方 (P0)

前提: Node.js 24 以上、ターミナルで `claude` CLI が動くこと (Channels は対話セッションの CLI でだけ有効)。

### 1. 準備

```powershell
npm install
Copy-Item .env.example .env   # HUB_TOKEN を 16 文字以上のランダム値にする (生成例は .env.example)
npm run build                 # shim を dist/ に出力する
```

### 2. Hub を起動する (ターミナル A)

```powershell
npm run hub
```

`[hub] UI: http://127.0.0.1:7777/?token=…` が表示されるので、その URL をブラウザで開く。
トークンは cookie に移され、URL からは消える。データは `data/hub.jsonl` に追記される。

### 3. Claude Code を channel 有効で起動する (ターミナル B、リポジトリ直下)

```powershell
claude --mcp-config tools/dev/mcp.json --dangerously-load-development-channels server:agent-hub
```

- 警告ダイアログでは **I am using this for local development** を選ぶ。
- `server:agent-hub · no MCP server configured with that name` という警告が出ても通知は届く (design.md §6.1c)。
- Mailbox 名は `HUB_MAILBOX` → `HUB_ROLE` → フォルダ名 (ここでは `agent-hub`) の順に決まる。
- shim はトークンを agent-hub の `.env` から読むので、MCP 設定にトークンを書かなくてよい。

### 4. 往復を確かめる

1. Claude に「agent-hub の `user.message` を購読して」と頼む (`subscribe` が呼ばれる)。
2. ブラウザのフォームで `request` と宛先 `topic:user.message` を選び、本文を書いて Send。Claude の会話に `<channel source="agent-hub" …>` として届く。
3. Claude に返信させる (`post_message`、`kind: reply`)。ブラウザの一覧に `reply` として出る。
4. ブラウザの左側に Mailbox `agent-hub` が「接続中」と表示される。

### カスタムコマンド

ブラウザの **Commands** で、よく使う文字列に名前を付けられる。例: 名前 `cp`、text `commit and push`。

- 本文に `/cp` と書いて Send を押すと、`commit and push` に置き換えて送る。`/cp 今日の作業` のように書くと、`$ARGS` を含む text ではその位置に、含まなければ後ろに引数が入る。
- `//cp` は置き換えずに `/cp` を送る (エスケープ)。定義されていない `/xyz` はそのまま送る。
- 設定は `HUB_DATA_DIR` (既定は `data/`) の `settings.json` に保存される。手で編集してもよく、次の読み込みから反映される。手編集の `defaultTo` (例 `"mailbox:leader"`) を置くと、その Mailbox が attach 中のときに UI の初期の宛先になる (前回送った宛先があればそちらが優先。どちらも attach 中でなければ宛先は未選択)。

```json
{ "version": 1, "commands": [ { "name": "cp", "text": "commit and push" } ] }
```

この機能は Hub 側の API を使うので、**既に起動している Hub は再起動しないと Commands が無効のまま** (古い Hub では Commands が灰色になる)。

### 画像を貼る

本文欄に画像を貼る (Ctrl+V)、画像をコンポーザーにドラッグする、または **Attach** で選ぶ。PNG・JPEG・GIF・WebP を 1 メッセージに 4 枚まで、1 枚 20MB まで。

- 送ると、Hub が長辺 1568px に縮小して `HUB_DATA_DIR/files/` に保存し、スレッドに画像を出す。agent に届くのも同じ画像で、位置情報などの metadata は落ちる。GIF / WebP は 1 フレーム目だけ。本文が空なら `[image]` を送る。
- 持続でない画像は `HUB_FILE_TTL_DAYS` (既定 7 日) で消える。消えた画像は「Image expired or unavailable」と表示される。
- 環境変数は `HUB_FILE_MAX_EDGE` (既定 1568) と `HUB_FILE_TTL_DAYS` (既定 7、0 で掃除しない)。`.env.example` を参照。
- この機能も Hub 側の API を使うので、**既に起動している Hub は再起動が必要** (古い Hub では Attach で送らずに再起動を促す)。

#### agent が画像を見る

shim は届いた画像を OS の一時フォルダの `agent-hub/<Mailbox 名>/` に保存し、通知の `meta` 属性の `files[].path` にパスを入れる。agent はそのパスを `Read` で開いて画像を見る。保存に失敗したものは `error` (`expired` は期限切れ、`fetch_failed` は取得失敗) が付く。

- 保存先は `HUB_FILES_DIR` で変えられる (その下に Mailbox 名のフォルダを作る)。
- 起動時に 24 時間より古い画像を消す。
- 保存先は作業フォルダの外なので、`Read` が許可を求めることがある。`tools/dev/start-agent.ps1` は起動時に `--add-dir` で保存先を許可する (`HUB_FILES_DIR` を設定していればそのフォルダ)。手で `claude` を起動するなら、`claude --add-dir "<保存先>"` を付ける。

### 質問待ち・許可待ち・ターン終了をブラウザに出す (hook)

Claude Code の HTTP hook で、`AskUserQuestion`・許可待ち・ターン終了を Hub に送る。ブラウザのスレッドに破線の枠で出て、左の Mailbox のカードに最後のものが出る。

1. [tools/hooks/settings.json](tools/hooks/settings.json) の `hooks` を、このリポジトリの `.claude/settings.local.json` (コミットされない) に写す。
   ほかのリポジトリでも使うなら `~/.claude/settings.json` に写す。ポートを変えているなら `url` の `7777` も変える。
   `--settings` で渡す方法は 2.1.301 で誤動作した (design.md §6.1f) ので使わない。
2. hook の `Authorization` は環境変数 `HUB_TOKEN` から作られる。`tools/dev/start-agent.ps1` は `.env` の値を渡すので何もしなくてよい。手で `claude` を起動するなら、先に `$env:HUB_TOKEN` を設定する。
   その場合、トークンはセッションの Bash などからも見える。`.env` と同じ扱い。
3. Hub が止まっていると、hook はエラーを表示するだけで作業は止まらない (タイムアウト 5 秒)。
4. (任意) `Stop` で変更の事実 (HEAD・変更ファイル・未追跡ファイル) を Hub に送るには、[tools/hooks/settings.command.json](tools/hooks/settings.command.json) の `Stop` を使う。`Stop` の HTTP hook (1 の `Stop`) と**両方置くと `turn.end` が 2 件になる**ので、HTTP の `Stop` は外して置き換える。
   スクリプトは `tools/hooks/post-event.mjs`。git は作業フォルダで実行し、Hub は git を実行しない。Hub のポートは `HUB_PORT` (既定 7777)。失敗しても作業は止まらず、取れた分だけ送る。ブラウザでは `turn.end` に変更ファイルの件数が出る。

- どの Mailbox の出来事かは、shim が申告した session → `X-Hub-Mailbox` (`HUB_MAILBOX`) → フォルダ名の順で決まる。
- **質問にはブラウザから答えられない**。ターミナルで答える。ブラウザから送ったメッセージは、回答の後にセッションに届く。
- Event の **Reply** は、その Mailbox 宛ての `request` を書き始める。
- この機能も Hub 側の API を使うので、**既に起動している Hub は再起動が必要** (古い Hub では Event が出ないだけ)。

### 購読は Mailbox ごとに 1 回でよい

- 購読はセッションではなく **Mailbox に保存される** (`data/hub.jsonl`)。Hub の再起動や、新しいセッションが同じ Mailbox に attach したときも残るので、起動のたびに頼み直さなくてよい。
  同じフォルダで起動すれば同じ Mailbox になる (上の Mailbox 名の決まり方を参照)。
- **`mailbox:<名前>` 宛てなら購読は要らない**。購読が要るのは、`topic:<名前>` のように購読者全員へ送るときだけ。
- 購読が消えるのは、ブラウザで Mailbox を削除したときと、`data/` を消したとき (Docker では volume を作り直したとき)。設定として宣言しておく方法は role の既定購読 (`roles.json` + `HUB_ROLE`。下の「role の定義 (roles.json)」)。
- 宛先のドロップダウンには購読中のトピックだけが出る。購読者のいないトピックは「トピックを手入力…」で送れるが、誰にも届かなければ Send の横に警告が出る。

### 使わなくなった Mailbox を消す

ブラウザの左側で、接続していない Mailbox のカードに出る **Delete** を押す (確認あり)。購読・cursor・未読が消え、メッセージの記録は残る。

- 接続中の Mailbox は消せない (Delete が出ない)。先にそのセッションを終了する。
- 同じ名前で attach し直すと新しい Mailbox になり、削除前に届いていた分は届かない。
- この機能も Hub 側の API を使うので、**既に起動している Hub は再起動が必要** (古い Hub ではエラーが出て、カードは残る)。

### 2 エージェントで role 間の往復を試す (leader / deployer)

ユーザー → leader → deployer → leader → ユーザーの順に、role 宛てで依頼と報告を回す試験。
role の振る舞いは [tools/dev/roles/](tools/dev/roles/) の説明を system prompt に足して伝える。`roles.json` の説明は、この試験の system prompt の代わりにはまだ使っていない (下の「role の定義 (roles.json)」を参照)。

```powershell
npm run hub                                   # ターミナル A
./tools/dev/start-agent.ps1 -Role leader      # ターミナル B (Mailbox = leader、既定のモデル)
./tools/dev/start-agent.ps1 -Role deployer    # ターミナル C (Mailbox = deployer、haiku)
```

1. ブラウザの左側に `leader` と `deployer` が role 付きで「接続中」と出ることを確かめる。
2. ブラウザから `request` を `role:leader` 宛てに送る。本文は作業の依頼 (例: 「`tmp/hello.txt` を作って」)。
3. leader が `role:deployer` 宛てに実装指示を `request` で送り、deployer が作業して `reply` を返す。
4. leader が変更を確かめ、2 の依頼への `reply` を送る。ブラウザに 4 通が `request` → `request` → `reply` → `reply` の順に並ぶ。

- メッセージの形式は role の説明で決めている。leader → deployer は英語の固定見出し (`GOAL` / `SCOPE` / `SPEC` / `DONE WHEN`)、
  deployer → leader は英語で、変更ファイルの一覧 (`CHANGED`) だけ DCP 形式。leader → user は日本語で `結果` / `確認` / `要対応` の 3 項目。
- leader のターミナルでの応答を簡潔にする指示も role の説明に書いている。output style (`/output-style concise`) は `.claude/settings.local.json` に保存され、同じフォルダの全セッションに効くので使わない。起動時に `--settings` で渡す方法は 2.1.301 で誤動作した (design.md §6.1f)。
- 2 つのセッションは同じフォルダで動くので、deployer の変更は leader から `git diff` で見える。
- deployer のファイル編集の許可は、ターミナル C で承認する。

### role の定義 (roles.json)

role ごとの既定購読と説明を、Hub の設定ファイルに書く。見本は [roles.example.json](roles.example.json)。

```powershell
Copy-Item roles.example.json roles.json   # 自分の環境用。roles.json はコミットされない
npm run hub                               # 読むのは起動時だけ。変えたら再起動する
```

- 各 role は `description` (文字列) と `subscribe` (トピック名の配列) を持つ。ほかの項目は読み捨てずに保持されるが、今は使われない。
- `HUB_ROLE=reviewer` で起動した Mailbox は、`subscribe` を呼ばなくても `reviewer` の既定購読を受け取る。`to: role:reviewer` 宛てもこの Mailbox に届く。
- `description` は shim の instructions に入る。shim は initialize より前に attach して取りに行く (3 秒まで。過ぎたら説明なしで起動する)。
  実際のエージェントがその説明どおりに振る舞うかは、まだ実セッションで確かめていない。
- 定義にない role で attach すると 400 `unknown_role` で、Mailbox は作られない。
- ファイルがなければ、role 名の検証も既定購読もない (今までどおり)。
- ファイルの形が違うと Hub は起動せず、ファイル名と問題の場所を出して止まる (黙って既定に戻さない)。
- 既定購読のトピックは `unsubscribe` で外れない。外すには `roles.json` から消して Hub を再起動する。
- 別の場所のファイルを使うときは `HUB_ROLES_FILE` (既定はリポジトリ直下の `roles.json`)。

### 他のリポジトリで使う

shim をユーザースコープに絶対パスで登録し、同じフラグで起動する。

```powershell
claude mcp add --scope user agent-hub -- node C:/Users/kazuh/Desktop/Various/programming/DockerFiles/agent-hub/dist/shim/main.js
claude --dangerously-load-development-channels server:agent-hub
```

### curl で触る (Windows の注意)

```powershell
curl.exe -H "Authorization: Bearer <HUB_TOKEN>" http://127.0.0.1:7777/messages
```

Windows の curl はコマンドライン引数の日本語を UTF-8 で送らないので、本文はファイルから `--data-binary "@body.json"` で渡す。

### 開発

```powershell
npm test          # 単体テストと、shim を実プロセスで起動する結合テスト
npm run typecheck
npm run hub:dev   # 変更を監視して Hub を再起動する
```

## ドキュメント

| ファイル | 内容 |
|---|---|
| [docs/design.md](docs/design.md) | 背景・要件・アーキテクチャ・設計判断・未確認事項 |
| [docs/protocol.md](docs/protocol.md) | HTTP API・メッセージスキーマ・MCP ツール・配信保証 |
| [docs/roadmap.md](docs/roadmap.md) | フェーズ分割と受け入れ条件 (P0 → P2) |
| [docs/plan-p0.md](docs/plan-p0.md) | P0 の技術選定・構成・コミット単位のステップ |
| [tools/probe/README.md](tools/probe/README.md) | 未検証事項 (design.md §6.2) を実機で確かめる手順 |
| [CLAUDE.md](CLAUDE.md) | 実装エージェント向けの作業ルール |

## 発想の元

Claude と Codex を併用する開発者が、両アプリ間の手動コピペを「読む作業こそが仕事」と捉え、
運搬だけを自動化するツール (Relay) を作った、という記事に着想を得ている。
本プロジェクトはそれをアプリ非依存・MCP ベースで、自前の Hub として作り直す試み。
