import { EventEmitter } from 'node:events';
import net from 'node:net';
import { constants as zlibConstants, createInflateRaw } from 'node:zlib';
import {
  createClientHelloFrame,
  createClientKeyExchange,
  parseServerHelloFrame,
  verifyOfficialServerHello,
} from './game-handshake.js';
import { LengthPrefixedPacketFramer } from './packet-framer.js';
import { GameSessionCrypto } from './session-crypto.js';

export class GameTransport extends EventEmitter {
  constructor(options = {}) {
    super();
    this.host = options.host ?? '127.0.0.1';
    this.port = Number(options.port ?? 7777);
    this.serverKeyId = options.serverKeyId ?? 'primary';
    this.verifyServerHello = options.verifyServerHello
      ?? ((publicKey, signature) => verifyOfficialServerHello(publicKey, signature, this.serverKeyId));
    this.connectTimeoutMs = Number(options.connectTimeoutMs ?? 10_000);
    this.socketFactory = options.socketFactory ?? ((socketOptions) => net.createConnection(socketOptions));
    this.inboundCompression = Boolean(options.inboundCompression);
    this.framer = new LengthPrefixedPacketFramer();
    this.socket = null;
    this.crypto = null;
    this.state = 'disconnected';
    this.inflater = this.inboundCompression ? new PersistentPacketInflater() : null;
    this.inboundQueue = Promise.resolve();
  }

  async connect() {
    if (this.state !== 'disconnected') throw new Error(`Cannot connect while ${this.state}`);
    this.state = 'connecting';
    this.socket = this.socketFactory({ host: this.host, port: this.port });
    this.socket.setNoDelay?.(true);

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
        this.emit('transportError', error);
        this.close();
      };
      const timer = setTimeout(() => fail(new Error('Timed out waiting for secure handshake')), this.connectTimeoutMs);

      this.socket.once('connect', () => {
        this.state = 'waiting_server_hello';
        this.socket.write(createClientHelloFrame());
      });
      this.socket.on('data', (chunk) => {
        try {
          for (const frame of this.framer.push(chunk)) {
            if (this.state === 'waiting_server_hello') {
              const serverHello = parseServerHelloFrame(frame);
              const exchange = createClientKeyExchange(serverHello, {
                verifyServerHello: this.verifyServerHello,
              });
              this.socket.write(exchange.frame);
              this.crypto = new GameSessionCrypto(exchange.sharedSecret, {
                role: 'client',
                checksumMode: exchange.checksumMode,
              });
              this.state = 'secure';
              if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve({
                  checksumMode: exchange.checksumMode,
                  serverPublicKey: Buffer.from(serverHello.publicKey),
                });
              }
              this.emit('secure');
            } else if (this.state === 'secure') {
              const plainFrame = this.crypto.decryptFrame(frame);
              this.inboundQueue = this.inboundQueue
                .then(() => this.#emitPlainFrame(plainFrame))
                .catch(fail);
            } else {
              throw new Error(`Received a frame while transport is ${this.state}`);
            }
          }
        } catch (error) {
          fail(error);
        }
      });
      this.socket.once('error', fail);
      this.socket.once('close', () => {
        clearTimeout(timer);
        const previousState = this.state;
        this.state = 'disconnected';
        this.emit('disconnected', previousState);
        if (!settled) {
          settled = true;
          reject(new Error(`Connection closed during ${previousState}`));
        }
      });
    });
  }

  async #emitPlainFrame(plainFrame) {
    let normalized = plainFrame;
    if (this.inboundCompression) {
      if (plainFrame.length < 4) throw new Error('Compressed game frame is too short');
      const flag = plainFrame[3];
      let payload;
      if (flag === 0) payload = Buffer.from(plainFrame.subarray(4));
      else if (flag === 1) payload = await this.inflater.inflate(plainFrame.subarray(4));
      else throw new Error(`Unknown game compression flag: ${flag}`);
      normalized = Buffer.allocUnsafe(3 + payload.length);
      normalized.writeUInt16LE(normalized.length, 0);
      normalized[2] = plainFrame[2];
      payload.copy(normalized, 3);
    }
    this.emit('frame', normalized);
    this.emit('packet', {
      opcode: normalized[2],
      payload: Buffer.from(normalized.subarray(3)),
      frame: normalized,
    });
  }

  sendPacket(opcode, payload = Buffer.alloc(0)) {
    if (this.state !== 'secure' || !this.crypto || !this.socket) {
      throw new Error('Transport is not secure');
    }
    if (!Number.isInteger(opcode) || opcode < 0 || opcode > 255) {
      throw new TypeError('opcode must be an unsigned byte');
    }
    const body = Buffer.from(payload);
    const frame = Buffer.allocUnsafe(3 + body.length);
    frame.writeUInt16LE(frame.length, 0);
    frame[2] = opcode;
    body.copy(frame, 3);
    const encrypted = this.crypto.encryptFrame(frame);
    this.socket.write(encrypted);
    return encrypted;
  }

  close() {
    this.inflater?.close();
    this.socket?.destroy();
  }
}

export class PersistentPacketInflater {
  constructor() {
    this.stream = createInflateRaw();
    this.output = [];
    this.stream.on('data', chunk => this.output.push(Buffer.from(chunk)));
  }

  inflate(fragment) {
    return new Promise((resolve, reject) => {
      const start = this.output.length;
      const marker = Buffer.from([0, 0, 0xff, 0xff]);
      this.stream.write(Buffer.concat([Buffer.from(fragment), marker]), error => {
        if (error) return reject(error);
        this.stream.flush(zlibConstants.Z_SYNC_FLUSH, flushError => {
          if (flushError) return reject(flushError);
          const chunks = this.output.splice(start);
          resolve(Buffer.concat(chunks));
        });
      });
    });
  }

  close() {
    this.stream.destroy();
  }
}
