param(
  [int]$ClientProcessId = 0,
  [switch]$AutoStart,
  [switch]$AutoExplore
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$GuiScript = Join-Path $PSScriptRoot 'bridge-bot-gui.ps1'

function Write-Step([string]$Message) {
  Write-Host "[TCP Bridge] $Message" -ForegroundColor Cyan
}

function Fail([string]$Message) {
  Write-Host ''
  Write-Host "ERROR: $Message" -ForegroundColor Red
  Write-Host ''
  throw $Message
}

function Refresh-ProcessPath {
  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = @($machinePath, $userPath) -join ';'
}

function Get-NodeRuntime {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $command) { return $null }

  try {
    $versionText = (& $command.Source --version 2>$null | Select-Object -First 1)
    if ($versionText -notmatch '^v(?<major>\d+)') { return $null }
    return [pscustomobject]@{
      Path = $command.Source
      Major = [int]$Matches.major
      Version = $versionText
    }
  } catch {
    return $null
  }
}

function Test-JdkHome([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
  $java = Join-Path $Path 'bin\java.exe'
  $javac = Join-Path $Path 'bin\javac.exe'
  $jar = Join-Path $Path 'bin\jar.exe'
  if (-not ((Test-Path -LiteralPath $java) -and (Test-Path -LiteralPath $javac) -and (Test-Path -LiteralPath $jar))) {
    return $false
  }

  try {
    $versionText = (& $javac -version 2>&1 | Select-Object -First 1).ToString()
    if ($versionText -match 'javac\s+(?<major>\d+)') {
      return ([int]$Matches.major -ge 17)
    }
  } catch {}
  return $false
}

function Get-JdkHome {
  $candidates = New-Object System.Collections.Generic.List[string]

  foreach ($candidate in @($env:TCP_BRIDGE_JDK_HOME, $env:JAVA_HOME)) {
    if (-not [string]::IsNullOrWhiteSpace($candidate)) { $candidates.Add($candidate) }
  }

  $javacCommand = Get-Command javac.exe -ErrorAction SilentlyContinue
  if ($javacCommand) {
    $binDir = Split-Path -Parent $javacCommand.Source
    $candidates.Add((Split-Path -Parent $binDir))
  }

  $roots = @(
    (Join-Path $env:ProgramFiles 'Eclipse Adoptium'),
    (Join-Path $env:ProgramFiles 'Java'),
    (Join-Path $env:ProgramFiles 'Microsoft'),
    (Join-Path $env:ProgramFiles 'Zulu')
  )

  if (${env:ProgramFiles(x86)}) {
    $roots += @(
      (Join-Path ${env:ProgramFiles(x86)} 'Eclipse Adoptium'),
      (Join-Path ${env:ProgramFiles(x86)} 'Java')
    )
  }

  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    foreach ($directory in @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending)) {
      $candidates.Add($directory.FullName)
    }
  }

  foreach ($candidate in @($candidates | Select-Object -Unique)) {
    if (Test-JdkHome $candidate) { return $candidate }
  }
  return $null
}

function Get-PokeMmoProcess {
  $matches = @()
  try {
    foreach ($process in @(Get-CimInstance Win32_Process -ErrorAction Stop)) {
      $name = [string]$process.Name
      $commandLine = [string]$process.CommandLine
      $path = [string]$process.ExecutablePath
      $score = 0

      if ($name -ieq 'PokeMMO.exe') { $score += 100 }
      if ($name -match '^javaw?\.exe$' -and $commandLine -match '(?i)PokeMMO|com\.pokeemu\.client\.Client') { $score += 80 }
      if ($path -match '(?i)PokeMMO') { $score += 40 }
      if ($commandLine -match '(?i)PokeMMO') { $score += 20 }

      if ($score -gt 0) {
        $matches += [pscustomobject]@{
          ProcessId = [int]$process.ProcessId
          Name = $name
          CreationDate = $process.CreationDate
          Score = $score
        }
      }
    }
  } catch {
    foreach ($process in @(Get-Process -Name 'PokeMMO' -ErrorAction SilentlyContinue)) {
      $matches += [pscustomobject]@{
        ProcessId = [int]$process.Id
        Name = $process.ProcessName
        CreationDate = $process.StartTime
        Score = 100
      }
    }
  }

  return $matches | Sort-Object @{ Expression = 'Score'; Descending = $true }, @{ Expression = 'CreationDate'; Descending = $true } | Select-Object -First 1
}

