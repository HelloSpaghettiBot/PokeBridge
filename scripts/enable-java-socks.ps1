$ErrorActionPreference = 'Stop'

$IniPath = 'C:\Program Files\PokeMMO\PokeMMO.l4j.ini'
$BackupPath = "$IniPath.codex-bridge-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$BeginMarker = '# BEGIN tcp-bridge-lab java socks'
$EndMarker = '# END tcp-bridge-lab java socks'
$BlockLines = @(
  $BeginMarker,
  '-DsocksProxyHost=127.0.0.1',
  '-DsocksProxyPort=1080',
  '-Djava.net.preferIPv4Stack=true',
  $EndMarker
)

if (-not (Test-Path -LiteralPath $IniPath)) {
  throw "Launch4j ini not found: $IniPath"
}

$Original = Get-Content -Raw -LiteralPath $IniPath
Copy-Item -LiteralPath $IniPath -Destination $BackupPath -Force

$Pattern = "(?ms)^$([regex]::Escape($BeginMarker)).*?$([regex]::Escape($EndMarker))\r?\n?"
$Cleaned = [regex]::Replace($Original, $Pattern, '')
$Separator = if ($Cleaned.EndsWith([Environment]::NewLine)) { '' } else { [Environment]::NewLine }
$Updated = "$Cleaned$Separator$($BlockLines -join [Environment]::NewLine)$([Environment]::NewLine)"

Set-Content -LiteralPath $IniPath -Value $Updated -Encoding ASCII

Write-Output "Java SOCKS proxy enabled for PokeMMO Launch4j config."
Write-Output "SOCKS endpoint: 127.0.0.1:1080"
Write-Output "Backup: $BackupPath"
Write-Output "Restart the official client for this to take effect."
