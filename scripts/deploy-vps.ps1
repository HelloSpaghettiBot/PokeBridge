param(
  [string]$HostAlias = 'cerabot-vps',
  [string]$RemoteDir = '/opt/tcp-bridge-lab',
  [string]$ConfigPath = 'bridge.server.config.json',
  [switch]$InstallService,
  [switch]$StartService
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$ResolvedConfig = Join-Path $ProjectRoot $ConfigPath
if (-not (Test-Path -LiteralPath $ResolvedConfig)) {
  throw "Config not found: $ResolvedConfig"
}

$ArchivePath = Join-Path $env:TEMP "tcp-bridge-lab-$([guid]::NewGuid()).tar.gz"
$Include = @(
  'package.json',
  'README.md',
  'src',
  'scripts',
  'test',
  $ConfigPath
)

Push-Location $ProjectRoot
try {
  tar -czf $ArchivePath @Include
} finally {
  Pop-Location
}

try {
  ssh $HostAlias "mkdir -p '$RemoteDir'"
  scp $ArchivePath "${HostAlias}:/tmp/tcp-bridge-lab.tar.gz"
  ssh $HostAlias "tar -xzf /tmp/tcp-bridge-lab.tar.gz -C '$RemoteDir' && cp '$RemoteDir/$ConfigPath' '$RemoteDir/bridge.config.json' && rm -f /tmp/tcp-bridge-lab.tar.gz"

  if ($InstallService) {
    $Service = @"
[Unit]
Description=TCP Bridge Lab
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$RemoteDir
ExecStart=/usr/bin/node $RemoteDir/src/cli.js --config $RemoteDir/bridge.config.json
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
"@
    $Encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Service))
    ssh $HostAlias "echo '$Encoded' | base64 -d > /etc/systemd/system/tcp-bridge-lab.service && systemctl daemon-reload && systemctl enable tcp-bridge-lab.service"
  }

  if ($StartService) {
    if (-not $InstallService) {
      throw '-StartService requires -InstallService'
    }
    ssh $HostAlias "systemctl restart tcp-bridge-lab.service && systemctl --no-pager --full status tcp-bridge-lab.service"
  }

  Write-Output "Deployed bridge files to ${HostAlias}:$RemoteDir"
} finally {
  Remove-Item -LiteralPath $ArchivePath -Force -ErrorAction SilentlyContinue
}
