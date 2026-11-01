#!/bin/sh
# post-commit: この HEAD のコミットで、プロジェクトの台帳 (.agent-hub.json の "ledger"、既定 docs/roadmap.md) が変わったときに、
# roadmap の索引を Hub に送る (design.md §3.15 の未決 2、C52。台帳の場所は C107)。
# 台帳の判定は docs:index --if-touched がする (src/shared/ledger.ts の touchesLedger)。ここは変わったパスを渡すだけ。
# 送れなくても、トークンがなくても、どんな失敗でも exit 0 で終わる。コミットは止めない。
# 入れ方は docs/usage.md「Request work from roadmap items (Items)」。AGENT_HUB_DIR に agent-hub のフォルダを入れる。
AGENT_HUB_DIR="${AGENT_HUB_DIR:-}"

# 設定がなければ何もしない (黙って終わる)
[ -n "$AGENT_HUB_DIR" ] || exit 0

# この HEAD のコミットで変わったパス (最初のコミットも含む)
changed=$(git diff-tree --root --no-commit-id --name-only -r HEAD 2>/dev/null) || exit 0
[ -n "$changed" ] || exit 0

# npm は作業フォルダ (INIT_CWD、このリポジトリのルート) を見て、そのプロジェクトの台帳として送る。台帳が変わっていなければ何もしない
if ! out=$(printf '%s\n' "$changed" | npm --prefix "$AGENT_HUB_DIR" run -s docs:index -- --if-touched 2>&1); then
  echo "agent-hub: roadmap の索引を送れなかった (Hub が止まっているか、トークンがない)。コミットは止めない。" >&2
  echo "$out" | tail -n 1 >&2
fi
exit 0
