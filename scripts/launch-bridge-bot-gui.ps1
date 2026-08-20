param(
  [int]$ClientProcessId = 19160,
  [switch]$AutoStart,
  [switch]$AutoExplore
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$GuiScript = Join-Path $ProjectRoot 'scripts\bridge-bot-gui.ps1'
$arguments = @('-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', $GuiScript, '-ClientProcessId', "$ClientProcessId")
if ($AutoStart) { $arguments += '-AutoStart' }
if ($AutoExplore) { $arguments += '-AutoExplore' }
$process = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WorkingDirectory $ProjectRoot -WindowStyle Normal -PassThru
Write-Output "Bridge Trainer GUI pid=$($process.Id)"
