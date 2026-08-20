param(
  [string]$JdkHome = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$SourceRoot = Join-Path $ProjectRoot 'tools\movement-agent\src'
$BuildRoot = Join-Path $ProjectRoot 'analysis\movement-agent-build'
$ClassRoot = Join-Path $BuildRoot 'classes'
$AgentJar = Join-Path $BuildRoot ("movement-agent-{0}.jar" -f (Get-Date -Format 'yyyyMMddHHmmssfff'))
$Sources = Get-ChildItem -LiteralPath $SourceRoot -Recurse -Filter '*.java' | Select-Object -ExpandProperty FullName

New-Item -ItemType Directory -Force -Path $ClassRoot | Out-Null
& (Join-Path $JdkHome 'bin\javac.exe') -source 17 -target 17 -d $ClassRoot $Sources
if ($LASTEXITCODE -ne 0) { throw "javac failed with exit code $LASTEXITCODE" }

& (Join-Path $JdkHome 'bin\jar.exe') --create --file $AgentJar `
  --manifest (Join-Path $ProjectRoot 'tools\movement-agent\MANIFEST.MF') -C $ClassRoot .
if ($LASTEXITCODE -ne 0) { throw "jar failed with exit code $LASTEXITCODE" }

Write-Output $AgentJar
