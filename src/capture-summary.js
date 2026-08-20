import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function summarizeCaptures(options = {}) {
  const capturesDir = options.capturesDir ?? 'captures';
  const gamePorts = new Set(options.gamePorts ?? [2106, 7777, 7780]);
  const files = await listCaptureFiles(capturesDir);
  const summary = {
    capturesDir,
    gamePorts: [...gamePorts],
    socksTargets: [],
    gameSocksTargets: [],
    bridgeConnections: [],
    bridgeDataRecords: 0,
    tcpDataRecords: 0,
    socksDataRecords: 0,
  };

  for (const file of files) {
    const records = await readJsonLines(file.path);
    for (const record of records) {
      if (record.type === 'socks_connect' && record.target) {
        const target = parseTarget(record.target);
        const entry = { file: file.name, timestamp: record.timestamp, target: record.target };
        summary.socksTargets.push(entry);
        if (target && gamePorts.has(target.port)) summary.gameSocksTargets.push(entry);
      }
      if (record.type === 'connection_open') {
        summary.bridgeConnections.push({
          file: file.name,
          timestamp: record.timestamp,
          client: record.client,
          upstream: record.upstream,
        });
      }
      if (record.type === 'tcp_data') {
        summary.tcpDataRecords += 1;
        summary.bridgeDataRecords += 1;
      }
      if (record.type === 'socks_data') {
        summary.socksDataRecords += 1;
      }
    }
  }

  summary.socksTargets = summary.socksTargets.slice(-50);
  summary.gameSocksTargets = summary.gameSocksTargets.slice(-50);
  summary.bridgeConnections = summary.bridgeConnections.slice(-50);
  return summary;
}

export async function readJsonLines(path) {
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

async function listCaptureFiles(capturesDir) {
  try {
    const entries = await readdir(capturesDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /\.jsonl$/i.test(entry.name))
      .map((entry) => ({ name: entry.name, path: join(capturesDir, entry.name) }));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function parseTarget(target) {
  const index = String(target).lastIndexOf(':');
  if (index < 0) return null;
  const host = String(target).slice(0, index);
  const port = Number(String(target).slice(index + 1));
  if (!host || !Number.isInteger(port)) return null;
  return { host, port };
}
