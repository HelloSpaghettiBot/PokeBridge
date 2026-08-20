param(
  [Parameter(Mandatory = $true)]
  [int]$ProcessId,
  [Parameter(Mandatory = $true)]
  [ValidateSet('Up', 'Down', 'Left', 'Right')]
  [string]$Direction,
  [int]$Repeat = 1,
  [int]$BetweenMs = 300,
  [string]$JdkHome = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Directions = @{ Down = 0; Up = 1; Left = 2; Right = 3 }
$AgentJar = & (Join-Path $PSScriptRoot 'build-movement-agent.ps1') -JdkHome $JdkHome | Select-Object -Last 1
$LogPath = Join-Path $ProjectRoot 'captures\movement-agent.log'
$Tag = Get-Date -Format 'yyyyMMddHHmmssfff'
$Options = '{0},{1},{2},{3},{4}' -f $LogPath, $Directions[$Direction], $Repeat, $BetweenMs, $Tag
$AttachJar = Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'analysis\packet-agent-build') `
  -Filter 'packet-agent-*.jar' | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName

& (Join-Path $JdkHome 'bin\java.exe') --add-modules jdk.attach -cp $AttachJar `
  lab.agent.AttachPacketAgent $ProcessId $AgentJar $Options
if ($LASTEXITCODE -ne 0) { throw "agent attach failed with exit code $LASTEXITCODE" }

Write-Output "Queued movement packet direction=$Direction repeat=$Repeat tag=$Tag"
