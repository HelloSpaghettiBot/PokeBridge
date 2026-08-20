import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { summarizeCaptures } from '../src/capture-summary.js';

test('summarizes socks game targets and bridge connections', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tcp-capture-summary-'));

  try {
    await writeFile(join(directory, 'socks-session.000000.jsonl'), [
      JSON.stringify({
        timestamp: '2026-07-21T00:00:00.000Z',
        type: 'socks_connect',
        target: '104.26.7.220:443',
      }),
      JSON.stringify({
        timestamp: '2026-07-21T00:00:01.000Z',
        type: 'socks_connect',
        target: 'loginserver.pokemmo.com:2106',
      }),
      JSON.stringify({
        timestamp: '2026-07-21T00:00:02.000Z',
        type: 'socks_data',
        direction: 'client_to_upstream',
        length: 12,
      }),
      '',
    ].join('\n'));
    await writeFile(join(directory, 'bridge-session.000000.jsonl'), [
      JSON.stringify({
        timestamp: '2026-07-21T00:00:03.000Z',
        type: 'connection_open',
        client: '127.0.0.1:50000',
        upstream: '207.246.96.200:2106',
      }),
      JSON.stringify({
        timestamp: '2026-07-21T00:00:04.000Z',
        type: 'tcp_data',
        direction: 'client_to_upstream',
        length: 4,
      }),
      '',
    ].join('\n'));

    const summary = await summarizeCaptures({ capturesDir: directory });
    assert.equal(summary.socksTargets.length, 2);
    assert.equal(summary.gameSocksTargets.length, 1);
    assert.equal(summary.gameSocksTargets[0].target, 'loginserver.pokemmo.com:2106');
    assert.equal(summary.bridgeConnections.length, 1);
    assert.equal(summary.bridgeDataRecords, 1);
    assert.equal(summary.socksDataRecords, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
