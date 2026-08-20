$ErrorActionPreference = 'Stop'

$Processes = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq 'node.exe' -and
    $_.CommandLine -like '*src/cli.js*' -and
    $_.CommandLine -like '*--config*'
  }

if (-not $Processes) {
  Write-Output 'Bridge is not running.'
  exit 0
}

foreach ($Process in $Processes) {
  Stop-Process -Id $Process.ProcessId -Force
  Write-Output "Stopped bridge: pid=$($Process.ProcessId)"
}
