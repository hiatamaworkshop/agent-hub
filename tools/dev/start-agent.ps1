# role を指定して Claude Code を channel 有効で起動する (2 エージェントの往復を試す開発用)。
# role の説明は roles.json の description が shim の instructions に入る。tools/dev/roles/<role>.md があれば
# 運用の細かい指示として system prompt にも足す (leader / deployer だけ。reviewer などは roles.json の説明だけで動く)
param(
  [Parameter(Mandatory)][string]$Role,
  # 省略時は deployer だけ haiku、leader は既定のモデル
  [string]$Model,
  # 省略時は Mailbox 名 = role 名
  [string]$Mailbox
)

$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
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

$claudeArgs = @(
  '--mcp-config', (Join-Path $root 'tools/dev/mcp.json'),
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
