# 起動の前の検査 (claude が動くか、hook の設定、checkout の古さ) と、start-agent.ps1 が終わりを残すファイル。
# start-agent.ps1 と start-team.ps1 が dot-source する (roadmap C56〜C58)

# PowerShell の単一引用符の文字列に入れる
function ConvertTo-PsQuoted([string]$s) { return "'" + ($s -replace "'", "''") + "'" }

# start-agent.ps1 が claude の終わりを書くファイル。start-team.ps1 は起動の前に消し、attach を待つ間に現れたら失敗と読む (C56)
function Get-StartStatusPath([string]$Mailbox) {
  return Join-Path ([System.IO.Path]::GetTempPath()) "agent-hub-start/$Mailbox.json"
}

# claude --version を流し、失敗したら出力の先頭の行を返す (動けば $null)。
# NVM が claude.cmd を止めたとき (NVM4306) も同じ文が出る。対話の claude の出力はリダイレクトしないので、理由はここで取る
function Test-ClaudeCli {
  $ErrorActionPreference = 'Continue'
  try {
    $out = @(& claude --version 2>&1 | ForEach-Object { "$_" })
    if ($LASTEXITCODE -eq 0) { return $null }
    $lines = @($out | Where-Object { $_.Trim() } | Select-Object -First 3)
    if ($lines.Count -eq 0) { return "claude --version が終了コード $LASTEXITCODE で終わった" }
    return ($lines -join ' / ')
  } catch {
    return "claude を起動できない: $($_.Exception.Message)"
  }
}

# hook の設定 (Hub の /events) を、claude が読む 3 つのファイルで探す。なければ警告の文を返す (あれば $null)。
# 置き直すコマンドを添える。settings.local.json があるときは上書きさせない (C57)
function Get-HookWarning([string]$ProjectDir, [string]$Root) {
  $local = Join-Path $ProjectDir '.claude/settings.local.json'
  $files = @($local, (Join-Path $ProjectDir '.claude/settings.json'), (Join-Path $HOME '.claude/settings.json'))
  $hooked = $files | Where-Object { (Test-Path -LiteralPath $_) -and ((Get-Content -LiteralPath $_ -Raw -Encoding UTF8) -match '/events') }
  if ($hooked) { return $null }
  $src = Join-Path $Root 'tools/hooks/settings.json'
  $head = "hook の設定が見つからない ($ProjectDir)。質問待ち・ターン終了は UI に出ない。"
  if (-not (Test-Path -LiteralPath $local)) {
    $cmd = "New-Item -ItemType Directory -Force $(ConvertTo-PsQuoted (Join-Path $ProjectDir '.claude')) | Out-Null; Copy-Item $(ConvertTo-PsQuoted $src) $(ConvertTo-PsQuoted $local)"
    return "$head 置き直すには: $cmd"
  }
  return "$head $local はあるが Hub の hook がない。上書きせず、$src の hooks を手で足す"
}

# git を入力待ちなしで流す。@{ code; out; err; timedOut } を返す
function Invoke-GitQuiet([string]$Dir, [string]$GitArgs, [int]$TimeoutSec = 10) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'git'
  $psi.Arguments = "-C `"$Dir`" $GitArgs"
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
  # 資格情報を尋ねさせない (端末・Git Credential Manager の画面・ssh のパスフレーズ)
  $psi.EnvironmentVariables['GIT_TERMINAL_PROMPT'] = '0'
  $psi.EnvironmentVariables['GCM_INTERACTIVE'] = 'never'
  if (-not $psi.EnvironmentVariables['GIT_SSH_COMMAND']) { $psi.EnvironmentVariables['GIT_SSH_COMMAND'] = 'ssh -o BatchMode=yes' }
  try { $p = [System.Diagnostics.Process]::Start($psi) } catch { return @{ code = -1; out = ''; err = $_.Exception.Message; timedOut = $false } }
  $outTask = $p.StandardOutput.ReadToEndAsync()
  $errTask = $p.StandardError.ReadToEndAsync()
  if (-not $p.WaitForExit($TimeoutSec * 1000)) {
    # 子の git-remote-https なども残さない (Process.Kill は PowerShell 5.1 で木ごと消せない)
    & taskkill.exe /PID $p.Id /T /F 2>&1 | Out-Null
    return @{ code = -1; out = ''; err = ''; timedOut = $true }
  }
  $p.WaitForExit()
  return @{ code = $p.ExitCode; out = $outTask.Result.Trim(); err = $errTask.Result.Trim(); timedOut = $false }
}

# checkout が古いときの警告の文を返す (なければ空)。git のリポジトリでなければ黙って空を返す。
# fetch の失敗・時間切れは警告にして進む。止めない (C58)
function Get-CheckoutWarnings([string]$ProjectDir, [int]$FetchTimeoutSec = 15) {
  $warnings = @()
  $inside = Invoke-GitQuiet $ProjectDir 'rev-parse --is-inside-work-tree'
  if ($inside.code -ne 0 -or $inside.out -ne 'true') { return $warnings }
  $fetch = Invoke-GitQuiet $ProjectDir 'fetch --quiet' $FetchTimeoutSec
  if ($fetch.timedOut) {
    $warnings += "git fetch が $FetchTimeoutSec 秒で終わらなかった ($ProjectDir)。origin との比べは前回の fetch の時点"
  } elseif ($fetch.code -ne 0) {
    $first = @($fetch.err -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 1)
    $warnings += "git fetch に失敗した ($ProjectDir): $first。origin との比べは前回の fetch の時点"
  }
  $branch = (Invoke-GitQuiet $ProjectDir 'rev-parse --abbrev-ref HEAD').out
  if ($branch -eq 'HEAD') {
    $sha = (Invoke-GitQuiet $ProjectDir 'rev-parse --short HEAD').out
    $msg = "detached HEAD ($sha) で起動する ($ProjectDir)。submodule なら古い版のことがある"
    $def = Invoke-GitQuiet $ProjectDir 'rev-parse --abbrev-ref origin/HEAD'
    if ($def.code -eq 0 -and $def.out) {
      $behind = (Invoke-GitQuiet $ProjectDir "rev-list --count HEAD..$($def.out)").out
      if ($behind -and [int]$behind -gt 0) { $msg += "。$($def.out) より $behind コミット遅れている" }
    }
    $warnings += $msg
    return $warnings
  }
  $up = Invoke-GitQuiet $ProjectDir 'rev-parse --abbrev-ref --symbolic-full-name @{u}'
  if ($up.code -ne 0 -or -not $up.out) {
    $warnings += "ブランチ $branch に upstream が無い ($ProjectDir)。origin と比べられない"
    return $warnings
  }
  $behind = (Invoke-GitQuiet $ProjectDir 'rev-list --count HEAD..@{u}').out
  if ($behind -and [int]$behind -gt 0) { $warnings += "$branch は $($up.out) より $behind コミット遅れている ($ProjectDir)。pull してから起動する" }
  return $warnings
}
