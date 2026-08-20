import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = new Map(process.argv.slice(2).map((arg, index, list) => {
  if (!arg.startsWith('--')) return [String(index), arg];
  const next = list[index + 1];
  return [arg.slice(2), next && !next.startsWith('--') ? next : true];
}));

const capturePath = resolve(String(args.get('capture') ?? 'captures/socks-session.000000.jsonl'));
const intervalMs = Number(args.get('interval-ms') ?? 1000);
const timeoutMs = Number(args.get('timeout-ms') ?? 0);
const startNow = args.get('start-now') === true || args.get('start-now') === 'true';
const targetPorts = new Set(String(args.get('ports') ?? '2106,7777,7780')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value)));

if (!Number.isInteger(intervalMs) || intervalMs < 250) throw new TypeError('interval-ms must be >= 250');
if (!Number.isInteger(timeoutMs) || timeoutMs < 0) throw new TypeError('timeout-ms must be >= 0');

const seen = new Set();
const startedAt = Date.now();
console.log(`monitoring ${capturePath} for ports ${[...targetPorts].join(', ')}`);

if (startNow) {
  const existingRecords = await readRecords(capturePath);
  for (const record of existingRecords) {
    if (record.type === 'socks_connect' && record.target) {
      seen.add(`${record.timestamp}|${record.target}`);
    }
  }
  console.log(`ignoring ${seen.size} existing SOCKS connect events`);
}

while (true) {
  const records = await readRecords(capturePath);
  for (const record of records) {
    if (record.type !== 'socks_connect' || !record.target) continue;
    const [host, portText] = String(record.target).split(':');
    const port = Number(portText);
    const key = `${record.timestamp}|${record.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = targetPorts.has(port) ? 'GAME' : 'OTHER';
    console.log(`${label} ${record.timestamp} ${host}:${port}`);
    if (targetPorts.has(port)) process.exit(0);
  }

  if (timeoutMs > 0 && Date.now() - startedAt >= timeoutMs) {
    console.error(`timed out waiting for target ports after ${timeoutMs}ms`);
    process.exit(2);
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
}

async function readRecords(path) {
  try {
    const text = await readFile(path, 'utf8');
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
