param(
  [Parameter(Mandatory = $true)]
  [int]$ProcessId,
  [string]$OutputPath,
  [string]$JdkHome = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$AgentJar = Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'analysis\packet-agent-build') `
  -Filter 'packet-agent-*.jar' `
  -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
if (-not $AgentJar) {
  $AgentJar = & (Join-Path $PSScriptRoot 'build-packet-agent.ps1') -JdkHome $JdkHome | Select-Object -Last 1
}
if (-not $OutputPath) {
  $OutputPath = Join-Path $ProjectRoot ("captures\decrypted-packets-{0}.jsonl" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)

& (Join-Path $JdkHome 'bin\java.exe') `
  --add-modules jdk.attach `
  -cp $AgentJar `
  lab.agent.AttachPacketAgent `
  $ProcessId `
  $AgentJar `
  $OutputPath
if ($LASTEXITCODE -ne 0) { throw "agent attach failed with exit code $LASTEXITCODE" }

Write-Output $OutputPath
