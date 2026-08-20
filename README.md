# TCP Bridge Lab

A protocol-agnostic, binary-safe TCP bridge for interoperability work on systems
you own or are authorized to test. It forwards bytes unchanged and can append
observed TCP chunks to a JSONL capture file.

This is transport tooling, not a packet parser: TCP chunk boundaries are not
application-message boundaries. A protocol-specific framing layer belongs after
the message format is documented or tested against an authorized local service.

## Run

Node.js 22 or newer is required. No dependencies need to be installed.

```powershell
node src/cli.js `
  --listen-host 127.0.0.1 `
  --listen-port 9000 `
  --upstream-host 127.0.0.1 `
  --upstream-port 9001 `
  --capture captures/session.jsonl
```

You can also start from a checked config:

```powershell
node src/cli.js --config bridge.config.example.json
```

Point an authorized test client at `127.0.0.1:9000`. Stop the bridge with
Ctrl+C.

Account credentials are not part of this bridge. Log in manually through the
official client if the test requires it; do not place passwords, MFA codes, or
session tokens in config files, captures, or chat.

## Runtime Controls

- `captureMaxBytes` rotates JSONL capture files as `capture.000000.jsonl`,
  `capture.000001.jsonl`, and so on.
- `connectTimeoutMs` bounds upstream connection attempts.
- `idleTimeoutMs` closes established connections after inactivity.
- `maxConnections` caps active client sessions.
- `createBridge(...).getStats()` returns connection and byte counters.

## Client Analysis

The installed Windows client at `C:\Program Files\PokeMMO\PokeMMO.exe` is a
Launch4j Java bundle with `com.pokeemu.client.Client` as the manifest entry
point. Use the JDK tooling for bundled Java classes. Use Ghidra for the native
launcher or bundled native libraries when `analyzeHeadless` is installed.

```powershell
node scripts/analyze-client.js `
  --client "C:\Program Files\PokeMMO\PokeMMO.exe" `
  --out analysis
```

If Ghidra is installed and `analyzeHeadless` is on `PATH`, add
`--run-ghidra true` to create a Ghidra project under the output directory.

To scan bundled Java classes for endpoint-related constants:

```powershell
node scripts/scan-java-constants.js --out analysis/java-constants.json
```

## Endpoint Discovery

When the official client is used interactively, run this watcher first. It logs
new outbound TCP endpoints for the client process.

```powershell
node scripts/watch-client-connections.js `
  --out captures/client-connections.jsonl `
  --config-out bridge.config.json
```

Then launch the client and click Connect manually. Once an established remote
connection is seen, the watcher writes `bridge.config.json`. By default, the
generated bridge listens on the same port as the captured remote endpoint.
Override `--listen-port` only when the client can be pointed at a different
local port.

To start the watcher and open the official client in one step:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-client-capture.ps1
```

After a connection appears in the watcher capture, you can regenerate the bridge
config manually:

```powershell
node scripts/generate-bridge-config.js `
  --input captures/client-connections.jsonl `
  --output bridge.config.json
```

Then run the bridge:

```powershell
node src/cli.js --config bridge.config.json
```

Or run it in the background with logs:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-bridge.ps1
```

Logs are written to `logs\bridge.out.log` and `logs\bridge.err.log`.

## Client Insertion

The login endpoint is resolved through `loginserver.pokemmo.com`. To make the
official client hit the local bridge for login, enable the managed hosts-file
redirect, then restart or reconnect the client:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\enable-client-redirect.ps1
```

To remove the redirect:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\disable-client-redirect.ps1
```

Audit whether the client is actually traversing the bridge:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\audit-insertion.ps1
```

The audit reports fixed bridge routes, hosts redirection, Java SOCKS settings,
SOCKS listener state, and recent SOCKS targets.

To wait for the next game TCP connect through SOCKS:

```powershell
node scripts/monitor-insertion.js --start-now --timeout-ms 120000
```

Or run the monitor in the background:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-insertion-monitor.ps1
```

To summarize capture evidence without payload dumps:

```powershell
node scripts/summarize-captures.js
```

## Java SOCKS Insertion

Because the official Windows client is a Launch4j Java bundle, it can use Java's
built-in SOCKS proxy properties. This avoids hosts-file elevation.

Start the local SOCKS bridge:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-socks-bridge.ps1
```

The default SOCKS bridge allows ports `80`, `443`, `2106`, `7777`, and `7780`
so normal launcher HTTPS calls and game TCP endpoints can pass through it.

Enable Java SOCKS properties in `C:\Program Files\PokeMMO\PokeMMO.l4j.ini`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\enable-java-socks.ps1
```

Restart the official client after enabling. To remove the JVM proxy settings:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\disable-java-socks.ps1
```

## VPS Deployment

Generate a server-facing config that binds public interfaces:

```powershell
node scripts/generate-bridge-config.js `
  --input captures/client-connections.jsonl `
  --output bridge.server.config.json `
  --listen-host 0.0.0.0
```

Deploy files to the configured SSH host:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy-vps.ps1
```

Install and start the systemd service only when the bridge host should accept
client traffic on the configured ports:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy-vps.ps1 -InstallService -StartService
```

## Test

```powershell
node --test
```

## Headless dashboard

Run the VPS-ready dashboard at `/pokemmo`:

```bash
export POKEMMO_DASHBOARD_HOST=127.0.0.1
export POKEMMO_DASHBOARD_PORT=8787
export POKEMMO_DASHBOARD_BASE_PATH=/pokemmo
export POKEMMO_DASHBOARD_TOKEN='a-long-random-secret'
node scripts/run-headless-dashboard.js
```

Run `scripts\open-vps-dashboard.ps1` to retrieve the access token over SSH and open `https://tech.luls.lol/pokemmo/` without printing the token. The page includes in-memory credential and MFA forms, activity controls, the explored tile map, nearby players/trainers/NPCs, live battle details, money, species-index progress, and discovered Pokemon Centers. Passwords and MFA codes are overwritten after submission and are never written to config, captures, or logs.

The hosted service connects directly from the VPS to the official login service, negotiates the encrypted login and game sessions, accepts MFA through the dashboard, and enters the configured character. It has no HTTP telemetry-ingest route and does not accept state from the Windows bot.

Deployment files can be copied and a systemd unit installed with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy-headless-vps.ps1 -InstallService -InstallNginx
```

Edit `/etc/pokemmo-headless.env`, replace the dashboard token placeholder, include `/etc/nginx/snippets/pokemmo-headless.conf` inside the intended TLS server block, and then start with `-InstallService -StartService`. The deployment script deliberately does not overwrite an existing nginx site. The live deployment includes the snippet only in the dedicated `tech.luls.lol` block.

The integration test creates only local ephemeral sockets and verifies exact
binary forwarding in both directions.

## Official-client training bridge

With the official client connected through the bridge and the plaintext
recorder attached, install the persistent loopback-only control endpoint once:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-control-agent.ps1 `
  -ProcessId <official-client-java-pid>
```

Start the packet-driven search and battle loop:

```powershell
npm.cmd run train-bridge -- `
  --capture captures/decrypted-gameplay-session2.jsonl `
  --move-id 52 `
  --max-battles 3
```

Movement uses the client's own `bI` transition, so the first input after a
direction change may only turn the character and the next identical input moves
a tile. The in-client battle-state guard rejects movement during encounter and
battle transitions. `--max-battles 0` removes the safety cap; keep a finite cap
until party HP and healing policy are configured.

## Scope

Do not use this project to bypass authentication, encryption, anti-cheat, access
controls, or third-party service rules. Captures may contain secrets; keep them
out of source control and delete them when no longer needed.
