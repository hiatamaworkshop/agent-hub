#!/bin/sh
# post-commit: docs/roadmap.md を変えたコミットの後に、roadmap の索引を Hub に送る (design.md §3.15 の未決 2)。
# 送れなくても、トークンがなくても、どんな失敗でも exit 0 で終わる。コミットは止めない。
# 入れ方は README「roadmap の項目から依頼する (Items)」。AGENT_HUB_DIR に agent-hub のフォルダを入れる。
AGENT_HUB_DIR="${AGENT_HUB_DIR:-}"

# 設定がなければ何もしない (黙って終わる)
[ -n "$AGENT_HUB_DIR" ] || exit 0

# この HEAD のコミットで docs/roadmap.md が変わったときだけ送る (最初のコミットも含む)
git diff-tree --root --no-commit-id --name-only -r HEAD 2>/dev/null | grep -qx 'docs/roadmap.md' || exit 0

# npm は作業フォルダ (INIT_CWD) を見て、そのプロジェクトの索引として送る
if ! out=$(npm --prefix "$AGENT_HUB_DIR" run -s docs:index 2>&1); then
  echo "agent-hub: roadmap の索引を送れなかった (Hub が止まっているか、トークンがない)。コミットは止めない。" >&2
  echo "$out" | tail -n 1 >&2
fi
exit 0
