import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSocksBridge } from '../src/socks-bridge.js';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

async function socksConnect(proxyAddress, targetHost, targetPort) {
  const socket = net.createConnection({ host: proxyAddress.address, port: proxyAddress.port });
  await once(socket, 'connect');
  socket.write(Buffer.from([0x05, 0x01, 0x00]));
  const methodResponse = await onceData(socket);
  assert.deepEqual(methodResponse, Buffer.from([0x05, 0x00]));

  const host = Buffer.from(targetHost);
  const request = Buffer.concat([
    Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]),
    host,
    Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff]),
  ]);
  socket.write(request);
  const connectResponse = await onceData(socket);
  assert.equal(connectResponse[0], 0x05);
  assert.equal(connectResponse[1], 0x00);
  return socket;
}

test('socks bridge forwards domain connect traffic and records bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tcp-socks-bridge-'));
  const capturePath = join(directory, 'socks.jsonl');
  const echo = net.createServer((socket) => socket.pipe(socket));
  const echoAddress = await listen(echo);
  const bridge = await createSocksBridge({
    listenPort: 0,
    capturePath,
    capturePayload: true,
    allowedPorts: [echoAddress.port],
    logger: { log() {}, error() {} },
  });

  try {
    const socket = await socksConnect(bridge.address, 'localhost', echoAddress.port);
    socket.write(Buffer.from([0xde, 0xad, 0xbe, 0xef]));
    const response = await onceData(socket);
    assert.deepEqual(response, Buffer.from([0xde, 0xad, 0xbe, 0xef]));
    socket.end();
  } finally {
    await bridge.close();
    await new Promise((resolve) => echo.close(resolve));
  }

  const records = (await readFile(capturePath, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(records.some((record) => record.type === 'socks_connect' && record.target === `localhost:${echoAddress.port}`));
  assert.ok(records.some((record) => record.type === 'socks_data' && record.dataHex === 'deadbeef'));
  await rm(directory, { recursive: true, force: true });
});

test('socks bridge rejects disallowed ports', async () => {
  const echo = net.createServer((socket) => socket.pipe(socket));
  const echoAddress = await listen(echo);
  const bridge = await createSocksBridge({
    listenPort: 0,
    allowedPorts: [echoAddress.port + 1],
    logger: { log() {}, error() {} },
  });

  try {
    const socket = net.createConnection({ host: bridge.address.address, port: bridge.address.port });
    await once(socket, 'connect');
    socket.write(Buffer.from([0x05, 0x01, 0x00]));
    assert.deepEqual(await onceData(socket), Buffer.from([0x05, 0x00]));
    const host = Buffer.from('localhost');
    socket.write(Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]),
      host,
      Buffer.from([(echoAddress.port >> 8) & 0xff, echoAddress.port & 0xff]),
    ]));
    const response = await onceData(socket);
    assert.equal(response[1], 0x02);
    socket.destroy();
  } finally {
    await bridge.close();
    await new Promise((resolve) => echo.close(resolve));
  }
});

test('socks bridge can record metadata without payload hex', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tcp-socks-bridge-'));
  const capturePath = join(directory, 'socks.jsonl');
  const echo = net.createServer((socket) => socket.pipe(socket));
  const echoAddress = await listen(echo);
  const bridge = await createSocksBridge({
    listenPort: 0,
    capturePath,
    capturePayload: false,
    allowedPorts: [echoAddress.port],
    logger: { log() {}, error() {} },
  });

  try {
    const socket = await socksConnect(bridge.address, 'localhost', echoAddress.port);
    socket.write(Buffer.from([0xca, 0xfe]));
    await onceData(socket);
    socket.end();
  } finally {
    await bridge.close();
    await new Promise((resolve) => echo.close(resolve));
  }

  const records = (await readFile(capturePath, 'utf8')).trim().split('\n').map(JSON.parse);
  const dataRecord = records.find((record) => record.type === 'socks_data');
  assert.equal(dataRecord.length, 2);
  assert.equal(dataRecord.dataHex, undefined);
  await rm(directory, { recursive: true, force: true });
});

function once(emitter, event) {
  return new Promise((resolve, reject) => {
    emitter.once(event, resolve);
    emitter.once('error', reject);
  });
}

function onceData(socket) {
  return once(socket, 'data');
}
