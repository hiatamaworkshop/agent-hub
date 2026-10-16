# role を指定して Claude Code を channel 有効で起動する (2 エージェントの往復を試す開発用)。
# role の振る舞いは tools/dev/roles/<role>.md を system prompt に足して伝える (roles.json による差し込みは P2)
param(
  [Parameter(Mandatory)][ValidateSet('leader', 'deployer')][string]$Role,
  # 省略時は deployer だけ haiku、leader は既定のモデル
  [string]$Model,
  # 省略時は Mailbox 名 = role 名
  [string]$Mailbox
)

$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if (-not $Model -and $Role -eq 'deployer') { $Model = 'haiku' }

$claudeArgs = @(
  '--mcp-config', (Join-Path $root 'tools/dev/mcp.json'),
  '--dangerously-load-development-channels', 'server:agent-hub',
  '--append-system-prompt-file', (Join-Path $root "tools/dev/roles/$Role.md")
)
if ($Model) { $claudeArgs += @('--model', $Model) }
# role ごとの Claude Code 設定 (leader は output style を Concise にする)。
# /output-style は .claude/settings.local.json に書き、同じフォルダの全セッションに効くので、起動時に role ごとに渡す。
# JSON 文字列ではなくファイルで渡す (claude.cmd へ渡す引数の " を PowerShell が落とすことがある)
$settings = Join-Path $root "tools/dev/settings/$Role.json"
if (Test-Path $settings) { $claudeArgs += @('--settings', $settings) }
# 添付画像の保存先 (shim の既定は OS の一時フォルダの agent-hub。HUB_FILES_DIR で変えていればそれ) を読めるようにする。
# agent は Read でその画像を開くため。--add-dir は可変長の引数なので、最後に置く
$filesDir = if ($env:HUB_FILES_DIR) { $env:HUB_FILES_DIR } else { Join-Path $env:TEMP 'agent-hub' }
# 存在しないディレクトリを渡したときの挙動は未確認なので、先に作っておく
New-Item -ItemType Directory -Force -Path $filesDir | Out-Null
$claudeArgs += @('--add-dir', $filesDir)

# 起動したシェルに HUB_ROLE / HUB_MAILBOX を残さない
$saved = @{ HUB_ROLE = $env:HUB_ROLE; HUB_MAILBOX = $env:HUB_MAILBOX }
Push-Location $root
try {
  $env:HUB_ROLE = $Role
  $env:HUB_MAILBOX = $Mailbox  # 空なら未設定になり、shim は role 名を Mailbox 名にする
  claude @claudeArgs
} finally {
  $env:HUB_ROLE = $saved.HUB_ROLE
  $env:HUB_MAILBOX = $saved.HUB_MAILBOX
  Pop-Location
}
