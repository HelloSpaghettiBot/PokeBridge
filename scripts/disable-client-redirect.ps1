$ErrorActionPreference = 'Stop'

$HostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
$BeginMarker = '# BEGIN tcp-bridge-lab managed redirect'
$EndMarker = '# END tcp-bridge-lab managed redirect'

if (-not (Test-Path -LiteralPath $HostsPath)) {
  throw "Hosts file not found: $HostsPath"
}

$Original = Get-Content -Raw -LiteralPath $HostsPath
$Pattern = "(?ms)^$([regex]::Escape($BeginMarker)).*?$([regex]::Escape($EndMarker))\r?\n?"
$Updated = [regex]::Replace($Original, $Pattern, '')

Set-Content -LiteralPath $HostsPath -Value $Updated -Encoding ASCII
Clear-DnsClientCache

Write-Output "Hosts redirect disabled for loginserver.pokemmo.com"
