import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  CLIENT_REVISION,
  encodeCharacterSelection,
  encodeLoginRequest,
  parseActiveGameSession,
  parseLoginSession,
  parseServerList,
  selectGameEndpoint,
  utf16z,
} from '../src/headless/official-protocol.js';

test('parses the live opcode-38 active-session reconnect descriptor', () => {
  const captured = Buffer.from('00908892d042671a106a07f06653813a7b7af83b03cde9f19b014c006900760065000000047f0000016c006f00630061006c0068006f00730074000000611e00000100010001040104870db4b906010093c8a06e022a5035c86a81550000611e2d0204910db4b906010093c8a06e022a332680d1a2a20000611e2d0504fa50fbc60684042000006405260000000000000000611e0a0f04c860f6cf06b8540160f019012064e3cbfeff050054611e2d', 'hex');
  const parsed = parseActiveGameSession(captured);
  assert.equal(parsed.characterId, 1902562831166377984n);
  assert.equal(parsed.serverName, 'Live');
  assert.equal(parsed.token.toString('hex'), '6a07f06653813a7b7af83b03cde9f19b');
  assert.deepEqual(selectGameEndpoint(parsed), { host: '185.180.13.135', port: 7777 });
});

test('encodes the official password login request', () => {
  const deviceId = Buffer.alloc(32, 0x5a);
  const payload = encodeLoginRequest({ username: 'test-user', password: 'temporary-password', deviceId });
  assert.equal(payload.subarray(0, 20).toString('utf16le'), 'test-user\0');
  assert.equal(payload[20], 0);
  assert.equal(payload[21], 32);
  assert.deepEqual(payload.subarray(22, 54), deviceId);
  assert.equal(payload[54], 0);
  const expectedHash = createHash('sha1').update('temporary-password').digest('hex');
  assert.ok(payload.includes(utf16z(expectedHash)));
  assert.equal(payload.readInt32LE(payload.length - 10), CLIENT_REVISION);
  assert.equal(payload.readInt32LE(payload.length - 6), CLIENT_REVISION);
  assert.equal(payload[payload.length - 2], 1);
  assert.equal(payload[payload.length - 1], 0);
});

test('parses server selection and dynamically assigned IPv4 game endpoint', () => {
  const serverList = Buffer.concat([
    Buffer.from([1, 1, 1]), utf16z('Live'),
    Buffer.from([25, 0, 100, 0, 1]),
  ]);
  assert.equal(parseServerList(serverList).servers[0].name, 'Live');

  const endpoint = Buffer.from('0104870db4b906010093c8a06e022a5035c86a81550000611e2d', 'hex');
  const session = Buffer.concat([
    Buffer.from([0]), Buffer.from([0x14, 0xb2, 0x20, 0]), Buffer.from([2, 1, 2, 1, 4, 127, 0, 0, 1]),
    utf16z('localhost'), Buffer.from([0x61, 0x1e, 0, 0]), Buffer.from([1]), endpoint,
  ]);
  const parsed = parseLoginSession(session);
  assert.equal(parsed.accountId, 2_142_740);
  assert.deepEqual(parsed.token, Buffer.from([1, 2]));
  assert.deepEqual(selectGameEndpoint(parsed), { host: '185.180.13.135', port: 7777 });
});

test('parses the compact opcode-34 live and PTS server list', () => {
  const captured = Buffer.from('0201014c00690076006500000019006400010250005400530000000000640000', 'hex');
  const parsed = parseServerList(captured, 34);
  assert.equal(parsed.selectedServerId, 1);
  assert.deepEqual(parsed.servers.map(server => ({ id: server.id, name: server.name, online: server.online })), [
    { id: 1, name: 'Live', online: true },
    { id: 2, name: 'PTS', online: false },
  ]);
});

test('encodes character id and native proof as two little-endian longs', () => {
  assert.equal(
    encodeCharacterSelection(0x1a6742d092889000n, 0xde5aef8846ef48afn).toString('hex'),
    '00908892d042671aaf48ef4688ef5ade',
  );
});
