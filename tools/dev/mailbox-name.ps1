# Mailbox 名の既定を shim と同じ規則で求める (src/shared/types.ts の mailboxFromFolder / defaultMailboxName。design.md §3.3)。
# start-agent.ps1 と start-team.ps1 が dot-source する

# フォルダ名を Mailbox 名の規則に寄せる。寄せられなければ main
function ConvertTo-MailboxName([string]$Dir) {
  $leaf = "$(@($Dir -split '[\\/]+' | Where-Object { $_ }) | Select-Object -Last 1)"
  $s = ($leaf.ToLowerInvariant() -creplace '[^a-z0-9_.-]+', '-') -creplace '^[^a-z0-9]+', ''
  if ($s.Length -gt 64) { $s = $s.Substring(0, 64) }
  if ($s -cmatch '^[a-z0-9][a-z0-9_.-]{0,63}$') { return $s }
  return 'main'
}

# role があれば <フォルダ名>.<role>。64 文字に収まるようフォルダ名の側を切る
function Get-DefaultMailbox([string]$Dir, [string]$Role) {
  $folder = ConvertTo-MailboxName $Dir
  if (-not $Role) { return $folder }
  $room = 63 - $Role.Length
  if ($room -le 0) { return $Role }
  if ($folder.Length -gt $room) { $folder = $folder.Substring(0, $room) }
  return "$folder.$Role"
}