function Find-PokeMmoExecutable {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'PokeMMO\PokeMMO.exe'),
    (Join-Path $env:LOCALAPPDATA 'PokeMMO\PokeMMO.exe')
  )
  if (${env:ProgramFiles(x86)}) {
    $candidates += (Join-Path ${env:ProgramFiles(x86)} 'PokeMMO\PokeMMO.exe')
  }

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  return $null
}

function Wait-ForPokeMmo([int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    $process = Get-PokeMmoProcess
    if ($process) { return $process }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $null
}

try {
  Set-Location -LiteralPath $ProjectRoot
  Refresh-ProcessPath

  Write-Step 'Checking Node.js...'
  $node = Get-NodeRuntime
  if (-not $node) {
    Fail 'Node.js 22 or newer is required. Install the current Node.js LTS release, then run START_BOT.bat again.'
  }
  if ($node.Major -lt 22) {
    Fail "Node.js 22 or newer is required. Found $($node.Version) at $($node.Path)."
  }
  $nodeDirectory = Split-Path -Parent $node.Path
  if (($env:Path -split ';') -notcontains $nodeDirectory) { $env:Path = "$nodeDirectory;$env:Path" }
  Write-Step "Using Node.js $($node.Version)."

  Write-Step 'Finding a compatible JDK...'
  $jdkHome = Get-JdkHome
  if (-not $jdkHome) {
    Fail 'A full JDK 17 or newer is required (not only a Java runtime). Install Temurin/OpenJDK 21, then run START_BOT.bat again.'
  }
  $env:TCP_BRIDGE_JDK_HOME = $jdkHome
  $env:JAVA_HOME = $jdkHome
  $jdkBin = Join-Path $jdkHome 'bin'
  if (($env:Path -split ';') -notcontains $jdkBin) { $env:Path = "$jdkBin;$env:Path" }
  Write-Step "Using JDK: $jdkHome"

  $client = $null
  if ($ClientProcessId -gt 0) {
    $running = Get-Process -Id $ClientProcessId -ErrorAction SilentlyContinue
    if ($running) {
      $client = [pscustomobject]@{ ProcessId = $ClientProcessId; Name = $running.ProcessName }
    }
  }

  if (-not $client) {
    Write-Step 'Looking for PokeMMO...'
    $client = Get-PokeMmoProcess
  }

  if (-not $client) {
    $clientPath = Find-PokeMmoExecutable
    if (-not $clientPath) {
      Fail 'PokeMMO is not running and PokeMMO.exe was not found in a standard installation folder. Start PokeMMO manually, then run START_BOT.bat again.'
    }
    Write-Step 'Starting PokeMMO...'
    Start-Process -FilePath $clientPath | Out-Null
    $client = Wait-ForPokeMmo -Seconds 30
    if (-not $client) {
      Fail 'PokeMMO started, but its process could not be detected. Leave the game open and run START_BOT.bat again.'
    }
  }

  Write-Step "Using PokeMMO process $($client.ProcessId)."
  Write-Step 'Opening the bot control panel...'

  $argumentLine = '-NoProfile -STA -ExecutionPolicy Bypass -File "{0}" -ClientProcessId {1} -JdkHome "{2}"' -f `
    $GuiScript.Replace('"', '\"'), [int]$client.ProcessId, $jdkHome.Replace('"', '\"')
  if ($AutoStart) { $argumentLine += ' -AutoStart' }
  if ($AutoExplore) { $argumentLine += ' -AutoExplore' }

  Start-Process -FilePath 'powershell.exe' -ArgumentList $argumentLine -WorkingDirectory $ProjectRoot -WindowStyle Normal | Out-Null
  Write-Step 'Launcher complete.'
  exit 0
} catch {
  if ($_.Exception.Message -notlike 'Node.js*' -and $_.Exception.Message -notlike 'A full JDK*' -and $_.Exception.Message -notlike 'PokeMMO*') {
    Write-Host ''
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ''
  }
  exit 1
}
