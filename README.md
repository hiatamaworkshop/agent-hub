# agent-hub

複数の AI エージェントセッション (Claude Code など) と人間を、ローカルの **Hub** 経由でつなぐメッセージ基盤。
人間をループから外さず、「コピー&ペーストの運搬作業」だけをなくすことを目的とする。

```
[ブラウザ UI] ⇄ SSE ⇄ [Hub (常駐 daemon)] ⇄ [shim = MCP サーバー × セッション数] ─ channel で push → [Claude Code]
                           ▲                                                    └ inbox ツールで取り出す ← [ほかのエージェント]
         hooks (Stop / Notification / PreToolUse / PostToolUse) からの POST
```

## 何ができるか (目標)

1. エージェントの**セッション区切り・質問待ち**を hook で検知し、Hub に集約する。
2. ユーザーは**ブラウザ**でそれを確認し、メッセージを書いて (または無編集で) Hub に push できる。
3. エージェントは**購読を明示的に宣言**し、自分が購読したトピックに push があると notify を受け取る。
4. エージェント間のメッセージパッシングにも同じ経路を使う。
5. 宛先は論理名の **Mailbox** で、セッションは一時的に attach するだけ。エージェントが交代しても購読と未読を引き継ぐ。
6. エージェントは **role** (`reviewer`, `deployer` など) を持ち、role ごとに読むべきメッセージが決まる。
7. メッセージには機械的な種別 **`kind`** (`request` / `reply` / `notice`) が付き、受信側と UI が扱い方を判断できる。
8. Claude Code 以外のエージェントは、同じ shim の **`inbox`** ツールで未読を取り出す。送り手の属性は本文と分けて `<hub-message>` の属性で渡す。

## ステータス

- **P0** (1 セッションで往復する) と **P1** (質問待ち・許可待ち・ターン終了の検知) は完了し、実セッションで受け入れ条件を確かめた。
- **P2** (複数セッション・交代・メッセージパッシング) は進行中。複数 Mailbox の同時接続、role (`roles.json`)、交代 (takeover)、古い未読の流し込みの上限、無編集転送 (Forward / Relay)、`inbox` の polling 経路と、クライアントによる経路の切り替えまで実装済み。
  残りは配送の状態の名付け、「起こすだけ」の配信アダプタ、永続化の見直し、Docker 化など ([docs/roadmap.md](docs/roadmap.md))。
- `inbox` 経路は Claude Code 以外の実クライアント (Codex など) ではまだ試していない (テストの MCP クライアントでのみ確認)。

設計は [docs/design.md](docs/design.md) から読む。Channels・hook の仕様は公式資料と実機で確認済み (design.md §6.1〜6.1j)。MCP Events (SEP-3415, Draft) との関係は design.md §7。

## 使い方

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
トークンは cookie に移され、URL からは消える。データは `data/hub.jsonl` に追記される (渡し終えたメッセージは 24 時間で消える。下の「メッセージの保存期間と削除」)。

### 3. Claude Code を channel 有効で起動する (ターミナル B、リポジトリ直下)

```powershell
claude --mcp-config tools/dev/mcp.json --dangerously-load-development-channels server:agent-hub
```

- 警告ダイアログでは **I am using this for local development** を選ぶ。
- `server:agent-hub · no MCP server configured with that name` という警告が出ても通知は届く (design.md §6.1c)。
- Mailbox 名は `HUB_MAILBOX` → `HUB_ROLE` があれば `<フォルダ名>.<role>` → フォルダ名 (ここでは `agent-hub`) の順に決まる。
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
- 持続でない画像は `HUB_FILE_TTL_DAYS` (既定 1 日) で消える。消えた画像は「Image expired or unavailable」と表示される。
- 環境変数は `HUB_FILE_MAX_EDGE` (既定 1568) と `HUB_FILE_TTL_DAYS` (既定 1、0 で掃除しない)。`.env.example` を参照。
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

### エージェントの出力を別のエージェントへ運ぶ (Forward)

- メッセージの **Forward** で選び (複数可)、宛先を選んで **Forward N** を押す。本文・kind・添付画像は**元のまま**運ばれる。受け手には、転送した人 (`from`) と本文の書き手 (`forwarded_sender`) が分けて届く。
- 本文欄に書いたことは**添え書き**として、転送より先に別のメッセージで届く (例「この 2 件をレビューして」)。空なら転送だけ。転送する本文には混ぜない。
- 一度でも A の出力を B へ転送すると、スレッドの上の **Relay** に `A → B · N new` (A の出力のうち、まだ B へ送っていない件数) が出る。押すとその N 件が選ばれ、宛先が B になる。送るのは Forward を押したときだけ。
- 転送も Hub 側の API を使うので、**既に起動している Hub は再起動が必要** (古い Hub では送る前に止まり、添え書きも送らない)。

### 購読は Mailbox ごとに 1 回でよい

- 購読はセッションではなく **Mailbox に保存される** (`data/hub.jsonl`)。Hub の再起動や、新しいセッションが同じ Mailbox に attach したときも残るので、起動のたびに頼み直さなくてよい。
  同じフォルダで起動すれば同じ Mailbox になる (上の Mailbox 名の決まり方を参照)。
