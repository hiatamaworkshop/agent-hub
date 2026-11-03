#!/bin/sh
# post-commit: この HEAD のコミットで、プロジェクトの台帳 (.agent-hub.json の "ledger"、既定 docs/roadmap.md) が変わったときに、
# roadmap の索引を Hub に送る (design.md §3.15 の未決 2、C52。台帳の場所は C107。非 ASCII と書き方の揃えは C126)。
# 台帳の判定は docs:index --if-touched がする (src/shared/ledger.ts の touchesLedger)。ここは変わったパスを渡すだけ。
# パスは git diff-tree -z で NUL 区切りに渡す。引用されないので、非 ASCII・空白・改行のあるパスもそのまま届く。
# 送れなくても、トークンがなくても、どんな失敗でも exit 0 で終わる。コミットは止めない。
# 入れ方は docs/usage.md「Request work from roadmap items (Items)」。AGENT_HUB_DIR に agent-hub のフォルダを入れる。
AGENT_HUB_DIR="${AGENT_HUB_DIR:-}"

# 設定がなければ何もしない (黙って終わる)
[ -n "$AGENT_HUB_DIR" ] || exit 0

# この HEAD のコミットで変わったパス (最初のコミットも含む) を、パイプで docs:index に渡す。
# npm は作業フォルダ (INIT_CWD、このリポジトリのルート) を見て、そのプロジェクトの台帳として送る。台帳が変わっていなければ何も送らない。
# 標準エラーに出たもの (設定の警告、送れなかった理由) だけを集める。送れた旨 (標準出力) は出さない
err=$(git diff-tree --root --no-commit-id --name-only -r -z HEAD 2>/dev/null | npm --prefix "$AGENT_HUB_DIR" run -s docs:index -- --if-touched 2>&1 >/dev/null)
status=$?

# npm の表示 (npm error / npm warn) は外して、プログラムの言葉だけ見せる
msg=$(printf '%s\n' "$err" | grep -v '^npm \(error\|warn\)' | grep -v '^[[:space:]]*$')

if [ "$status" -ne 0 ]; then
  echo "agent-hub: roadmap の索引を送れなかった。コミットは止めない。" >&2
fi
[ -n "$msg" ] && printf '%s\n' "$msg" >&2
exit 0
