param(
  [string]$ConfigPath = 'bridge.intercept.config.json'
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$ResolvedConfigPath = if ([System.IO.Path]::IsPathRooted($ConfigPath)) {
  $ConfigPath
} else {
  Join-Path $ProjectRoot $ConfigPath
}
$RuntimeConfigPath = Join-Path $ProjectRoot 'bridge.config.json'

if (-not (Test-Path -LiteralPath $ResolvedConfigPath)) {
  throw "Intercept config not found: $ResolvedConfigPath"
}

$WatcherProcesses = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq 'node.exe' -and
    $_.CommandLine -like '*watch-client-connections.js*' -and
    $_.CommandLine -like '*--config-out*'
  }

foreach ($Process in $WatcherProcesses) {
  Stop-Process -Id $Process.ProcessId -Force
  Write-Output "Stopped config-writing watcher: pid=$($Process.ProcessId)"
}

& (Join-Path $ProjectRoot 'scripts\enable-ip-intercept.ps1')

Copy-Item -LiteralPath $ResolvedConfigPath -Destination $RuntimeConfigPath -Force
Write-Output "Runtime bridge config set to: $RuntimeConfigPath"

& (Join-Path $ProjectRoot 'scripts\stop-bridge.ps1')
& (Join-Path $ProjectRoot 'scripts\start-bridge.ps1') -ConfigPath $RuntimeConfigPath

& (Join-Path $ProjectRoot 'scripts\audit-insertion.ps1') -ConfigPath $RuntimeConfigPath
