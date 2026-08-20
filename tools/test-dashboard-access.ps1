param([string]$HostAlias='cerabot-vps')
$ErrorActionPreference='Stop'
$secret = (& ssh $HostAlias "sed -n 's/^POKEMMO_DASHBOARD_TOKEN=//p' /etc/pokemmo-headless.env").Trim()
try {
  $cookieFile=Join-Path $env:TEMP "pokemmo-cookie-$([guid]::NewGuid().ToString('N')).txt"
  $bootstrap = & curl.exe -sS -L -c $cookieFile -o NUL -w '%{http_code} %{url_effective}' "https://tech.luls.lol/pokemmo/?token=$secret"
  $state = & curl.exe -sS -b $cookieFile -o NUL -w '%{http_code}' 'https://tech.luls.lol/pokemmo/api/state'
  $cookiePresent=[bool](Get-Content $cookieFile | Select-String -SimpleMatch 'pokemmo_token')
  [pscustomobject]@{ Bootstrap=$bootstrap; StateStatus=$state; CookiePresent=$cookiePresent }
} finally {
  if($cookieFile){Remove-Item -LiteralPath $cookieFile -Force -ErrorAction SilentlyContinue}
  $secret=$null
}
