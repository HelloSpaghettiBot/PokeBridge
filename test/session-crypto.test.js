import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import test from 'node:test';
import {
  createClientHelloFrame,
  createClientKeyExchange,
  decodeClientHelloFrame,
  parseServerHelloFrame,
  verifyOfficialServerHello,
} from '../src/headless/game-handshake.js';
import { crc16Modbus, GameSessionCrypto } from '../src/headless/session-crypto.js';

const RECORDED_SERVER_HELLO = Buffer.from(
  '91000141000402491a7d8c24fc4616b2f17449e6d540a110631712259feccc93be5cb47542b0fbcc6a6ecdd596c33f183460a274f5b29bcf9c04ed41b94a296aa32889bf18e44800304602210082784354e230d1a6aac4d838a13c4e669e333a425ccd5729ebed7b05779c59ca022100c029cc08ecf6840ad42b0316269b5e7403e65058a7f797ee6f7a07b937fb600702',
  'hex',
);

test('parses the server hello recorded from the official client session', () => {
  const hello = parseServerHelloFrame(RECORDED_SERVER_HELLO);
  assert.equal(hello.opcode, 1);
  assert.equal(hello.publicKey.length, 65);
  assert.equal(hello.signature.length, 72);
  assert.equal(hello.checksumMode, 2);
  assert.equal(verifyOfficialServerHello(hello.publicKey, hello.signature), true);
});

test('reproduces and decodes the official client startup probe', () => {
  const recorded = Buffer.from('13000081d8481ef4c7fca1c345e42585ebe248', 'hex');
  const decoded = decodeClientHelloFrame(recorded);
  assert.equal(decoded.timestamp, 1784657996531n);
  const recreated = createClientHelloFrame({ nonce: decoded.nonce, timestamp: decoded.timestamp });
  assert.deepEqual(recreated, recorded);
});

test('performs the observed secp256r1 handshake and encodes opcode 2', () => {
  const server = createECDH('prime256v1');
  const serverPublicKey = server.generateKeys();
  const signature = Buffer.from('01020304', 'hex');
  const hello = Buffer.alloc(2 + 1 + 2 + serverPublicKey.length + 2 + signature.length + 1);
  hello.writeUInt16LE(hello.length, 0);
  hello[2] = 1;
  hello.writeUInt16LE(serverPublicKey.length, 3);
  serverPublicKey.copy(hello, 5);
  let offset = 5 + serverPublicKey.length;
  hello.writeUInt16LE(signature.length, offset);
  offset += 2;
  signature.copy(hello, offset);
  hello[hello.length - 1] = 2;

  const parsed = parseServerHelloFrame(hello);
  const client = createClientKeyExchange(parsed, { verifyServerHello: () => true });
  assert.equal(client.frame.readUInt16LE(0), client.frame.length);
  assert.equal(client.frame[2], 2);
  assert.equal(client.frame.readUInt16LE(3), 65);
  assert.deepEqual(server.computeSecret(client.clientPublicKey), client.sharedSecret);
});

test('encrypts and decrypts continuous AES-CTR frames with CRC-16', () => {
  const sharedSecret = Buffer.from('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff', 'hex');
  const client = new GameSessionCrypto(sharedSecret, { role: 'client' });
  const server = new GameSessionCrypto(sharedSecret, { role: 'server' });
  const first = Buffer.from('08002a0102030405', 'hex');
  const second = Buffer.from('0c0033010203040506070809', 'hex');

  const firstEncrypted = client.encryptFrame(first);
  const secondEncrypted = client.encryptFrame(second);
  assert.equal(firstEncrypted.readUInt16LE(0), first.length + 2);
  assert.equal(crc16Modbus(firstEncrypted.subarray(2, -2)), firstEncrypted.readUInt16LE(firstEncrypted.length - 2));
  assert.deepEqual(server.decryptFrame(firstEncrypted), first);
  assert.deepEqual(server.decryptFrame(secondEncrypted), second);
});

test('rejects tampered encrypted frames before decryption', () => {
  const secret = Buffer.alloc(32, 7);
  const client = new GameSessionCrypto(secret, { role: 'client' });
  const server = new GameSessionCrypto(secret, { role: 'server' });
  const encrypted = client.encryptFrame(Buffer.from('050010aabb', 'hex'));
  encrypted[3] ^= 0x80;
  assert.throws(() => server.decryptFrame(encrypted), /checksum mismatch/);
});

test('encrypts login-service frames with counter-bound HMAC-SHA256 checksums', () => {
  const secret = Buffer.alloc(32, 11);
  const client = new GameSessionCrypto(secret, { role: 'client', checksumMode: 16 });
  const server = new GameSessionCrypto(secret, { role: 'server', checksumMode: 16 });
  const first = Buffer.from('090011010203040506', 'hex');
  const second = Buffer.from('030002', 'hex');
  const firstEncrypted = client.encryptFrame(first);
  const secondEncrypted = client.encryptFrame(second);
  assert.equal(firstEncrypted.length, first.length + 16);
  assert.deepEqual(server.decryptFrame(firstEncrypted), first);
  assert.deepEqual(server.decryptFrame(secondEncrypted), second);
});
