param([int]$ProcessId = 0)

$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class TrainerCardKeyNative {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
}
"@

$Process = if ($ProcessId -gt 0) {
  Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
} else {
  Get-Process | Where-Object {
    $_.MainWindowHandle -ne 0 -and $_.ProcessName -eq 'javaw' -and $_.Path -eq 'C:\Program Files\PokeMMO\jre\bin\javaw.exe'
  } | Sort-Object StartTime -Descending | Select-Object -First 1
}

if (-not $Process -or $Process.MainWindowHandle -eq 0) { throw 'The official PokeMMO window is not available.' }
[TrainerCardKeyNative]::SetForegroundWindow($Process.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 180
[TrainerCardKeyNative]::keybd_event(0x43, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 100
[TrainerCardKeyNative]::keybd_event(0x43, 0, 0x0002, [UIntPtr]::Zero)
Write-Output "Trainer card key sent to PokeMMO pid=$($Process.Id)"
