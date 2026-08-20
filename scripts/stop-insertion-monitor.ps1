$ErrorActionPreference = 'Stop'

$Processes = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq 'node.exe' -and
    $_.CommandLine -like '*scripts/monitor-insertion.js*'
  }

if (-not $Processes) {
  Write-Output 'Insertion monitor is not running.'
  exit 0
}

foreach ($Process in $Processes) {
  Stop-Process -Id $Process.ProcessId -Force
  Write-Output "Stopped insertion monitor: pid=$($Process.ProcessId)"
}
