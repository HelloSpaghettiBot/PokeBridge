param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Up', 'Down', 'Left', 'Right', 'W', 'A', 'S', 'D', 'Z', 'X', 'C', 'Tab', 'Enter', 'Escape')]
  [string]$Key,

  [int]$DurationMs = 120,

  [int]$Repeat = 1,

  [int]$BetweenMs = 80
)

$ErrorActionPreference = 'Stop'

if ($DurationMs -lt 1 -or $Repeat -lt 1 -or $BetweenMs -lt 0) {
  throw 'DurationMs and Repeat must be positive; BetweenMs must be non-negative.'
}

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class PokeMmoKeyboardNative {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public InputUnion data;
  }

  [StructLayout(LayoutKind.Explicit, Size = 32)]
  public struct InputUnion {
    [FieldOffset(0)] public KEYBDINPUT keyboard;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort virtualKey;
    public ushort scanCode;
    public uint flags;
    public uint time;
    public UIntPtr extraInfo;
  }

  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput(uint count, INPUT[] inputs, int size);

  public static void SendScanCode(ushort scanCode, bool extended, bool keyUp) {
    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint KEYEVENTF_SCANCODE = 0x0008;

    uint flags = KEYEVENTF_SCANCODE;
    if (extended) flags |= KEYEVENTF_EXTENDEDKEY;
    if (keyUp) flags |= KEYEVENTF_KEYUP;

    INPUT input = new INPUT {
      type = INPUT_KEYBOARD,
      data = new InputUnion {
        keyboard = new KEYBDINPUT {
          virtualKey = 0,
          scanCode = scanCode,
          flags = flags,
          time = 0,
          extraInfo = UIntPtr.Zero
        }
      }
    };

    if (SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT))) != 1) {
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }
  }
}
"@

$ScanCodes = @{
  Up = 0x48; Down = 0x50; Left = 0x4B; Right = 0x4D
  W = 0x11; A = 0x1E; S = 0x1F; D = 0x20
  Z = 0x2C; X = 0x2D; C = 0x2E; Tab = 0x0F; Enter = 0x1C; Escape = 0x01
}

$ExtendedKeys = @('Up', 'Down', 'Left', 'Right')

$Process = Get-Process |
  Where-Object {
    $_.MainWindowHandle -ne 0 -and
    ($_.ProcessName -in @('PokeMMO', 'javaw') -or $_.MainWindowTitle -match '(?i)oke.*mo')
  } |
  Sort-Object @{ Expression = { if ($_.ProcessName -eq 'javaw') { 0 } else { 1 } } } |
  Select-Object -First 1

if (-not $Process) {
  throw 'PokeMMO window not found.'
}

[PokeMmoKeyboardNative]::SetForegroundWindow($Process.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 200

$ScanCode = [byte]$ScanCodes[$Key]
$IsExtended = $ExtendedKeys -contains $Key
for ($Index = 0; $Index -lt $Repeat; $Index += 1) {
  # PokeMMO consumes physical keyboard state through LWJGL. Inject scan codes so
  # the event follows the same path as a hardware key rather than relying on a
  # translated virtual-key message.
  [PokeMmoKeyboardNative]::SendScanCode($ScanCode, $IsExtended, $false)
  Start-Sleep -Milliseconds $DurationMs
  [PokeMmoKeyboardNative]::SendScanCode($ScanCode, $IsExtended, $true)
  if ($Index + 1 -lt $Repeat -and $BetweenMs -gt 0) {
    Start-Sleep -Milliseconds $BetweenMs
  }
}

Write-Output "Sent $Key to PokeMMO repeat=$Repeat durationMs=$DurationMs"
