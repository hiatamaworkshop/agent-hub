# Hub と複数の role の Claude Code を、Windows Terminal のタブで順に起動する (開発用)。
# Hub が動いていなければ起動し、role は 1 つずつ start-agent.ps1 で起動して、attach を確かめてから次へ進む。
# 例: ./tools/dev/start-team.ps1                     # roles.json から番号で選ぶ
#     ./tools/dev/start-team.ps1 -Roles leader,deployer
#     ./tools/dev/start-team.ps1 -Roles leader,deployer -Project C:\work\cairn
param(
  # 省略時は roles.json (なければ roles.example.json) の role から選ぶ
  [string[]]$Roles,
  # 作業するプロジェクトのルート。各 role の claude はここで起動する (design.md §3.3)。省略時は agent-hub
  [string]$Project,
  # 1 つの role の attach を待つ上限 (秒)。過ぎたら警告して次へ進む
  [int]$AttachTimeout = 60,
  # 接続中の role も起動し直す (takeover で今のセッションを切り離す)
  [switch]$Force,
  # dist/ が古くても build しない
  [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$agentScript = Join-Path $PSScriptRoot 'start-agent.ps1'
. (Join-Path $PSScriptRoot 'mailbox-name.ps1')
if ($Project) {
  if (-not (Test-Path -LiteralPath $Project -PathType Container)) { throw "プロジェクトのフォルダ $Project がない" }
  $projectDir = (Resolve-Path -LiteralPath $Project).Path
} else {
  $projectDir = $root
}
# タブでも同じシェル (powershell.exe / pwsh.exe) を使う
$shell = (Get-Process -Id $PID).Path
$useWt = [bool](Get-Command wt.exe -ErrorAction SilentlyContinue)
$window = 'agent-hub'

# .env の値 (環境変数が優先)
function Get-EnvValue([string]$Name, [string]$Default) {
  $v = [Environment]::GetEnvironmentVariable($Name)
  if ($v) { return $v }
  $envFile = Join-Path $root '.env'
  if (Test-Path $envFile) {
    $line = Get-Content $envFile -Encoding UTF8 | Where-Object { $_ -match "^\s*$Name\s*=" } | Select-Object -Last 1
    if ($line) {
      $v = ($line -replace "^\s*$Name\s*=\s*", '').Trim().Trim('"', "'")
      if ($v) { return $v }
    }
  }
  return $Default
}

$port = [int](Get-EnvValue 'HUB_PORT' '7777')
$token = Get-EnvValue 'HUB_TOKEN' ''
$hubUrl = "http://127.0.0.1:$port"

# 新しいタブ (wt がなければ新しいウィンドウ) で、このリポジトリを作業フォルダにして実行する。
# wt は引数の ; をコマンドの区切りと読むので、引数に ; を入れない
function Start-Tab([string]$Title, [string[]]$ShellArgs) {
  if ($useWt) {
    & wt.exe -w $window new-tab --title $Title -d $root $shell @ShellArgs
  } else {
    Start-Process -FilePath $shell -ArgumentList $ShellArgs -WorkingDirectory $root | Out-Null
  }
}

function Test-HubPort {
  $client = New-Object System.Net.Sockets.TcpClient
  try { return $client.ConnectAsync('127.0.0.1', $port).Wait(500) } catch { return $false } finally { $client.Dispose() }
}

function Get-Mailboxes {
  try {
    $r = Invoke-RestMethod -Uri "$hubUrl/mailboxes" -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 3
    return $r.mailboxes
  } catch { return $null }
}

function Test-Attached([string]$Name) {
  $mb = Get-Mailboxes | Where-Object { $_.name -eq $Name }
  return [bool]($mb -and $mb.attachment)
}

# --- role を決める ---
# 検査は Hub と同じ roles ファイル (環境変数 HUB_ROLES_FILE → .env → 既定 roles.json。相対パスはリポジトリ直下から)
$hubRolesFile = Get-EnvValue 'HUB_ROLES_FILE' ''
$hubRolesFile = if ($hubRolesFile) { [System.IO.Path]::Combine($root, $hubRolesFile) } else { Join-Path $root 'roles.json' }
# 選ぶ一覧は、そのファイルがなければ roles.example.json から出す
$rolesFile = $hubRolesFile
if (-not (Test-Path $rolesFile)) { $rolesFile = Join-Path $root 'roles.example.json' }
$known = @()
# Windows PowerShell 5.1 は既定で ANSI として読むので、UTF-8 を指定する
if (Test-Path $rolesFile) { $known = @((Get-Content $rolesFile -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties.Name) }

if (-not $Roles) {
  if ($known.Count -eq 0) { throw "role の一覧がない ($rolesFile)。-Roles で指定する" }
  Write-Host "起動する role を選ぶ ($(Split-Path $rolesFile -Leaf)):"
  for ($i = 0; $i -lt $known.Count; $i++) { Write-Host ("  {0}) {1}" -f ($i + 1), $known[$i]) }
  $answer = Read-Host '番号をカンマ区切りで (例 1,2)。all で全部、空で中止'
  if (-not $answer.Trim()) { Write-Host '中止した'; return }
  if ($answer.Trim() -eq 'all') { $Roles = $known }
  else {
    $Roles = foreach ($n in ($answer -split '[,\s]+' | Where-Object { $_ })) {
      $idx = 0
      if (-not [int]::TryParse($n, [ref]$idx) -or $idx -lt 1 -or $idx -gt $known.Count) { throw "番号 $n は範囲外" }
      $known[$idx - 1]
    }
  }
}
# 選んだ順を保ち、重複は除く
$Roles = @($Roles | Select-Object -Unique)
# Hub は roles.json にない role を 400 で拒み、shim は attach を繰り返すだけになる。ここで止める
# 大文字小文字を区別する (Hub と同じ)
$unknown = @($Roles | Where-Object { $known.Count -gt 0 -and $known -cnotcontains $_ })
if ($unknown.Count -gt 0 -and (Test-Path $hubRolesFile)) { throw "role ファイル ($hubRolesFile) にない role: $($unknown -join ', ')" }

# --- build (shim は dist/ から起動される) ---
$dist = Join-Path $root 'dist/shim/main.js'
if (-not $NoBuild) {
  $stale = -not (Test-Path $dist)
  if (-not $stale) {
    $built = (Get-Item $dist).LastWriteTime
    $stale = [bool](Get-ChildItem (Join-Path $root 'src') -Recurse -Filter *.ts | Where-Object { $_.Name -notlike '*.test.ts' -and $_.LastWriteTime -gt $built } | Select-Object -First 1)
  }
  if ($stale) {
    Write-Host 'dist/ が src/ より古いので build する'
    Push-Location $root
    try { npm run build; if ($LASTEXITCODE -ne 0) { throw 'build に失敗した' } } finally { Pop-Location }
  }
}

# --- Hub ---
if (Test-HubPort) {
  Write-Host "Hub は起動済み ($hubUrl)"
} else {
  Write-Host "Hub を起動する ($hubUrl)"
  Start-Tab 'hub' @('-NoExit', '-Command', 'npm run hub')
  $deadline = (Get-Date).AddSeconds(30)
  while (-not (Test-HubPort)) {
    if ((Get-Date) -gt $deadline) { throw "Hub が 30 秒以内に起動しなかった。hub のタブを確認する" }
    Start-Sleep -Milliseconds 500
  }
  Write-Host 'Hub が起動した。UI の URL は hub のタブに出る'
}
if (-not $token) { Write-Warning 'HUB_TOKEN がないので attach を確かめられない。待たずに起動だけする' }

# --- role を 1 つずつ ---
# Mailbox 名は start-agent.ps1 と同じく <プロジェクトのフォルダ名>.<role>
foreach ($role in $Roles) {
  $mailbox = Get-DefaultMailbox $projectDir $role
  if ($token -and -not $Force -and (Test-Attached $mailbox)) {
    Write-Host "$mailbox は接続中なので飛ばす (起動し直すなら -Force)"
    continue
  }
  Write-Host "$mailbox を起動する ($projectDir)"
  Start-Tab $mailbox @('-NoExit', '-File', $agentScript, '-Role', $role, '-Project', $projectDir)
  if (-not $token) { Start-Sleep -Seconds 3; continue }
  $deadline = (Get-Date).AddSeconds($AttachTimeout)
  while (-not (Test-Attached $mailbox)) {
    if ((Get-Date) -gt $deadline) {
      Write-Warning "$mailbox が $AttachTimeout 秒以内に attach しなかった。タブを確認する (初回の警告ダイアログ、claude の起動エラーなど)。次へ進む"
      break
    }
    Start-Sleep -Seconds 1
  }
  if (Test-Attached $mailbox) { Write-Host "$mailbox が attach した" }
}
Write-Host '完了'
