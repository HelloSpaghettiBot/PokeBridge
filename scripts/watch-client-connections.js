import { spawn } from 'node:child_process';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { writeBridgeConfigFromCapture } from '../src/endpoint-config.js';

const args = new Map(process.argv.slice(2).map((arg, index, list) => {
  if (!arg.startsWith('--')) return [String(index), arg];
  const next = list[index + 1];
  return [arg.slice(2), next && !next.startsWith('--') ? next : true];
}));

const outputPath = resolve(String(args.get('out') ?? 'captures/client-connections.jsonl'));
const configOutPath = args.get('config-out') ? resolve(String(args.get('config-out'))) : null;
const intervalMs = Number(args.get('interval-ms') ?? 1000);
const once = args.get('once') === true || args.get('once') === 'true';
const includeLocal = args.get('include-local') === true || args.get('include-local') === 'true';
const processNames = String(args.get('process-names') ?? 'PokeMMO,java,javaw')
  .split(',')
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean);
const processIds = args.get('process-ids')
  ? String(args.get('process-ids'))
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0)
  : [];

if (!Number.isInteger(intervalMs) || intervalMs < 250) {
  throw new TypeError('interval-ms must be an integer >= 250');
}

function runPowerShell(script) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', rejectCommand);
    child.once('close', (code) => {
      if (code !== 0) rejectCommand(new Error(stderr.trim() || `PowerShell exited with ${code}`));
      else resolveCommand(stdout);
    });
  });
}

async function sampleConnections() {
  const processSelector = processIds.length > 0
    ? `$processIds = @(${processIds.join(',')})`
    : `$processes = Get-Process | Where-Object { @(${processNames.map((name) => `'${name}'`).join(',')}) -contains $_.ProcessName.ToLowerInvariant() }
$processIds = $processes | Select-Object -ExpandProperty Id`;
  const script = `
${processSelector}
if (-not $processIds) { '[]'; exit 0 }
Get-NetTCPConnection -ErrorAction SilentlyContinue |
  Where-Object { $processIds -contains $_.OwningProcess${includeLocal ? '' : " -and $_.RemoteAddress -notin @('0.0.0.0','::','127.0.0.1','::1')"} } |
  Select-Object OwningProcess,@{ Name = 'State'; Expression = { $_.State.ToString() } },LocalAddress,LocalPort,RemoteAddress,RemotePort |
  ConvertTo-Json -Compress
`;
  const raw = (await runPowerShell(script)).trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function main() {
  await mkdir(dirname(outputPath), { recursive: true });
  if (configOutPath) await mkdir(dirname(configOutPath), { recursive: true });
  const seen = new Set();
  const targetDescription = processIds.length > 0 ? `pids ${processIds.join(', ')}` : processNames.join(', ');
  console.log(`watching ${targetDescription} connections -> ${outputPath}`);
  if (configOutPath) console.log(`bridge config will be written -> ${configOutPath}`);

  const stop = () => {
    console.log('stopping connection watcher');
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  while (true) {
    const connections = await sampleConnections();
    for (const connection of connections) {
      const key = [
        connection.OwningProcess,
        connection.State,
        connection.LocalAddress,
        connection.LocalPort,
        connection.RemoteAddress,
        connection.RemotePort,
      ].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const record = {
        timestamp: new Date().toISOString(),
        ...connection,
      };
      await appendFile(outputPath, `${JSON.stringify(record)}\n`);
      console.log(`${record.State} pid=${record.OwningProcess} ${record.LocalAddress}:${record.LocalPort} -> ${record.RemoteAddress}:${record.RemotePort}`);
      if (configOutPath && String(record.State).toLowerCase() === 'established') {
        const config = await writeBridgeConfigFromCapture(outputPath, configOutPath, { includeLocal });
        console.log(`bridge config ready -> ${config.upstreamHost}:${config.upstreamPort}`);
        if (once) return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
