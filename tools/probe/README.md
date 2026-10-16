# 実機検証プローブ

design.md §6.2 の未検証事項を、実際の Claude Code セッションで確かめるための使い捨てツール。本実装ではない。

`probe.mjs` は 1 プロセスで次を兼ね、すべて `logs/probe.jsonl` に記録する。

- channel MCP サーバー: 起動時の環境変数、Claude Code から届いた JSON-RPC (initialize を含む) を記録。ツール `probe_note` を公開
- HTTP `127.0.0.1:7788`: `POST /hook` で hook の入力を記録、`GET /case/<name>` で検証用の channel 通知を送る。全ルートで合言葉 (token) を要求し、`Origin` 付きの要求と `Host` が `127.0.0.1` / `localhost` 以外の要求は拒む (ブラウザのページからの注入を防ぐ)

## 前提

- ターミナルで `claude` CLI が動くこと (VS Code 拡張ではなく CLI で起動する)
- `npm install` 済み
- 合言葉 (token): プローブの起動のたびに作られ、`logs/probe.jsonl` の `"kind":"token"` 行に出る (`logs/` は gitignore 済み)。
  hook (`tools/probe/settings.json` の `X-Probe-Token`) からも送るため、`$env:PROBE_TOKEN` を設定してから `claude` を起動すると、プローブはその値を使う。

以下の `curl.exe` は、この値を `$t` に入れてから使う (同じターミナルなら 1 回で足りる):

```powershell
$t = "<logs/probe.jsonl の token>"
```

## 手順

### 1. セッションを起動する (ターミナル A, PowerShell, リポジトリ直下)

```powershell
claude --version
$env:HUB_MAILBOX = "probe-test"
claude --mcp-config tools/probe/mcp.json --settings tools/probe/settings.json --dangerously-load-development-channels server:agent-hub-probe
```

- 警告ダイアログでは **I am using this for local development** を選ぶ。
- 起動バナーの下に `Channels (experimental) messages from server:agent-hub-probe inject directly in this session` が出れば登録成功。
- 出ない場合は `/mcp` で状態を見る。`--mcp-config` 経由で `server:` 指定が効かない可能性があるので、
  その場合は `tools/probe/mcp.json` をリポジトリ直下の `.mcp.json` に一時コピーして再起動する (コミットしない)。

### 2. 疎通とアイドル時の起床 (ターミナル B)

```powershell
curl.exe -H "x-probe-token: $t" http://127.0.0.1:7788/case/hello
```

セッション A が何もしていない状態で送り、Claude が自分からターンを始めて返事をするかを見る。

### 3. 閉じタグのエスケープ (§6.2-2)

```powershell
curl.exe -H "x-probe-token: $t" http://127.0.0.1:7788/case/escape
```

セッション A で次のように頼む:

> 直前に届いた channel 通知を、タグも含めて見えたまま一字一句 probe_note に書き写して

### 3b. meta の属性値のエスケープ (§6.2-4)

```powershell
curl.exe -H "x-probe-token: $t" http://127.0.0.1:7788/case/attr
```

セッション A で 3 と同じ頼み方をする。`probe_quote` の値が `a"b<c>&d` のまま見えるか、`&quot;` などに変換されたか、属性が途中で切れたかをメモする。

### 4. AskUserQuestion 待機中の通知 (§6.2-7)

セッション A で次のように頼む:

> AskUserQuestion で好きな色を 3 択で聞いて

選択肢が表示されて回答待ちになったら、**答えずに** ターミナル B で送る:

```powershell
curl.exe -H "x-probe-token: $t" http://127.0.0.1:7788/case/during_question
```

画面に何が起きたか (選択肢が閉じた / 何も起きない / 通知の行が出た) をメモし、それから回答する。回答後のターンで通知が渡されるかも見る。

### 5. 終了

セッション A で `/exit`。`logs/probe.jsonl` が残る。

## ログで確認すること

| §6.2 | 見る場所 |
|---|---|
| 1 | `claude --version` の出力と、手順 1 で channel が登録されたか |
| 2 | `note` に記録された書き写し。`</channel>` や `<channel source="evil">` がどう見えたか |
| 4 | 手順 3b の `note`。`probe_quote` の値が `"` `<` `>` `&` を含んだまま見えるか |
| 3 | `hook` の `headers.x-hub-mailbox` が `probe-test` になっているか。`rpc-in` の initialize に session 関連の情報があるか |
| 4 | `startup.env` に `HUB_MAILBOX` があるか (継承)、`PROBE_EXPANDED_MAILBOX` が `probe-test` か (展開) |
| 7 | 手順 4 のメモと、`hook` (PreToolUse / Notification) の時刻と `pushed` の時刻の前後 |

SessionStart hook はプローブの HTTP が listen する前に発火しうるので、記録されていなくても異常ではない。
