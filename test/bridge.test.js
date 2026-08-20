import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createBridge } from '../src/bridge.js';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

test('forwards bytes in both directions and records them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tcp-bridge-'));
  const capturePath = join(directory, 'capture.jsonl');
  const echo = net.createServer((socket) => socket.pipe(socket));
  const echoAddress = await listen(echo);
  const bridge = await createBridge({
    listenPort: 0,
    upstreamHost: '127.0.0.1',
    upstreamPort: echoAddress.port,
    capturePath,
    logger: { log() {}, error() {} },
  });

  try {
    const response = await new Promise((resolve, reject) => {
      const client = net.createConnection({
        host: bridge.address.address,
        port: bridge.address.port,
      });
      client.once('connect', () => client.write(Buffer.from([0x00, 0x7f, 0x80, 0xff])));
      client.once('data', (data) => {
        client.end();
        resolve(data);
      });
      client.once('error', reject);
    });

    assert.deepEqual(response, Buffer.from([0x00, 0x7f, 0x80, 0xff]));
  } finally {
    await bridge.close();
    await new Promise((resolve) => echo.close(resolve));
  }

  const records = (await readFile(capturePath, 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  const dataRecords = records.filter((record) => record.type === 'tcp_data');
  assert.deepEqual(dataRecords.map((record) => record.direction), [
    'client_to_upstream',
    'upstream_to_client',
  ]);
  assert.ok(dataRecords.every((record) => record.dataHex === '007f80ff'));

  await rm(directory, { recursive: true, force: true });
});

test('rotates capture files when the configured byte limit is reached', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tcp-bridge-'));
  const capturePath = join(directory, 'capture.jsonl');
  const echo = net.createServer((socket) => socket.pipe(socket));
  const echoAddress = await listen(echo);
  const bridge = await createBridge({
    listenPort: 0,
    upstreamHost: '127.0.0.1',
    upstreamPort: echoAddress.port,
    capturePath,
    captureMaxBytes: 500,
    logger: { log() {}, error() {} },
  });

  try {
    await new Promise((resolve, reject) => {
      const client = net.createConnection({
        host: bridge.address.address,
        port: bridge.address.port,
      });
      let responseBytes = 0;
      client.once('connect', () => {
        client.write(Buffer.alloc(64, 0x41));
        client.write(Buffer.alloc(64, 0x42));
      });
      client.on('data', (data) => {
        responseBytes += data.length;
        if (responseBytes === 128) client.end(resolve);
      });
      client.once('error', reject);
    });
  } finally {
    await bridge.close();
    await new Promise((resolve) => echo.close(resolve));
  }

  const files = await readdir(directory);
  assert.ok(files.filter((file) => /^capture\.\d{6}\.jsonl$/.test(file)).length >= 2);
  await rm(directory, { recursive: true, force: true });
});

test('rejects connections over the configured active connection limit', async () => {
  const upstreamSockets = new Set();
  const hold = net.createServer();
  hold.on('connection', (socket) => {
    upstreamSockets.add(socket);
    socket.once('close', () => upstreamSockets.delete(socket));
  });
  const holdAddress = await listen(hold);
  const bridge = await createBridge({
    listenPort: 0,
    upstreamHost: '127.0.0.1',
    upstreamPort: holdAddress.port,
    maxConnections: 1,
    logger: { log() {}, error() {} },
  });

  const firstClient = net.createConnection({
    host: bridge.address.address,
    port: bridge.address.port,
  });

  try {
    await new Promise((resolve, reject) => {
      firstClient.once('connect', resolve);
      firstClient.once('error', reject);
    });

    await new Promise((resolve) => {
      const secondClient = net.createConnection({
        host: bridge.address.address,
        port: bridge.address.port,
      });
      secondClient.once('close', resolve);
      secondClient.once('error', () => {});
    });

    assert.equal(bridge.getStats().connectionsRejected, 1);
  } finally {
    firstClient.destroy();
    await bridge.close();
    for (const socket of upstreamSockets) socket.destroy();
    await new Promise((resolve) => hold.close(resolve));
  }
});

