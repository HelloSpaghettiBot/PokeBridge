import { createCipheriv, createDecipheriv, createHash, createHmac, timingSafeEqual } from 'node:crypto';

const IV_SALT = Buffer.from('IVDERIV', 'ascii');
const CLIENT_KEY_SALT = Buffer.from([75, 101, 121, 83, 97, 108, 116, 1]);
const SERVER_KEY_SALT = Buffer.from([75, 101, 121, 83, 97, 108, 116, 2]);

export function deriveSessionKeys(sharedSecret) {
  const secret = Buffer.from(sharedSecret);
  if (secret.length * 8 < 128) throw new Error('ECDH shared secret must provide at least 128 bits');
  return {
    clientToServerKey: derive16(secret, CLIENT_KEY_SALT),
    serverToClientKey: derive16(secret, SERVER_KEY_SALT),
  };
}

export function deriveIv(key) {
  return derive16(Buffer.from(key), IV_SALT);
}

export function crc16Modbus(buffer) {
  let crc = 0;
  for (const value of buffer) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc & 0xffff;
}

export class GameSessionCrypto {
  constructor(sharedSecret, options = {}) {
    const role = options.role ?? 'client';
    if (!['client', 'server'].includes(role)) throw new TypeError('role must be client or server');
    this.checksumMode = Number(options.checksumMode ?? 2);
    if (this.checksumMode !== 2 && (this.checksumMode < 4 || this.checksumMode > 32)) {
      throw new Error(`Unsupported checksum mode: ${this.checksumMode}`);
    }
    const keys = deriveSessionKeys(sharedSecret);
    const outboundKey = role === 'client' ? keys.clientToServerKey : keys.serverToClientKey;
    const inboundKey = role === 'client' ? keys.serverToClientKey : keys.clientToServerKey;
    this.outbound = createCipheriv('aes-128-ctr', outboundKey, deriveIv(outboundKey));
    this.inbound = createDecipheriv('aes-128-ctr', inboundKey, deriveIv(inboundKey));
    this.outboundChecksumKey = outboundKey;
    this.inboundChecksumKey = inboundKey;
    this.outboundCounter = 0;
    this.inboundCounter = 0;
  }

  encryptFrame(plainFrame) {
    if (!Buffer.isBuffer(plainFrame) || plainFrame.length < 3) {
      throw new TypeError('plainFrame must contain a length prefix and opcode');
    }
    const encryptedBody = this.outbound.update(plainFrame.subarray(2));
    const checksum = this.#checksum(this.outboundChecksumKey, encryptedBody, this.outboundCounter++);
    const result = Buffer.allocUnsafe(2 + encryptedBody.length + checksum.length);
    result.writeUInt16LE(result.length, 0);
    encryptedBody.copy(result, 2);
    checksum.copy(result, result.length - checksum.length);
    return result;
  }

  decryptFrame(encryptedFrame) {
    const checksumLength = this.checksumMode;
    if (!Buffer.isBuffer(encryptedFrame) || encryptedFrame.length < 3 + checksumLength) {
      throw new TypeError('encryptedFrame is too short');
    }
    if (encryptedFrame.readUInt16LE(0) !== encryptedFrame.length) {
      throw new Error('Encrypted frame length prefix mismatch');
    }
    const encryptedBody = encryptedFrame.subarray(2, -checksumLength);
    const expectedChecksum = encryptedFrame.subarray(-checksumLength);
    const actualChecksum = this.#checksum(this.inboundChecksumKey, encryptedBody, this.inboundCounter++);
    if (!timingSafeEqual(expectedChecksum, actualChecksum)) {
      throw new Error('Encrypted frame checksum mismatch');
    }
    const plainBody = this.inbound.update(encryptedBody);
    const result = Buffer.allocUnsafe(2 + plainBody.length);
    result.writeUInt16LE(result.length, 0);
    plainBody.copy(result, 2);
    return result;
  }

  #checksum(key, encryptedBody, counter) {
    if (this.checksumMode === 2) {
      const checksum = Buffer.allocUnsafe(2);
      checksum.writeUInt16LE(crc16Modbus(encryptedBody));
      return checksum;
    }
    const sequence = Buffer.allocUnsafe(4);
    sequence.writeUInt32BE(counter >>> 0);
    return createHmac('sha256', key)
      .update(encryptedBody)
      .update(sequence)
      .digest()
      .subarray(0, this.checksumMode);
  }
}

function derive16(value, salt) {
  return createHash('sha256')
    .update(salt)
    .update(value)
    .update(salt)
    .digest()
    .subarray(0, 16);
}
