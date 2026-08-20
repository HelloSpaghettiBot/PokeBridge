param(
  [string]$ConfigPath = 'bridge.config.json'
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$ResolvedConfigPath = if ([System.IO.Path]::IsPathRooted($ConfigPath)) {
  $ConfigPath
} else {
  Join-Path $ProjectRoot $ConfigPath
}
$SocksCapturePath = Join-Path $ProjectRoot 'captures\socks-session.000000.jsonl'
if (-not (Test-Path -LiteralPath $SocksCapturePath)) {
  $SocksCapturePath = Join-Path $ProjectRoot 'captures\socks-session.jsonl'
}
$PokeMmOIniPath = 'C:\Program Files\PokeMMO\PokeMMO.l4j.ini'
$ClientProcessNames = @('PokeMMO', 'java', 'javaw')

if (-not (Test-Path -LiteralPath $ResolvedConfigPath)) {
  throw "Bridge config not found: $ResolvedConfigPath"
}

$Config = Get-Content -Raw -LiteralPath $ResolvedConfigPath | ConvertFrom-Json
$Routes = if ($Config.routes) { @($Config.routes) } else { @($Config) }

$BridgeProcesses = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq 'node.exe' -and
    $_.CommandLine -like '*src/cli.js*' -and
    $_.CommandLine -like '*--config*'
  }
$BridgeProcessIds = [System.Collections.Generic.HashSet[int]]::new()
foreach ($ProcessId in @($BridgeProcesses | Select-Object -ExpandProperty ProcessId)) {
  $BridgeProcessIds.Add([int]$ProcessId) | Out-Null
}

$SocksProcesses = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq 'node.exe' -and
    $_.CommandLine -like '*scripts/socks-cli.js*'
  }

$ClientProcesses = Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $ClientProcessNames -contains $_.ProcessName }
$ClientProcessIds = @($ClientProcesses | Select-Object -ExpandProperty Id)

$ClientConnections = if ($ClientProcessIds.Count -gt 0) {
  Get-NetTCPConnection -ErrorAction SilentlyContinue |
    Where-Object { $ClientProcessIds -contains $_.OwningProcess } |
    Select-Object OwningProcess,@{ Name = 'State'; Expression = { $_.State.ToString() } },LocalAddress,LocalPort,RemoteAddress,RemotePort
} else {
  @()
}

$HostsLines = Get-Content "$env:SystemRoot\System32\drivers\etc\hosts" -ErrorAction SilentlyContinue
$HostsRedirectActive = [bool]($HostsLines | Select-String -Pattern '^\s*127\.0\.0\.1\s+loginserver\.pokemmo\.com\s*$')
$IniLines = if (Test-Path -LiteralPath $PokeMmOIniPath) { Get-Content -LiteralPath $PokeMmOIniPath } else { @() }
$JavaSocksEnabled = [bool]($IniLines | Select-String -Pattern '^-DsocksProxyHost=127\.0\.0\.1$') -and
  [bool]($IniLines | Select-String -Pattern '^-DsocksProxyPort=1080$')

$SocksListeners = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 1080 -ErrorAction SilentlyContinue |
  Where-Object { $_.State -eq 'Listen' }

$RecentSocksTargets = @()
if (Test-Path -LiteralPath $SocksCapturePath) {
  $RecentSocksTargets = Get-Content -LiteralPath $SocksCapturePath -Tail 200 |
    ForEach-Object {
      try { $_ | ConvertFrom-Json } catch { $null }
    } |
    Where-Object { $_ -and $_.type -eq 'socks_connect' } |
    Select-Object -Last 20 timestamp,target
}

$DnsRecords = Resolve-DnsName loginserver.pokemmo.com -ErrorAction SilentlyContinue |
  Select-Object Name,Type,IPAddress

$RouteReports = foreach ($Route in $Routes) {
  $Listeners = Get-NetTCPConnection -LocalAddress $Route.listenHost -LocalPort $Route.listenPort -ErrorAction SilentlyContinue |
    Where-Object { $_.State -eq 'Listen' }
  foreach ($ListenerProcessId in @($Listeners | Select-Object -ExpandProperty OwningProcess)) {
    $BridgeProcessIds.Add([int]$ListenerProcessId) | Out-Null
  }
  $DirectConnections = @($ClientConnections | Where-Object {
    $_.RemoteAddress -eq $Route.upstreamHost -and
    [int]$_.RemotePort -eq [int]$Route.upstreamPort -and
    $_.State -eq 'Established'
  })
  $BridgeConnections = @($ClientConnections | Where-Object {
    ($_.RemoteAddress -eq '127.0.0.1' -or $_.RemoteAddress -eq '::1' -or $_.RemoteAddress -eq $Route.listenHost) -and
    [int]$_.RemotePort -eq [int]$Route.listenPort -and
    $_.State -eq 'Established'
  })

  [pscustomobject]@{
    Listen = "$($Route.listenHost):$($Route.listenPort)"
    Upstream = "$($Route.upstreamHost):$($Route.upstreamPort)"
    ListenerActive = [bool]$Listeners
    ListenerProcessIds = @($Listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    ClientDirectConnections = $DirectConnections.Count
    ClientBridgeConnections = $BridgeConnections.Count
  }
}

$Summary = [pscustomobject]@{
  Timestamp = (Get-Date).ToString('o')
  ConfigPath = $ResolvedConfigPath
  BridgeProcessIds = @($BridgeProcessIds | Sort-Object)
  SocksProcessIds = @($SocksProcesses | Select-Object -ExpandProperty ProcessId)
  ClientProcessIds = $ClientProcessIds
  HostsRedirectActive = $HostsRedirectActive
  JavaSocksEnabled = $JavaSocksEnabled
  SocksListenerActive = [bool]$SocksListeners
  RecentSocksTargets = @($RecentSocksTargets)
  LoginDnsRecords = @($DnsRecords)
  Routes = @($RouteReports)
}

$Summary | ConvertTo-Json -Depth 8