test('can record traffic metadata without payload hex', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tcp-bridge-'));
  const capturePath = join(directory, 'capture.jsonl');
  const echo = net.createServer((socket) => socket.pipe(socket));
  const echoAddress = await listen(echo);
  const bridge = await createBridge({
    listenPort: 0,
    upstreamHost: '127.0.0.1',
    upstreamPort: echoAddress.port,
    capturePath,
    capturePayload: false,
    logger: { log() {}, error() {} },
  });

  try {
    await new Promise((resolve, reject) => {
      const client = net.createConnection({
        host: bridge.address.address,
        port: bridge.address.port,
      });
      client.once('connect', () => client.write(Buffer.from([0x01, 0x02])));
      client.once('data', () => client.end(resolve));
      client.once('error', reject);
    });
  } finally {
    await bridge.close();
    await new Promise((resolve) => echo.close(resolve));
  }

  const records = (await readFile(capturePath, 'utf8')).trim().split('\n').map(JSON.parse);
  const dataRecord = records.find((record) => record.type === 'tcp_data');
  assert.equal(dataRecord.length, 2);
  assert.equal(dataRecord.dataHex, undefined);
  await rm(directory, { recursive: true, force: true });
});

test('can rewrite upstream bytes before forwarding', async () => {
  const upstream = net.createServer((socket) => {
    socket.once('data', () => socket.end(Buffer.from([0xb9, 0xb4, 0x0d, 0x88])));
  });
  const upstreamAddress = await listen(upstream);
  const bridge = await createBridge({
    listenPort: 0,
    upstreamHost: '127.0.0.1',
    upstreamPort: upstreamAddress.port,
    rewriteRules: [{
      direction: 'upstream_to_client',
      fromHex: 'b9b40d88',
      toHex: '7f000001',
    }],
    logger: { log() {}, error() {} },
  });

  try {
    const response = await new Promise((resolve, reject) => {
      const client = net.createConnection({
        host: bridge.address.address,
        port: bridge.address.port,
      });
      client.once('connect', () => client.write(Buffer.from([0x01])));
      client.once('data', resolve);
      client.once('error', reject);
    });
    assert.deepEqual(response, Buffer.from([0x7f, 0x00, 0x00, 0x01]));
  } finally {
    await bridge.close();
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test('can rewrite upstream bytes split across TCP chunks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tcp-bridge-'));
  const capturePath = join(directory, 'capture.jsonl');
  const upstream = net.createServer((socket) => {
    socket.once('data', () => {
      socket.write(Buffer.from([0xb9, 0xb4]));
      setImmediate(() => socket.end(Buffer.from([0x0d, 0x88])));
    });
  });
  const upstreamAddress = await listen(upstream);
  const bridge = await createBridge({
    listenPort: 0,
    upstreamHost: '127.0.0.1',
    upstreamPort: upstreamAddress.port,
    capturePath,
    rewriteRules: [{
      direction: 'upstream_to_client',
      fromHex: 'b9b40d88',
      toHex: '7f000001',
    }],
    logger: { log() {}, error() {} },
  });

  try {
    const response = await new Promise((resolve, reject) => {
      const client = net.createConnection({
        host: bridge.address.address,
        port: bridge.address.port,
      });
      const chunks = [];
      client.once('connect', () => client.write(Buffer.from([0x01])));
      client.on('data', (data) => chunks.push(data));
      client.once('end', () => resolve(Buffer.concat(chunks)));
      client.once('error', reject);
    });
    assert.deepEqual(response, Buffer.from([0x7f, 0x00, 0x00, 0x01]));
  } finally {
    await bridge.close();
    await new Promise((resolve) => upstream.close(resolve));
  }

  const records = (await readFile(capturePath, 'utf8')).trim().split('\n').map(JSON.parse);
  const rewritten = records.filter((record) => record.type === 'tcp_data' && record.rewritten);
  assert.equal(rewritten.length, 1);
  assert.equal(rewritten[0].rewriteMatches, 1);

  await rm(directory, { recursive: true, force: true });
});
