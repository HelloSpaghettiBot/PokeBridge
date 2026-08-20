$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$OutLogPath = Join-Path $ProjectRoot 'logs\insertion-monitor.out.log'
$ErrLogPath = Join-Path $ProjectRoot 'logs\insertion-monitor.err.log'

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutLogPath) | Out-Null

$Existing = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq 'node.exe' -and
    $_.CommandLine -like '*scripts/monitor-insertion.js*'
  }

if ($Existing) {
  $Existing | ForEach-Object { Write-Output "Insertion monitor already running: pid=$($_.ProcessId)" }
  exit 0
}

Start-Process -FilePath 'node.exe' `
  -ArgumentList @('scripts/monitor-insertion.js', '--start-now') `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $OutLogPath `
  -RedirectStandardError $ErrLogPath

Write-Output "Insertion monitor started."
Write-Output "Monitor stdout log: $OutLogPath"
Write-Output "Monitor stderr log: $ErrLogPath"
