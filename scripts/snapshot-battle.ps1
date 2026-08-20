param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [string]$JdkHome = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot'
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BuildRoot = Join-Path $ProjectRoot 'analysis\snapshot-agent-build'
$ClassRoot = Join-Path $BuildRoot 'classes'
$AgentJar = Join-Path $BuildRoot ("snapshot-agent-{0}.jar" -f (Get-Date -Format 'yyyyMMddHHmmssfff'))
$SourceRoot = Join-Path $ProjectRoot 'tools\snapshot-agent\src'
New-Item -ItemType Directory -Force -Path $ClassRoot | Out-Null
$Sources = Get-ChildItem $SourceRoot -Recurse -Filter '*.java' | Select-Object -ExpandProperty FullName
& (Join-Path $JdkHome 'bin\javac.exe') -source 17 -target 17 -d $ClassRoot $Sources
if ($LASTEXITCODE -ne 0) { throw "javac failed with exit code $LASTEXITCODE" }
& (Join-Path $JdkHome 'bin\jar.exe') --create --file $AgentJar --manifest (Join-Path $ProjectRoot 'tools\snapshot-agent\MANIFEST.MF') -C $ClassRoot .
if ($LASTEXITCODE -ne 0) { throw "jar failed with exit code $LASTEXITCODE" }
$AttachJar = Get-ChildItem (Join-Path $ProjectRoot 'analysis\packet-agent-build') -Filter 'packet-agent-*.jar' | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
$Log = Join-Path $ProjectRoot 'captures\battle-snapshot.log'
$Tag = Get-Date -Format 'yyyyMMddHHmmssfff'
& (Join-Path $JdkHome 'bin\java.exe') --add-modules jdk.attach -cp $AttachJar lab.agent.AttachPacketAgent $ProcessId $AgentJar "$Log,$Tag"
if ($LASTEXITCODE -ne 0) { throw "agent attach failed with exit code $LASTEXITCODE" }
Write-Output "Battle snapshot queued tag=$Tag"
