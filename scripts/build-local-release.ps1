param(
  [string]$OutputDirectory = '',
  [string]$JdkHome = '',
  [string]$NodePath = ''
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DistRoot = Join-Path $ProjectRoot 'dist'
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $DistRoot 'PokeBridge'
}

$ProjectFull = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
$DistFull = [IO.Path]::GetFullPath($DistRoot).TrimEnd('\')
$OutputFull = [IO.Path]::GetFullPath($OutputDirectory).TrimEnd('\')
if (-not $OutputFull.StartsWith($DistFull + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw "OutputDirectory must be inside $DistFull"
}
if ($OutputFull -eq $ProjectFull -or $OutputFull.Length -le $DistFull.Length) {
  throw 'Refusing to replace a broad project directory.'
}

if ([string]::IsNullOrWhiteSpace($NodePath)) {
  $NodePath = (Get-Command node.exe -ErrorAction Stop).Source
}
if ([string]::IsNullOrWhiteSpace($JdkHome)) {
  $javac = (Get-Command javac.exe -ErrorAction Stop).Source
  $JdkHome = Split-Path -Parent (Split-Path -Parent $javac)
}
$JavaBin = Join-Path $JdkHome 'bin'
$Jlink = Join-Path $JavaBin 'jlink.exe'
$JarTool = Join-Path $JavaBin 'jar.exe'
foreach ($requiredTool in @($NodePath, (Join-Path $JavaBin 'java.exe'), (Join-Path $JavaBin 'javac.exe'), $Jlink, $JarTool, (Get-Command dotnet.exe -ErrorAction Stop).Source)) {
  if (-not (Test-Path -LiteralPath $requiredTool -PathType Leaf)) { throw "Required build tool is missing: $requiredTool" }
}

if (Test-Path -LiteralPath $OutputFull) {
  Remove-Item -LiteralPath $OutputFull -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $OutputFull | Out-Null

Write-Host '[1/8] Publishing the self-contained Windows launcher...'
& dotnet publish (Join-Path $ProjectRoot 'launcher\PokeBridge.Launcher.csproj') `
  --configuration Release `
  --runtime win-x64 `
  --self-contained true `
  --output $OutputFull `
  -p:PublishSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true `
  -p:PublishTrimmed=false `
  --nologo
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with exit code $LASTEXITCODE" }

Write-Host '[2/8] Publishing the self-contained native memory bridge...'
$NativeDirectory = Join-Path $OutputFull 'runtime\native'
New-Item -ItemType Directory -Force -Path $NativeDirectory | Out-Null
& dotnet publish (Join-Path $ProjectRoot 'tools\native-control-agent\NativeControlAgent.csproj') `
  --configuration Release `
  --runtime win-x64 `
  --self-contained true `
  --output $NativeDirectory `
  -p:PublishSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true `
  -p:PublishTrimmed=false `
  --nologo
if ($LASTEXITCODE -ne 0) { throw "native control publish failed with exit code $LASTEXITCODE" }

Write-Host '[3/8] Bundling Node.js and a minimal Java attach runtime...'
$NodeDirectory = Join-Path $OutputFull 'runtime\node'
$JavaDirectory = Join-Path $OutputFull 'runtime\java'
New-Item -ItemType Directory -Force -Path $NodeDirectory | Out-Null
Copy-Item -LiteralPath $NodePath -Destination (Join-Path $NodeDirectory 'node.exe')
& $Jlink --add-modules java.base,jdk.attach --output $JavaDirectory --strip-debug --no-man-pages --no-header-files --compress=zip-6
if ($LASTEXITCODE -ne 0) { throw "jlink failed with exit code $LASTEXITCODE" }

Write-Host '[4/8] Compiling persistent control agents...'
$AgentDirectory = Join-Path $OutputFull 'runtime\agents'
New-Item -ItemType Directory -Force -Path $AgentDirectory | Out-Null
$PinnedPacket = Join-Path $ProjectRoot 'analysis\packet-agent-build\packet-agent-20260721115716851.jar'
$ExpectedPacketHash = 'CAE6BA163AC044A6250C0DC3F36E6E23767F270DF067BAE6B5B723AC462B37DD'
if ((Get-FileHash -LiteralPath $PinnedPacket -Algorithm SHA256).Hash -ne $ExpectedPacketHash) {
  throw 'The pinned packet bridge JAR failed its integrity check.'
}
Copy-Item -LiteralPath $PinnedPacket -Destination (Join-Path $AgentDirectory 'packet-agent.jar')

$AgentBuilds = [ordered]@{
  'control-agent.jar' = 'build-control-agent.ps1'
  'dex-agent.jar' = 'build-dex-agent.ps1'
  'battle-control-agent.jar' = 'build-battle-control-agent.ps1'
  'hunt-control-agent.jar' = 'build-hunt-control-agent.ps1'
  'species-agent.jar' = 'build-species-agent.ps1'
}
foreach ($entry in $AgentBuilds.GetEnumerator()) {
  $built = & (Join-Path $PSScriptRoot $entry.Value) -JdkHome $JdkHome | Select-Object -Last 1
  if (-not (Test-Path -LiteralPath $built -PathType Leaf)) { throw "Agent build did not produce a JAR: $($entry.Value)" }
  Copy-Item -LiteralPath $built -Destination (Join-Path $AgentDirectory $entry.Key)
}

Write-Host '[5/8] Copying the automation engine and seed data...'
$AppDirectory = Join-Path $OutputFull 'app'
$AppScripts = Join-Path $AppDirectory 'scripts'
$AppCaptures = Join-Path $AppDirectory 'captures'
New-Item -ItemType Directory -Force -Path $AppScripts,$AppCaptures | Out-Null
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'package.json') -Destination $AppDirectory
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'src') -Destination $AppDirectory -Recurse
foreach ($script in @('run-world-explorer.js')) {
  Copy-Item -LiteralPath (Join-Path $ProjectRoot "scripts\$script") -Destination $AppScripts
}
$LearnedDataDirectory = Join-Path $env:LOCALAPPDATA 'PokeBridge\data'
foreach ($seed in @('world-graph.json','encounter-dex.json','pokemon-centers.json','client-species-index.json')) {
  $LearnedSeed = Join-Path $LearnedDataDirectory $seed
  $RepositorySeed = Join-Path $ProjectRoot "captures\$seed"
  $SeedSource = if (Test-Path -LiteralPath $LearnedSeed -PathType Leaf) { $LearnedSeed } else { $RepositorySeed }
  Copy-Item -LiteralPath $SeedSource -Destination $AppCaptures
}
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'README_LOCAL.txt') -Destination (Join-Path $OutputFull 'README.txt')

Write-Host '[6/8] Validating packaged scripts, modules, and JARs...'
& (Join-Path $NodeDirectory 'node.exe') --check (Join-Path $AppScripts 'run-world-explorer.js')
if ($LASTEXITCODE -ne 0) { throw 'The packaged automation engine failed JavaScript validation.' }
$moduleList = & (Join-Path $JavaDirectory 'bin\java.exe') --list-modules
if ($LASTEXITCODE -ne 0 -or -not ($moduleList -match '^jdk\.attach@')) { throw 'The packaged Java runtime is missing jdk.attach.' }
Get-ChildItem -LiteralPath $AgentDirectory -Filter '*.jar' | ForEach-Object {
  & $JarTool tf $_.FullName *> $null
  if ($LASTEXITCODE -ne 0) { throw "Invalid packaged JAR: $($_.Name)" }
}
if (-not (Test-Path -LiteralPath (Join-Path $NativeDirectory 'NativeControlAgent.exe') -PathType Leaf)) {
  throw 'The native memory bridge executable is missing from the package.'
}

Write-Host '[7/8] Running the executable package self-test...'
$selfTest = Start-Process -FilePath (Join-Path $OutputFull 'PokeBridge.exe') -ArgumentList '--self-test' -Wait -PassThru
if ($selfTest.ExitCode -ne 0) { throw "PokeBridge self-test failed with exit code $($selfTest.ExitCode)" }

Write-Host '[8/8] Creating the portable ZIP...'
New-Item -ItemType Directory -Force -Path $DistRoot | Out-Null
$ZipPath = Join-Path $DistRoot 'PokeBridge-win-x64.zip'
if (Test-Path -LiteralPath $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
Compress-Archive -LiteralPath $OutputFull -DestinationPath $ZipPath -CompressionLevel Optimal

$exe = Get-Item -LiteralPath (Join-Path $OutputFull 'PokeBridge.exe')
$zip = Get-Item -LiteralPath $ZipPath
Write-Host ''
Write-Host "Release ready: $OutputFull" -ForegroundColor Green
Write-Host "Launcher: $($exe.FullName) ($([Math]::Round($exe.Length / 1MB, 1)) MB)"
Write-Host "Portable ZIP: $($zip.FullName) ($([Math]::Round($zip.Length / 1MB, 1)) MB)"
