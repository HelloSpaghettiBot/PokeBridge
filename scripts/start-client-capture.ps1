$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$ClientPath = 'C:\Program Files\PokeMMO\PokeMMO.exe'
$CapturePath = Join-Path $ProjectRoot 'captures\client-connections.jsonl'
$ConfigPath = Join-Path $ProjectRoot 'bridge.config.json'
$WatcherScript = Join-Path $ProjectRoot 'scripts\watch-client-connections.js'

if (-not (Test-Path -LiteralPath $ClientPath)) {
  throw "Client not found: $ClientPath"
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $CapturePath) | Out-Null

$WatcherArgs = @(
  $WatcherScript,
  '--out',
  $CapturePath,
  '--config-out',
  $ConfigPath,
  '--interval-ms',
  '500'
)

Start-Process -FilePath 'node.exe' -ArgumentList $WatcherArgs -WindowStyle Hidden -WorkingDirectory $ProjectRoot
Start-Process -FilePath $ClientPath -WorkingDirectory (Split-Path -Parent $ClientPath)

Write-Output "Connection watcher started: $CapturePath"
Write-Output "Bridge config will be generated when Connect succeeds: $ConfigPath"
Write-Output "Official client launched. Log in manually and click Connect; the remote endpoint will be appended to the capture file."
