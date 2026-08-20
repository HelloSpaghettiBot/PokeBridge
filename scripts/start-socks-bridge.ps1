$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$OutLogPath = Join-Path $ProjectRoot 'logs\socks.out.log'
$ErrLogPath = Join-Path $ProjectRoot 'logs\socks.err.log'

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutLogPath) | Out-Null

$Existing = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq 'node.exe' -and
    $_.CommandLine -like '*scripts/socks-cli.js*'
  }

if ($Existing) {
  $Existing | ForEach-Object { Write-Output "SOCKS bridge already running: pid=$($_.ProcessId)" }
  exit 0
}

Start-Process -FilePath 'node.exe' `
  -ArgumentList @('scripts/socks-cli.js') `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $OutLogPath `
  -RedirectStandardError $ErrLogPath

Write-Output "SOCKS bridge started on 127.0.0.1:1080"
Write-Output "SOCKS stdout log: $OutLogPath"
Write-Output "SOCKS stderr log: $ErrLogPath"
