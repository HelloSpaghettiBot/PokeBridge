param(
  [Parameter(Mandatory = $true)]
  [int]$ProcessId,
  [ValidateSet('Up', 'Down', 'Left', 'Right', 'A', 'B', 'X', 'Y')]
  [string]$Key,
  [int]$DurationMs = 180,
  [int]$Repeat = 1,
  [int]$BetweenMs = 120,
  [string]$JdkHome = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$KeyCodes = @{ Up = 19; Down = 20; Left = 21; Right = 22; A = 54; B = 52; X = 47; Y = 29 }
$AgentJar = & (Join-Path $PSScriptRoot 'build-input-agent.ps1') -JdkHome $JdkHome | Select-Object -Last 1
$LogPath = Join-Path $ProjectRoot 'captures\input-agent.log'
$Options = '{0},{1},{2},{3},{4}' -f $LogPath, $KeyCodes[$Key], $DurationMs, $Repeat, $BetweenMs
$AttachJar = Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'analysis\packet-agent-build') `
  -Filter 'packet-agent-*.jar' | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName

& (Join-Path $JdkHome 'bin\java.exe') --add-modules jdk.attach -cp $AttachJar `
  lab.agent.AttachPacketAgent $ProcessId $AgentJar $Options
if ($LASTEXITCODE -ne 0) { throw "agent attach failed with exit code $LASTEXITCODE" }

Write-Output "Sent client key $Key repeat=$Repeat durationMs=$DurationMs"
