param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$MoveId,
  [string]$JdkHome = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot'
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$AgentJar = & (Join-Path $PSScriptRoot 'build-battle-agent.ps1') -JdkHome $JdkHome | Select-Object -Last 1
$AttachJar = Get-ChildItem (Join-Path $ProjectRoot 'analysis\packet-agent-build') -Filter 'packet-agent-*.jar' | `
  Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
$LogPath = Join-Path $ProjectRoot 'captures\battle-agent.log'
$Tag = Get-Date -Format 'yyyyMMddHHmmssfff'
$Options = '{0},{1},{2}' -f $LogPath, $MoveId, $Tag
& (Join-Path $JdkHome 'bin\java.exe') --add-modules jdk.attach -cp $AttachJar `
  lab.agent.AttachPacketAgent $ProcessId $AgentJar $Options
if ($LASTEXITCODE -ne 0) { throw "agent attach failed with exit code $LASTEXITCODE" }
Write-Output "Queued battle move packet moveId=$MoveId tag=$Tag"
