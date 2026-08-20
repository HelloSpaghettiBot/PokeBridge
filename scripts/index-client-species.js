import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { readFile, writeFile } from 'node:fs/promises';

function option(name, fallback) { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : fallback; }
const output = path.resolve(option('output', 'captures/client-species-index.json'));
const status = path.resolve(option('status', 'captures/species-index-status.json'));
const speciesPort = Number(option('species-port', '37670'));
const dexPort = Number(option('dex-port', '37667'));
const maximum = Number(option('max-id', '2000'));

function commandAt(port, line, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let response = '';
    const timeout = setTimeout(() => socket.destroy(new Error(`Timeout: ${line}`)), timeoutMs);
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write(`${line}\n`));
    socket.on('data', chunk => {
      response += chunk;
      const newline = response.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timeout); socket.end();
      const answer = response.slice(0, newline).trim();
      answer.startsWith('OK ') ? resolve(answer.slice(3)) : reject(new Error(answer));
    });
    socket.once('error', reject);
  });
}

async function existing() { try { return JSON.parse(await readFile(output, 'utf8')); } catch { return { version: 1, species: {} }; } }
const index = await existing();
const startedAt = Date.now();
for (let id = 1; id <= maximum; id += 1) {
  const resolved = await commandAt(speciesPort, `RESOLVE ${id}`);
  if (resolved.startsWith('SPECIES ')) {
    const name = /\bname=([^\s]+)/.exec(resolved)?.[1]?.replaceAll('_', ' ') ?? `Species ${id}`;
    const dexResponse = await commandAt(dexPort, `LOOKUP ${id}`);
    const locations = dexResponse.startsWith('DEX_B64 ') ? JSON.parse(Buffer.from(dexResponse.slice(8), 'base64').toString('utf8')) : null;
    index.species[String(id)] = { id, name, locations, indexedAt: new Date().toISOString() };
  }
  if (id % 20 === 0 || id === maximum) {
    index.updatedAt = new Date().toISOString();
    await writeFile(output, `${JSON.stringify(index, null, 2)}\n`);
    await writeFile(status, `${JSON.stringify({ running: id < maximum, checked: id, maximum, found: Object.keys(index.species).length, elapsedMs: Date.now() - startedAt, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  }
}
process.stdout.write(`Indexed ${Object.keys(index.species).length} official-client species records through ID ${maximum}\n`);
