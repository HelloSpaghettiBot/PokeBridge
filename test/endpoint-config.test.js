import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildBridgeConfigFromCapture,
  parseJsonLines,
  selectBridgeEndpoint,
  selectBridgeEndpoints,
  writeBridgeConfigFromCapture,
} from '../src/endpoint-config.js';

test('selects the latest established non-local endpoint', () => {
  const endpoint = selectBridgeEndpoint([
    {
      timestamp: '2026-07-21T00:00:00.000Z',
      State: 'SynSent',
      RemoteAddress: '203.0.113.10',
      RemotePort: 7777,
    },
    {
      timestamp: '2026-07-21T00:00:01.000Z',
      State: 'Established',
      RemoteAddress: '127.0.0.1',
      RemotePort: 8888,
    },
    {
      timestamp: '2026-07-21T00:00:02.000Z',
      State: 'Established',
      RemoteAddress: '198.51.100.25',
      RemotePort: 5000,
    },
  ]);

  assert.equal(endpoint.RemoteAddress, '198.51.100.25');
  assert.equal(endpoint.RemotePort, 5000);
});

test('can select local endpoints when explicitly requested', () => {
  const endpoint = selectBridgeEndpoint([
    {
      timestamp: '2026-07-21T00:00:00.000Z',
      State: 'Established',
      RemoteAddress: '127.0.0.1',
      RemotePort: 8888,
    },
  ], { includeLocal: true });

  assert.equal(endpoint.RemoteAddress, '127.0.0.1');
  assert.equal(endpoint.RemotePort, 8888);
});

test('builds and writes bridge config from watcher JSONL', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tcp-bridge-config-'));
  const inputPath = join(directory, 'client-connections.jsonl');
  const outputPath = join(directory, 'bridge.config.json');

  try {
    await writeFile(inputPath, [
      JSON.stringify({
        timestamp: '2026-07-21T00:00:00.000Z',
        State: 'Established',
        RemoteAddress: '198.51.100.25',
        RemotePort: 5000,
      }),
      '',
    ].join('\n'));

    assert.equal(parseJsonLines(await readFile(inputPath, 'utf8')).length, 1);

    const config = await buildBridgeConfigFromCapture(inputPath, {
      listenPort: 9100,
      capturePath: 'captures/test.jsonl',
    });
    assert.equal(config.upstreamHost, '198.51.100.25');
    assert.equal(config.upstreamPort, 5000);
    assert.equal(config.listenPort, 9100);

    await writeBridgeConfigFromCapture(inputPath, outputPath, { listenPort: 9200 });
    const written = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(written.listenPort, 9200);
    assert.equal(written.upstreamHost, '198.51.100.25');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('builds multi-route config and chooses latest endpoint per listen port', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tcp-bridge-config-'));
  const inputPath = join(directory, 'client-connections.jsonl');

  try {
    await writeFile(inputPath, [
      JSON.stringify({
        timestamp: '2026-07-21T00:00:00.000Z',
        State: 'Established',
        RemoteAddress: '185.180.13.135',
        RemotePort: 2106,
      }),
      JSON.stringify({
        timestamp: '2026-07-21T00:00:01.000Z',
        State: 'Established',
        RemoteAddress: '185.180.13.135',
        RemotePort: 7777,
      }),
      JSON.stringify({
        timestamp: '2026-07-21T00:00:02.000Z',
        State: 'Established',
        RemoteAddress: '207.246.96.200',
        RemotePort: 2106,
      }),
      '',
    ].join('\n'));

    assert.equal(selectBridgeEndpoints(parseJsonLines(await readFile(inputPath, 'utf8'))).length, 3);
    const config = await buildBridgeConfigFromCapture(inputPath);
    assert.equal(config.routes.length, 2);
    assert.deepEqual(config.routes.map((route) => route.listenPort), [2106, 7777]);
    const loginRoute = config.routes.find((route) => route.listenPort === 2106);
    assert.equal(loginRoute.upstreamHost, '207.246.96.200');
    assert.deepEqual(loginRoute.rewriteRules.map((rule) => rule.description).sort(), [
      '185.180.13.135 -> 127.0.0.1',
      '207.246.96.200 -> 127.0.0.1',
    ].sort());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('uses captured remote port as default listen port', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tcp-bridge-config-'));
  const inputPath = join(directory, 'client-connections.jsonl');

  try {
    await writeFile(inputPath, `${JSON.stringify({
      timestamp: '2026-07-21T00:00:00.000Z',
      State: 'Established',
      RemoteAddress: '198.51.100.25',
      RemotePort: 5000,
    })}\n`);

    const config = await buildBridgeConfigFromCapture(inputPath);
    assert.equal(config.listenPort, 5000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
