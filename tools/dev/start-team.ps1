# Start the Hub and several roles in tabs. A wrapper that keeps the PowerShell parameters;
# the work is done by `npm run team` (src/team/, the same on every OS; design.md section 3.8, roadmap C62).
# e.g. ./tools/dev/start-team.ps1                     # choose from roles.json by number
#      ./tools/dev/start-team.ps1 -Roles leader,deployer
#      ./tools/dev/start-team.ps1 -Roles leader,deployer -Project C:\work\cairn
param(
  [string[]]$Roles,
  [string]$Project,
  [int]$AttachTimeout = 60,
  [switch]$Force,
  [switch]$NoBuild,
  [string]$PermissionMode,
  # wt | window | print (see npm run team -- --help)
  [string]$Tabs
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$a = @()
if ($Roles) { $a += @('--roles', ($Roles -join ',')) }
if ($Project) { $a += @('--project', (Resolve-Path -LiteralPath $Project).Path) }
$a += @('--attach-timeout', "$AttachTimeout")
if ($Force) { $a += '--force' }
if ($NoBuild) { $a += '--no-build' }
if ($PermissionMode) { $a += @('--permission-mode', $PermissionMode) }
if ($Tabs) { $a += @('--tabs', $Tabs) }
# tsx is resolved from the current folder, so run from the agent-hub root
Push-Location $root
try { & node --import tsx src/team/main.ts @a } finally { Pop-Location }
exit $LASTEXITCODE
