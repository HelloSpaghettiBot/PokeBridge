param(
  [string]$HostAlias='cerabot-vps',
  [string]$RemoteDir='/opt/pokemmo-headless',
  [string]$Domain='luls.lol',
  [switch]$InstallService,
  [switch]$InstallNginx,
  [switch]$StartService
)
$ErrorActionPreference='Stop'
$ProjectRoot=Split-Path -Parent $PSScriptRoot
$Archive=Join-Path $env:TEMP "pokemmo-headless-$([guid]::NewGuid()).tar.gz"
Push-Location $ProjectRoot
try { tar -czf $Archive package.json README.md src scripts captures/world-graph.json captures/encounter-dex.json captures/pokemon-centers.json captures/client-species-index.json captures/explorer-status.json } finally { Pop-Location }
try {
  ssh $HostAlias "mkdir -p '$RemoteDir/captures'"
  scp $Archive "${HostAlias}:/tmp/pokemmo-headless.tar.gz"
  # Runtime mapping data belongs to the VPS once it starts learning. Preserve
  # it across code deployments while still seeding captures on a first install.
  ssh $HostAlias "state_backup=`$(mktemp -d /tmp/pokemmo-headless-state.XXXXXX); cp -a '$RemoteDir/captures/.' `"`$state_backup/`" 2>/dev/null || true; tar -xzf /tmp/pokemmo-headless.tar.gz -C '$RemoteDir'; cp -a `"`$state_backup/.`" '$RemoteDir/captures/' 2>/dev/null || true; rm -f /tmp/pokemmo-headless.tar.gz; case `"`$state_backup`" in /tmp/pokemmo-headless-state.*) rm -rf -- `"`$state_backup`";; *) echo 'Refusing unsafe state cleanup' >&2; exit 3;; esac"
  if($InstallService){
    $Unit=@"
[Unit]
Description=PokeMMO Headless Dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$RemoteDir
EnvironmentFile=/etc/pokemmo-headless.env
ExecStart=/usr/bin/node $RemoteDir/scripts/run-headless-dashboard.js
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
"@
    $EnvTemplate=@"
POKEMMO_DASHBOARD_HOST=127.0.0.1
POKEMMO_DASHBOARD_PORT=8787
POKEMMO_DASHBOARD_BASE_PATH=/pokemmo
POKEMMO_DASHBOARD_TOKEN=REPLACE_WITH_A_LONG_RANDOM_SECRET
POKEMMO_VIEW_PASSWORD=Loldeedle
POKEMMO_LOGIN_HOST=207.246.96.200
POKEMMO_LOGIN_PORT=2106
POKEMMO_CHARACTER_NAME=Deltron
POKEMMO_CHARACTER_ID=1902562831166377984
POKEMMO_CHARACTER_PROOF=16022381992908638383
POKEMMO_DATA_ROOT=$RemoteDir
"@
    $Unit64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Unit));$Env64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($EnvTemplate))
    ssh $HostAlias "echo '$Unit64'|base64 -d >/etc/systemd/system/pokemmo-headless.service; test -f /etc/pokemmo-headless.env || (echo '$Env64'|base64 -d >/etc/pokemmo-headless.env && chmod 600 /etc/pokemmo-headless.env); systemctl daemon-reload; systemctl enable pokemmo-headless.service"
  }
  if($InstallNginx){
    $Nginx=@"
location = /pokemmo { return 301 /pokemmo/; }
location /pokemmo/ {
    proxy_pass http://127.0.0.1:8787;
    access_log off;
    proxy_http_version 1.1;
    proxy_set_header Host `$host;
    proxy_set_header X-Forwarded-Proto `$scheme;
    proxy_set_header X-Forwarded-For `$proxy_add_x_forwarded_for;
}
"@
    $Nginx64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Nginx))
    ssh $HostAlias "echo '$Nginx64'|base64 -d >/etc/nginx/snippets/pokemmo-headless.conf; nginx -t"
    Write-Warning "Include /etc/nginx/snippets/pokemmo-headless.conf inside ${Domain}'s existing server block, then reload nginx. The script does not overwrite the site's server block."
  }
  if($StartService){if(-not$InstallService){throw '-StartService requires -InstallService'};ssh $HostAlias "grep -q REPLACE_WITH /etc/pokemmo-headless.env && { echo 'Set POKEMMO_DASHBOARD_TOKEN first' >&2; exit 2; }; systemctl restart pokemmo-headless.service; systemctl --no-pager --full status pokemmo-headless.service"}
  "Deployed headless dashboard to ${HostAlias}:$RemoteDir"
} finally { Remove-Item -LiteralPath $Archive -Force -ErrorAction SilentlyContinue }
