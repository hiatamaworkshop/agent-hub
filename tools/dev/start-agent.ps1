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
# --settings は渡さない。2.1.301 で --settings <file> を付けると、モデル名が "--settings" と読まれた (design.md §6.1f)。
# leader の応答を簡潔にする指示は roles/leader.md に書く
# 添付画像の保存先 (shim の既定は OS の一時フォルダの agent-hub。HUB_FILES_DIR で変えていればそれ) を読めるようにする。
# agent は Read でその画像を開くため。--add-dir は可変長の引数なので、最後に置く
$filesDir = if ($env:HUB_FILES_DIR) { $env:HUB_FILES_DIR } else { Join-Path $env:TEMP 'agent-hub' }
# 存在しないディレクトリを渡したときの挙動は未確認なので、先に作っておく
New-Item -ItemType Directory -Force -Path $filesDir | Out-Null
$claudeArgs += @('--add-dir', $filesDir)

# HTTP hook (tools/hooks/settings.json) の Authorization は環境変数 HUB_TOKEN から展開される。
# shim は .env を自分で読むが、hook は読まないので、未設定なら .env の値を渡す
$token = $env:HUB_TOKEN
$envFile = Join-Path $root '.env'
if (-not $token -and (Test-Path $envFile)) {
  $line = Get-Content $envFile | Where-Object { $_ -match '^\s*HUB_TOKEN\s*=' } | Select-Object -Last 1
  if ($line) { $token = ($line -replace '^\s*HUB_TOKEN\s*=\s*', '').Trim().Trim('"', "'") }
}

# 起動したシェルに HUB_ROLE / HUB_MAILBOX / HUB_TOKEN を残さない
$saved = @{ HUB_ROLE = $env:HUB_ROLE; HUB_MAILBOX = $env:HUB_MAILBOX; HUB_TOKEN = $env:HUB_TOKEN }
Push-Location $root
try {
  $env:HUB_ROLE = $Role
  $env:HUB_MAILBOX = $Mailbox  # 空なら未設定になり、shim は role 名を Mailbox 名にする
  $env:HUB_TOKEN = $token
  claude @claudeArgs
} finally {
  $env:HUB_ROLE = $saved.HUB_ROLE
  $env:HUB_MAILBOX = $saved.HUB_MAILBOX
  $env:HUB_TOKEN = $saved.HUB_TOKEN
  Pop-Location
}
