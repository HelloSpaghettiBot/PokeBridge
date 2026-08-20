$ErrorActionPreference = 'Stop'

$IniPath = 'C:\Program Files\PokeMMO\PokeMMO.l4j.ini'
$BeginMarker = '# BEGIN tcp-bridge-lab java socks'
$EndMarker = '# END tcp-bridge-lab java socks'

if (-not (Test-Path -LiteralPath $IniPath)) {
  throw "Launch4j ini not found: $IniPath"
}

$Original = Get-Content -Raw -LiteralPath $IniPath
$Pattern = "(?ms)^$([regex]::Escape($BeginMarker)).*?$([regex]::Escape($EndMarker))\r?\n?"
$Updated = [regex]::Replace($Original, $Pattern, '')

Set-Content -LiteralPath $IniPath -Value $Updated -Encoding ASCII

Write-Output "Java SOCKS proxy disabled for PokeMMO Launch4j config."
Write-Output "Restart the official client for this to take effect."
