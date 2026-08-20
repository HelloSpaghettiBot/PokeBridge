import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('watcher can emit bridge config from an observed established connection', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tcp-bridge-watcher-'));
  const capturePath = join(directory, 'client-connections.jsonl');
  const configPath = join(directory, 'bridge.config.json');
  let socketProcess;
  let watcher;

  try {
    await new Promise((resolve, reject) => {
      socketProcess = spawn(process.execPath, ['-e', `
const net = require('node:net');
const server = net.createServer(() => {});
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  const client = net.createConnection({ host: '127.0.0.1', port: address.port }, () => {
    console.log(address.port);
  });
  setTimeout(() => {
    client.destroy();
    server.close();
  }, 15000);
});
`], { windowsHide: true });
      socketProcess.stdout.once('data', resolve);
      socketProcess.once('error', reject);
    });

    watcher = spawn(process.execPath, [
      'scripts/watch-client-connections.js',
      '--process-ids',
      String(socketProcess.pid),
      '--out',
      capturePath,
      '--config-out',
      configPath,
      '--interval-ms',
      '250',
      '--once',
      'true',
      '--include-local',
      'true',
    ], { windowsHide: true });

    const exitCode = await new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      watcher.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      watcher.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      const timer = setTimeout(() => reject(new Error(`watcher did not generate config in time\nstdout:\n${stdout}\nstderr:\n${stderr}`)), 15000);
      watcher.once('error', reject);
      watcher.once('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });

    assert.equal(exitCode, 0);
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    assert.equal(config.upstreamHost, '127.0.0.1');
    assert.ok(config.upstreamPort > 0);
  } finally {
    socketProcess?.kill();
    watcher?.kill();
    await rm(directory, { recursive: true, force: true });
  }
});
