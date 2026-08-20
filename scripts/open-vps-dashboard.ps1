param(
  [string]$HostAlias = 'cerabot-vps',
  [string]$DashboardUrl = 'https://tech.luls.lol/pokemmo/'
)

$ErrorActionPreference = 'Stop'
$token = (& ssh $HostAlias "sed -n 's/^POKEMMO_DASHBOARD_TOKEN=//p' /etc/pokemmo-headless.env").Trim()
if ($LASTEXITCODE -ne 0 -or $token -notmatch '^[A-Fa-f0-9]{64}$') {
  throw 'Could not retrieve a valid dashboard token from the VPS.'
}

$separator = if ($DashboardUrl.Contains('?')) { '&' } else { '?' }
$accessUrl = "${DashboardUrl}${separator}token=$([Uri]::EscapeDataString($token))"
$brave = 'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe'
if (Test-Path -LiteralPath $brave) {
  Start-Process -FilePath $brave -ArgumentList $accessUrl
} else {
  Start-Process $accessUrl
}
$token = $null
Write-Host "Opened $DashboardUrl in your default browser."
