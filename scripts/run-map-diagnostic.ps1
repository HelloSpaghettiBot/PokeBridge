param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [string]$OutputPath = '',
  [ValidateSet('grid','objects')][string]$Kind = 'grid',
  [string]$JdkHome = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot'
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $DefaultOutput = if ($Kind -eq 'objects') { 'analysis\map-object-diagnostic.log' } else { 'analysis\map-live-diagnostic.log' }
  $OutputPath = Join-Path $ProjectRoot $DefaultOutput
}
$BuildRoot = Join-Path $ProjectRoot 'analysis\map-diagnostic-build'
$ClassRoot = Join-Path $BuildRoot 'classes'
$AgentJar = Join-Path $BuildRoot ("map-diagnostic-{0}.jar" -f (Get-Date -Format 'yyyyMMddHHmmssfff'))
New-Item -ItemType Directory -Force -Path $ClassRoot | Out-Null
$AgentClass = if ($Kind -eq 'objects') { 'lab.partydiag.MapObjectDiagnosticAgent' } else { 'lab.partydiag.MapDiagnosticAgent' }
$SourceName = if ($Kind -eq 'objects') { 'MapObjectDiagnosticAgent.java' } else { 'MapDiagnosticAgent.java' }
& (Join-Path $JdkHome 'bin\javac.exe') -source 17 -target 17 -d $ClassRoot (Join-Path $ProjectRoot "tools\party-diagnostic-agent\src\lab\partydiag\$SourceName")
if ($LASTEXITCODE -ne 0) { throw "javac failed with exit code $LASTEXITCODE" }
$Manifest = Join-Path $BuildRoot 'manifest.mf'
@('Manifest-Version: 1.0',"Agent-Class: $AgentClass",'Can-Redefine-Classes: false','Can-Retransform-Classes: false','') | Set-Content -LiteralPath $Manifest -Encoding ascii
& (Join-Path $JdkHome 'bin\jar.exe') --create --file $AgentJar --manifest $Manifest -C $ClassRoot .
if ($LASTEXITCODE -ne 0) { throw "jar failed with exit code $LASTEXITCODE" }
$AttachJar = Get-ChildItem (Join-Path $ProjectRoot 'analysis\packet-agent-build') -Filter 'packet-agent-*.jar' | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
& (Join-Path $JdkHome 'bin\java.exe') --add-modules jdk.attach -cp $AttachJar lab.agent.AttachPacketAgent $ProcessId $AgentJar ([IO.Path]::GetFullPath($OutputPath))
if ($LASTEXITCODE -ne 0) { throw "agent attach failed with exit code $LASTEXITCODE" }
Start-Sleep -Milliseconds 700
Write-Output ([IO.Path]::GetFullPath($OutputPath))
