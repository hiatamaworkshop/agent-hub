# Start Claude Code for one role with the channel enabled. A wrapper that keeps the PowerShell parameters;
# the work is done by `npm run team -- agent` (src/team/agent.ts; design.md section 3.8, roadmap C62).
# e.g. ./tools/dev/start-agent.ps1 -Role deployer -Project C:\work\cairn
param(
  [Parameter(Mandatory)][string]$Role,
  [string]$Project,
  [string]$Model,
  [string]$Mailbox,
  [string]$PermissionMode
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$a = @('agent', '--role', $Role)
if ($Project) { $a += @('--project', (Resolve-Path -LiteralPath $Project).Path) }
if ($Model) { $a += @('--model', $Model) }
if ($Mailbox) { $a += @('--mailbox', $Mailbox) }
if ($PermissionMode) { $a += @('--permission-mode', $PermissionMode) }
# tsx is resolved from the current folder, so run from the agent-hub root (claude itself starts in the project)
Push-Location $root
try { & node --import tsx src/team/main.ts @a } finally { Pop-Location }
exit $LASTEXITCODE