- **`mailbox:<名前>` 宛てなら購読は要らない**。購読が要るのは、`topic:<名前>` のように購読者全員へ送るときだけ。
- 購読が消えるのは、ブラウザで Mailbox を削除したときと、`data/` を消したとき (Docker では volume を作り直したとき)。設定として宣言しておく方法は role の既定購読 (`roles.json` + `HUB_ROLE`。下の「role の定義 (roles.json)」)。
- 宛先のドロップダウンには購読中のトピックだけが出る。購読者のいないトピックは「トピックを手入力…」で送れるが、誰にも届かなければ Send の横に警告が出る。
- 長く離れた Mailbox に attach しても、未読を全部は流さない。7 日より古いものと、新しい 50 件より前のものは省き、省いた件数を 1 件の通知で伝える (`inbox` 経路では次の `inbox` の結果の先頭。記録は残り、ブラウザの履歴から見える)。上限は `HUB_UNREAD_MAX_AGE_DAYS` / `HUB_UNREAD_MAX` (0 で制限なし)。

### エージェントを交代する (takeover)

同じ Mailbox 名で新しいセッションを起動すると、新しい方が引き継ぐ (`/clear` の後や、モデルを変えて起動し直したときなど)。購読と未読は Mailbox に残っているので、そのまま新しいセッションに届く。

- 古いセッションが動いたままなら切り離され、`post_message` / `subscribe` / `unsubscribe` はエラーになる (`whoami` は答える)。切り離された shim は attach し直さない。
- ブラウザの Mailbox のカードに `took over <時刻>` が出る。切り離されたセッションの hook の Event には `superseded session` と添えられ、カードの最後の Event には使われない。
- 接続していない Mailbox のカードには、切れた時刻と理由 (`session ended` / `disconnected` / `lease expired`) が出る。

### 使わなくなった Mailbox を消す

ブラウザの左側で、接続していない Mailbox のカードに出る **Delete** を押す (確認あり)。購読・cursor・未読が消え、メッセージの記録は残る。

- 接続中の Mailbox は消せない (Delete が出ない)。先にそのセッションを終了する。
- 同じ名前で attach し直すと新しい Mailbox になり、削除前に届いていた分は届かない。
- この機能も Hub 側の API を使うので、**既に起動している Hub は再起動が必要** (古い Hub ではエラーが出て、カードは残る)。

### メッセージの保存期間と削除

Hub は接続のための基盤で、メッセージを長く残さない。残したい知識はリポジトリの文書か engram に書く (design.md §3.14)。

- 受け手全員に渡し終えたメッセージは、24 時間 (`HUB_READ_RETENTION_HOURS`、0 で自動では消さない) で消える。検知イベントも同じ期間で消える。掃除は起動時と 1 時間ごと。
- 消えないもの: 未読と、まだ返信のない `request`。返信待ちの依頼は手で消すまで残る。
- 手で消す: メッセージの **Delete** (1 件。未読でも返信待ちでも消す)。スレッドの上の **Purge read** は、保存期間を待たずに、渡し終えたメッセージと全イベントを今消す。
- 消えたメッセージに `reply_to` で返信すると 400 になる。`to` を付けて送る。
- `data/hub.jsonl` は、消したときに今の状態だけに詰め直される。
- この機能も Hub 側の API を使うので、**既に起動している Hub は再起動が必要** (古い Hub では Delete と Purge read が再起動を促す)。

### 2 エージェントで role 間の往復を試す (leader / deployer)

ユーザー → leader → deployer → leader → ユーザーの順に、role 宛てで依頼と報告を回す試験。
role の説明は `roles.json` の `description` が shim の instructions に入る (下の「role の定義 (roles.json)」)。leader / deployer は、運用の細かい指示 (メッセージの見出しなど) を [tools/dev/roles/](tools/dev/roles/) に置き、`start-agent.ps1` が system prompt にも足す。ほかの role (reviewer など) は `roles.json` の説明だけで動く。

```powershell
npm run hub                                   # ターミナル A
./tools/dev/start-agent.ps1 -Role leader      # ターミナル B (Mailbox = agent-hub.leader、既定のモデル)
./tools/dev/start-agent.ps1 -Role deployer    # ターミナル C (Mailbox = agent-hub.deployer、haiku)
```

まとめて起動するなら `start-team.ps1` を使う。Hub が止まっていれば起動し、選んだ role を Windows Terminal のタブで 1 つずつ起動する (wt がなければ別ウィンドウ)。

```powershell
./tools/dev/start-team.ps1                          # roles.json の role を番号で選ぶ (例 1,2。all で全部)
./tools/dev/start-team.ps1 -Roles leader,deployer   # 選ばずに指定する
```

