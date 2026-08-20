param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [int]$ItemId = 4,
  [string]$JdkHome = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot'
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BuildRoot = Join-Path $ProjectRoot 'analysis\catch-agent-build'
$ClassRoot = Join-Path $BuildRoot 'classes'
$Jar = Join-Path $BuildRoot ("catch-agent-{0}.jar" -f (Get-Date -Format 'yyyyMMddHHmmssfff'))
New-Item -ItemType Directory -Force -Path $ClassRoot | Out-Null
$Sources = Get-ChildItem (Join-Path $ProjectRoot 'tools\catch-agent\src') -Recurse -Filter '*.java' | Select-Object -ExpandProperty FullName
& (Join-Path $JdkHome 'bin\javac.exe') -source 17 -target 17 -d $ClassRoot $Sources
if ($LASTEXITCODE -ne 0) { throw "javac failed" }
& (Join-Path $JdkHome 'bin\jar.exe') --create --file $Jar --manifest (Join-Path $ProjectRoot 'tools\catch-agent\MANIFEST.MF') -C $ClassRoot .
if ($LASTEXITCODE -ne 0) { throw "jar failed" }
$Attach = Get-ChildItem (Join-Path $ProjectRoot 'analysis\packet-agent-build') -Filter 'packet-agent-*.jar' | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
$Log = Join-Path $ProjectRoot 'captures\catch-agent.log'
$Tag = Get-Date -Format 'yyyyMMddHHmmssfff'
& (Join-Path $JdkHome 'bin\java.exe') --add-modules jdk.attach -cp $Attach lab.agent.AttachPacketAgent $ProcessId $Jar "$Log,$ItemId,$Tag"
if ($LASTEXITCODE -ne 0) { throw "attach failed" }
Write-Output "Catch action queued itemId=$ItemId tag=$Tag"
