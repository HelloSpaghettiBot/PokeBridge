$ErrorActionPreference = 'Stop'

$HostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
$BackupPath = "$HostsPath.codex-bridge-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$BeginMarker = '# BEGIN tcp-bridge-lab managed redirect'
$EndMarker = '# END tcp-bridge-lab managed redirect'
$ManagedBlock = @(
  $BeginMarker,
  '127.0.0.1 loginserver.pokemmo.com',
  $EndMarker
) -join [Environment]::NewLine

if (-not (Test-Path -LiteralPath $HostsPath)) {
  throw "Hosts file not found: $HostsPath"
}

$Original = Get-Content -Raw -LiteralPath $HostsPath
Copy-Item -LiteralPath $HostsPath -Destination $BackupPath -Force

$Pattern = "(?ms)^$([regex]::Escape($BeginMarker)).*?$([regex]::Escape($EndMarker))\r?\n?"
if ($Original -match $Pattern) {
  $Updated = [regex]::Replace($Original, $Pattern, "$ManagedBlock$([Environment]::NewLine)")
} else {
  $Separator = if ($Original.EndsWith([Environment]::NewLine)) { '' } else { [Environment]::NewLine }
  $Updated = "$Original$Separator$ManagedBlock$([Environment]::NewLine)"
}

Set-Content -LiteralPath $HostsPath -Value $Updated -Encoding ASCII
Clear-DnsClientCache

Write-Output "Hosts redirect enabled: loginserver.pokemmo.com -> 127.0.0.1"
Write-Output "Backup: $BackupPath"
