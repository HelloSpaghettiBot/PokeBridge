import { createECDH, createPublicKey, randomBytes, verify } from 'node:crypto';

const CLIENT_HELLO_XOR_1 = 3214621489648854472n;
const CLIENT_HELLO_XOR_2 = -4214651440992349575n;
const OFFICIAL_SERVER_KEYS = Object.freeze({
  primary: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEtqx2myJz3ftlYWgd7cbNqf2t208itQMY7ouPNBDpQetbi7eXbEDxDDZy4Q9fMnI6mF5/D0qMdRd40SRXf0OS7Q==',
  secondary: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEh4Vqgnd+8Fqebu0H40v+FgwhE6RwgAYxJMihb8mJmcHDy8r/rPz3kLHH1oabyKIRUa5Y2cK0TsxZky+mp7DKWA==',
});

export function createClientHelloFrame(options = {}) {
  const nonce = options.nonce === undefined
    ? randomBytes(8).readBigUInt64LE(0)
    : BigInt.asUintN(64, BigInt(options.nonce));
  const timestamp = BigInt.asUintN(64, BigInt(options.timestamp ?? Date.now()));
  const frame = Buffer.allocUnsafe(19);
  frame.writeUInt16LE(frame.length, 0);
  frame[2] = 0;
  frame.writeBigUInt64LE(BigInt.asUintN(64, nonce ^ CLIENT_HELLO_XOR_1), 3);
  frame.writeBigUInt64LE(BigInt.asUintN(64, timestamp ^ nonce ^ CLIENT_HELLO_XOR_2), 11);
  return frame;
}

export function decodeClientHelloFrame(frame) {
  if (!Buffer.isBuffer(frame) || frame.length !== 19 || frame.readUInt16LE(0) !== 19 || frame[2] !== 0) {
    throw new Error('Invalid client hello frame');
  }
  const encodedNonce = frame.readBigUInt64LE(3);
  const nonce = BigInt.asUintN(64, encodedNonce ^ CLIENT_HELLO_XOR_1);
  const timestamp = BigInt.asUintN(64, frame.readBigUInt64LE(11) ^ nonce ^ CLIENT_HELLO_XOR_2);
  return { opcode: 0, nonce, timestamp };
}

export function verifyOfficialServerHello(publicKey, signature, keyId = 'primary') {
  const encodedKey = OFFICIAL_SERVER_KEYS[keyId];
  if (!encodedKey) throw new Error(`Unknown official server key: ${keyId}`);
  const verificationKey = createPublicKey({
    key: Buffer.from(encodedKey, 'base64'),
    format: 'der',
    type: 'spki',
  });
  return verify('sha256', publicKey, verificationKey, signature);
}

export function parseServerHelloFrame(frame) {
  if (!Buffer.isBuffer(frame) || frame.length < 8) throw new Error('Server hello frame is too short');
  if (frame.readUInt16LE(0) !== frame.length) throw new Error('Server hello length prefix mismatch');
  let offset = 2;
  const opcode = frame[offset];
  offset += 1;
  if (opcode !== 1) throw new Error(`Unexpected server hello opcode: ${opcode}`);
  const publicKeyLength = frame.readUInt16LE(offset);
  offset += 2;
  const publicKey = readSection(frame, offset, publicKeyLength, 'server public key');
  offset += publicKeyLength;
  const signatureLength = frame.readUInt16LE(offset);
  offset += 2;
  const signature = readSection(frame, offset, signatureLength, 'server signature');
  offset += signatureLength;
  if (offset >= frame.length) throw new Error('Server hello checksum mode is missing');
  const checksumMode = frame[offset];
  offset += 1;
  if (offset !== frame.length) throw new Error('Unexpected trailing bytes in server hello');
  return { opcode, publicKey, signature, checksumMode };
}

export function createClientKeyExchange(serverHello, options = {}) {
  const verifyServerHello = options.verifyServerHello;
  if (typeof verifyServerHello !== 'function') {
    throw new TypeError('verifyServerHello callback is required');
  }
  if (!verifyServerHello(serverHello.publicKey, serverHello.signature)) {
    throw new Error('Server hello signature verification failed');
  }
  const ecdh = createECDH('prime256v1');
  const clientPublicKey = ecdh.generateKeys();
  const sharedSecret = ecdh.computeSecret(serverHello.publicKey);
  return {
    clientPublicKey,
    sharedSecret,
    frame: encodeClientPublicKeyFrame(clientPublicKey),
    checksumMode: serverHello.checksumMode,
  };
}

export function encodeClientPublicKeyFrame(publicKey) {
  const key = Buffer.from(publicKey);
  const frame = Buffer.allocUnsafe(2 + 1 + 2 + key.length);
  frame.writeUInt16LE(frame.length, 0);
  frame[2] = 2;
  frame.writeUInt16LE(key.length, 3);
  key.copy(frame, 5);
  return frame;
}

function readSection(frame, offset, length, label) {
  if (length < 0 || offset + length > frame.length) throw new Error(`Invalid ${label} length: ${length}`);
  return Buffer.from(frame.subarray(offset, offset + length));
}
