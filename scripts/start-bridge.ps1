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
$OutLogPath = Join-Path $ProjectRoot 'logs\bridge.out.log'
$ErrLogPath = Join-Path $ProjectRoot 'logs\bridge.err.log'

if (-not (Test-Path -LiteralPath $ResolvedConfigPath)) {
  throw "Bridge config not found: $ResolvedConfigPath"
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutLogPath) | Out-Null

$Existing = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq 'node.exe' -and
    $_.CommandLine -like '*src/cli.js*' -and
    $_.CommandLine -like "*$ResolvedConfigPath*"
  }

if ($Existing) {
  $Existing | ForEach-Object { Write-Output "Bridge already running: pid=$($_.ProcessId)" }
  exit 0
}

$Arguments = @(
  'src/cli.js',
  '--config',
  $ResolvedConfigPath
)

Start-Process -FilePath 'node.exe' `
  -ArgumentList $Arguments `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $OutLogPath `
  -RedirectStandardError $ErrLogPath

Write-Output "Bridge started with config: $ResolvedConfigPath"
Write-Output "Bridge stdout log: $OutLogPath"
Write-Output "Bridge stderr log: $ErrLogPath"
