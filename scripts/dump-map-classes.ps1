param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [string]$OutputDirectory = '',
  [ValidateSet('map','movement','collision')][string]$Kind = 'map',
  [string]$JdkHome = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot'
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { $OutputDirectory = Join-Path $ProjectRoot 'analysis\map-classes' }
$BuildRoot = Join-Path $ProjectRoot 'analysis\map-class-dump-build'
$ClassRoot = Join-Path $BuildRoot 'classes'
$AgentJar = Join-Path $BuildRoot ("map-class-dump-{0}.jar" -f (Get-Date -Format 'yyyyMMddHHmmssfff'))
New-Item -ItemType Directory -Force -Path $ClassRoot,$OutputDirectory | Out-Null
$AgentClass = if ($Kind -eq 'movement') { 'lab.partydiag.MovementClassDumpAgent' } elseif ($Kind -eq 'collision') { 'lab.partydiag.CollisionClassDumpAgent' } else { 'lab.partydiag.MapClassDumpAgent' }
$SourceName = if ($Kind -eq 'movement') { 'MovementClassDumpAgent.java' } elseif ($Kind -eq 'collision') { 'CollisionClassDumpAgent.java' } else { 'MapClassDumpAgent.java' }
& (Join-Path $JdkHome 'bin\javac.exe') -source 17 -target 17 -d $ClassRoot (Join-Path $ProjectRoot "tools\party-diagnostic-agent\src\lab\partydiag\$SourceName")
if ($LASTEXITCODE -ne 0) { throw "javac failed with exit code $LASTEXITCODE" }
$Manifest = Join-Path $BuildRoot 'manifest.mf'
@('Manifest-Version: 1.0',"Agent-Class: $AgentClass",'Can-Retransform-Classes: true','') | Set-Content -LiteralPath $Manifest -Encoding ascii
& (Join-Path $JdkHome 'bin\jar.exe') --create --file $AgentJar --manifest $Manifest -C $ClassRoot .
if ($LASTEXITCODE -ne 0) { throw "jar failed with exit code $LASTEXITCODE" }
$AttachJar = Get-ChildItem (Join-Path $ProjectRoot 'analysis\packet-agent-build') -Filter 'packet-agent-*.jar' | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
& (Join-Path $JdkHome 'bin\java.exe') --add-modules jdk.attach -cp $AttachJar lab.agent.AttachPacketAgent $ProcessId $AgentJar ([IO.Path]::GetFullPath($OutputDirectory))
if ($LASTEXITCODE -ne 0) { throw "agent attach failed with exit code $LASTEXITCODE" }
Start-Sleep -Milliseconds 700
Get-ChildItem -LiteralPath $OutputDirectory -Filter '*.class' | Select-Object -ExpandProperty FullName
