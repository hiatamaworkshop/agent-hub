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