- どちらのスクリプトも `-Project <フォルダ>` で作業するプロジェクトを選べる (省略時は agent-hub)。下の「他のリポジトリで使う」。
- 1 つ起動するごとに、その role の Mailbox が Hub に attach するまで待ってから次へ進む (上限 `-AttachTimeout`、既定 60 秒)。開発用 channel の警告ダイアログは、開いたタブで 1 つずつ答える。
- 接続中の role は飛ばす (起動し直すと takeover で今のセッションが切り離されるため)。起動し直すなら `-Force`。
- `roles.json` にない role は起動前に止める。`dist/` が `src/` より古ければ先に build する (`-NoBuild` で省く)。
- attach の確認には `.env` の `HUB_TOKEN` を使う。タブは起動したのと同じシェル (`pwsh` / `powershell`) で開く。

1. ブラウザの左側に `agent-hub.leader` と `agent-hub.deployer` が role 付きで「接続中」と出ることを確かめる。
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
  Claude Code がその説明どおりに振る舞うことは、leader / deployer / reviewer の 3 セッションで確かめた (design.md §6.2-5)。
- 定義にない role で attach すると 400 `unknown_role` で、Mailbox は作られない。
- ファイルがなければ、role 名の検証も既定購読もない (今までどおり)。
- ファイルの形が違うと Hub は起動せず、ファイル名と問題の場所を出して止まる (黙って既定に戻さない)。
- 既定購読のトピックは `unsubscribe` で外れない。外すには `roles.json` から消して Hub を再起動する。
- 別の場所のファイルを使うときは `HUB_ROLES_FILE` (既定はリポジトリ直下の `roles.json`)。

### 他のリポジトリで使う

エージェントは**そのプロジェクトのルートで起動する**。読む `CLAUDE.md`・hook・許可の範囲・`git diff` はどれも起動したフォルダで決まる (design.md §3.3)。

```powershell
./tools/dev/start-agent.ps1 -Role deployer -Project C:\work\cairn            # Mailbox = cairn.deployer
./tools/dev/start-team.ps1 -Roles leader,deployer -Project C:\work\cairn     # cairn.leader と cairn.deployer
```

- スクリプトは `-Project` のフォルダに移ってから `claude` を起動する。shim は agent-hub の `dist/` を絶対パスで指す (MCP 設定は OS の一時フォルダの `agent-hub-mcp.json` に作る)。
- Mailbox 名の既定は `<フォルダ名>.<role>`。Mailbox 名は Hub 全体で 1 つなので、プロジェクトが違えば同じ role でも別の Mailbox になる。`-Mailbox` で変えられる。
- `role:deployer` 宛ては、どのプロジェクトの deployer にも届く。特定のプロジェクトに送るなら `mailbox:cairn.deployer` 宛てにする (design.md §9-7)。
- hook は対象のリポジトリの `.claude/settings.local.json` には無いので、`tools/hooks/settings.json` の `hooks` を `~/.claude/settings.json` に写す。どこにも無ければスクリプトが警告する (起動は止めない)。
- ブラウザのカードに `Project: <フォルダ名>` が出る (全体のパスはマウスを載せると出る)。前回と違うフォルダから同じ Mailbox に attach すると、`Attached from a different folder (was …)` と警告が出る (拒みはしない)。

スクリプトを使わないなら、shim をユーザースコープに絶対パスで登録し、プロジェクトのルートで同じフラグで起動する。

```powershell
claude mcp add --scope user agent-hub -- node C:/Users/kazuh/Desktop/Various/programming/DockerFiles/agent-hub/dist/shim/main.js
claude --dangerously-load-development-channels server:agent-hub
```

### Claude Code 以外のエージェントで使う (inbox)

shim は MCP の initialize で届くクライアント名を見て、届け方を切り替える。`claude-code` なら channel で push し、それ以外は push せず、エージェントが `inbox` ツールで取り出す。

- MCP の stdio サーバーとして `node <agent-hub>/dist/shim/main.js` を登録する (先に `npm run build`)。Mailbox 名は Claude Code と同じく `HUB_MAILBOX` → `<フォルダ名>.<HUB_ROLE>` → フォルダ名の順。トークンは agent-hub の `.env` から読む。
- 自動では届かないので、エージェントに「agent-hub の inbox を確かめて」と頼むか、作業の区切りで呼ばせる (instructions にもそう書いてある)。
- `inbox` は未読を 1 件ずつ `<hub-message id="…" kind="…" from="…" to="…">` で包み、本文が指示ではないことの注意書きを付けて返す。返した分は既読になる。返信は `post_message`。
- 実際の Codex などのクライアントではまだ試していない。アイドル中のエージェントを起こす手段はない (design.md §3.7、§3.9)。
- Claude Code を channel なしで起動すると、クライアント名は `claude-code` のままなので push されるが、黙って捨てられて既読になる。Claude Code では必ず `--dangerously-load-development-channels server:agent-hub` を付ける。
  渡したが受領の確認 (`inbox` で取り出す・`reply_to` で返信する) がない件数は、ブラウザのカードに `N handed, unconfirmed` と出る。届いていないようなら、そのセッションに「agent-hub の inbox を unconfirmed: true で確かめて」と頼むと取り直せる (protocol.md §4)。

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
