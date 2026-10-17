# role を指定して Claude Code を channel 有効で起動する。
# role の説明は roles.json の description が shim の instructions に入る。tools/dev/roles/<role>.md があれば
# 運用の細かい指示として system prompt にも足す (leader / deployer だけ。reviewer などは roles.json の説明だけで動く)
# 例: ./tools/dev/start-agent.ps1 -Role deployer -Project C:\work\cairn
param(
  [Parameter(Mandatory)][string]$Role,
  # 作業するプロジェクトのルート。claude はここで起動する (design.md §3.3)。省略時は agent-hub
  [string]$Project,
  # 省略時は deployer だけ haiku、leader は既定のモデル
  [string]$Model,
  # 省略時は <プロジェクトのフォルダ名>.<role> (shim の既定と同じ規則)
  [string]$Mailbox
)

$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
. (Join-Path $PSScriptRoot 'mailbox-name.ps1')
# 別の場所から起動すると、読むべき CLAUDE.md や hook を読まずに迷うので、プロジェクトのルートに移って起動する
if ($Project) {
  if (-not (Test-Path -LiteralPath $Project -PathType Container)) { throw "プロジェクトのフォルダ $Project がない" }
  $projectDir = (Resolve-Path -LiteralPath $Project).Path
} else {
  $projectDir = $root
}
if (-not $Mailbox) { $Mailbox = Get-DefaultMailbox $projectDir $Role }
$envFile = Join-Path $root '.env'
# roles ファイルは Hub と同じ順に決める: 環境変数 HUB_ROLES_FILE → .env の HUB_ROLES_FILE → <リポジトリ>/roles.json。相対パスはリポジトリ直下から解決する
$rolesFile = $env:HUB_ROLES_FILE
if (-not $rolesFile -and (Test-Path $envFile)) {
  $line = Get-Content $envFile -Encoding UTF8 | Where-Object { $_ -match '^\s*HUB_ROLES_FILE\s*=' } | Select-Object -Last 1
  if ($line) { $rolesFile = ($line -replace '^\s*HUB_ROLES_FILE\s*=\s*', '').Trim().Trim('"', "'") }
}
$rolesFile = if ($rolesFile) { [System.IO.Path]::Combine($root, $rolesFile) } else { Join-Path $root 'roles.json' }
# roles ファイルにない role は、Hub が 400 unknown_role を返し shim が attach を繰り返すだけになる。claude を起動する前に止める
# ファイルがなければ確かめない (Hub も role 名を検査しない)。Hub と同じく名前は大文字小文字を区別する
if (Test-Path $rolesFile) {
  # Windows PowerShell 5.1 は既定で ANSI として読むので、UTF-8 を指定する
  $known = @((Get-Content $rolesFile -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties.Name)
  if ($known -cnotcontains $Role) { throw "role $Role は $rolesFile にない (有効な role: $($known -join ', '))" }
}
if (-not $Model -and $Role -eq 'deployer') { $Model = 'haiku' }

# shim は agent-hub の dist/ を絶対パスで指す (tools/dev/mcp.json は CLAUDE_PROJECT_DIR からの相対なので、agent-hub の外では使えない)。
# 中身は agent-hub の場所だけで決まるので、同時に起動しても同じ内容になる。PowerShell 5.1 の UTF8 は BOM を付けるので使わない
$mcpConfig = Join-Path ([System.IO.Path]::GetTempPath()) 'agent-hub-mcp.json'
$mcpJson = @{ mcpServers = @{ 'agent-hub' = @{ command = 'node'; args = @((Join-Path $root 'dist/shim/main.js')) } } } | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($mcpConfig, $mcpJson, (New-Object System.Text.UTF8Encoding $false))
$claudeArgs = @(
  '--mcp-config', $mcpConfig,
  '--dangerously-load-development-channels', 'server:agent-hub'
)
$roleFile = Join-Path $root "tools/dev/roles/$Role.md"
if (Test-Path $roleFile) { $claudeArgs += @('--append-system-prompt-file', $roleFile) }
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
if (-not $token -and (Test-Path $envFile)) {
  $line = Get-Content $envFile | Where-Object { $_ -match '^\s*HUB_TOKEN\s*=' } | Select-Object -Last 1
  if ($line) { $token = ($line -replace '^\s*HUB_TOKEN\s*=\s*', '').Trim().Trim('"', "'") }
}

# hook は起動したフォルダの .claude/settings.local.json か ~/.claude/settings.json からしか読まれない (--settings は 2.1.301 で誤動作した。design.md §6.1f)。
# どちらにも Hub の /events がなければ、Event が UI に出ないことを知らせる (起動は止めない)
$hookFiles = @((Join-Path $projectDir '.claude/settings.local.json'), (Join-Path $projectDir '.claude/settings.json'), (Join-Path $HOME '.claude/settings.json'))
$hooked = $hookFiles | Where-Object { (Test-Path $_) -and ((Get-Content $_ -Raw -Encoding UTF8) -match '/events') }
if (-not $hooked) { Write-Warning "hook の設定が見つからないので、質問待ち・ターン終了は UI に出ない。tools/hooks/settings.json の hooks を ~/.claude/settings.json に写す (README)" }

Write-Host "project: $projectDir / Mailbox: $Mailbox"
# 起動したシェルに HUB_ROLE / HUB_MAILBOX / HUB_TOKEN を残さない
$saved = @{ HUB_ROLE = $env:HUB_ROLE; HUB_MAILBOX = $env:HUB_MAILBOX; HUB_TOKEN = $env:HUB_TOKEN }
Push-Location $projectDir
try {
  $env:HUB_ROLE = $Role
  # shim の既定と同じ名前でも明示する。hook の X-Hub-Mailbox ヘッダーにも載せるため (cwd のフォルダ名だけでは <フォルダ名>.<role> を引けない)
  $env:HUB_MAILBOX = $Mailbox
  $env:HUB_TOKEN = $token
  claude @claudeArgs
} finally {
  $env:HUB_ROLE = $saved.HUB_ROLE
  $env:HUB_MAILBOX = $saved.HUB_MAILBOX
  $env:HUB_TOKEN = $saved.HUB_TOKEN
  Pop-Location
}
