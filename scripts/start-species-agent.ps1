param([Parameter(Mandatory = $true)][int]$ProcessId,[int]$Port = 37670,[string]$JdkHome = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot')
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$AgentJar = & (Join-Path $ProjectRoot 'scripts\build-species-agent.ps1') -JdkHome $JdkHome
$AttachJar = Get-ChildItem (Join-Path $ProjectRoot 'analysis\packet-agent-build') -Filter 'packet-agent-*.jar' | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
$Log = Join-Path $ProjectRoot 'captures\species-agent.log'
$Tag = Get-Date -Format 'yyyyMMddHHmmssfff'
& (Join-Path $JdkHome 'bin\java.exe') --add-modules jdk.attach -cp $AttachJar lab.agent.AttachPacketAgent $ProcessId $AgentJar "$Log,$Port,$Tag"
if ($LASTEXITCODE -ne 0) { throw "agent attach failed with exit code $LASTEXITCODE" }
Write-Output "Species resolver attached pid=$ProcessId port=$Port"
