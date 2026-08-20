import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';

export const CLIENT_REVISION = 31_914;

export async function createDeviceId() {
  let source = '';
  for (const file of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      source = (await fs.readFile(file, 'utf8')).trim();
      if (source) break;
    } catch {}
  }
  if (!source) source = `${os.hostname()}|${os.platform()}|${os.arch()}`;
  return createHash('sha256').update(source, 'utf8').digest();
}

export function encodeLoginRequest({ username, password, deviceId, platform = 1, locale = 'en' }) {
  const passwordHash = createHash('sha1').update(String(password), 'utf8').digest('hex');
  return Buffer.concat([
    utf16z(username),
    Buffer.from([0, deviceId.length]),
    Buffer.from(deviceId),
    Buffer.from([0]),
    utf16z(passwordHash),
    Buffer.from([0]),
    utf16z(locale),
    int32(CLIENT_REVISION),
    int32(CLIENT_REVISION),
    Buffer.from([platform, 0]),
  ]);
}

export function encodeMfa(code) {
  return utf16z(code);
}

export function parseLoginStatus(payload) {
  const reader = new PacketReader(payload);
  return { status: reader.u8(), trailing: reader.rest() };
}

export function parseMfaChallenge(payload) {
  const reader = new PacketReader(payload);
  return { method: reader.u8(), message: reader.utf16z() };
}

export function parseServerList(payload, opcode = 34) {
  const reader = new PacketReader(payload);
  const count = reader.u8();
  const selectedServerId = reader.u8();
  const servers = [];
  for (let index = 0; index < count; index += 1) {
    const id = reader.u8();
    const name = reader.utf16z();
    let authData = Buffer.alloc(0);
    let advertisedHost = '';
    let advertisedPort = 0;
    if (opcode !== 34) {
      if (opcode === 2) authData = reader.bytes(4);
      else {
        authData = reader.bytes(reader.u8());
        advertisedHost = reader.utf16z();
      }
      advertisedPort = reader.i32();
    }
    const population = reader.u16();
    const capacity = reader.u16();
    const online = reader.u8() === 1;
    servers.push({ id, name, authData, advertisedHost, advertisedPort, population, capacity, online });
  }
  return { selectedServerId, servers };
}

export function parseLoginSession(payload) {
  const reader = new PacketReader(payload);
  const status = reader.u8();
  if (status !== 0) return { status };
  const accountId = reader.i32();
  const token = reader.bytes(reader.u8());
  const serverId = reader.u8();
  const clientAddress = formatAddressBytes(reader.bytes(reader.u8()));
  const advertisedHost = reader.utf16z();
  const advertisedPort = reader.i32();
  const count = reader.u8();
  const endpoints = [];
  for (let index = 0; index < count; index += 1) {
    const kind = reader.u8();
    const publicAddress = reader.address();
    const privateAddress = reader.address();
    const port = reader.u16();
    const flags = reader.u8();
    endpoints.push({ kind, publicAddress, privateAddress, port, flags });
  }
  return { status, accountId, token, serverId, clientAddress, advertisedHost, advertisedPort, endpoints };
}

export function parseActiveGameSession(payload) {
  const reader = new PacketReader(payload);
  const characterId = reader.u64();
  const token = reader.bytes(reader.u8());
  const serverId = reader.u8();
  const serverName = reader.utf16z();
  const clientAddress = formatAddressBytes(reader.bytes(reader.u8()));
  const advertisedHost = reader.utf16z();
  const advertisedPort = reader.i32();
  const population = reader.u16();
  const capacity = reader.u16();
  const online = reader.u8() === 1;
  const endpoints = [];
  for (let index = 0, count = reader.u8(); index < count; index += 1) {
    reader.u8(); // endpoint kind is not used by the official selector
    const publicAddress = reader.address();
    const privateAddress = reader.address();
    const port = reader.u16();
    const flags = reader.u8();
    endpoints.push({ publicAddress, privateAddress, port, flags });
  }
  return { characterId, token, serverId, serverName, clientAddress, advertisedHost, advertisedPort, population, capacity, online, endpoints };
}

export function selectGameEndpoint(session) {
  const usable = session.endpoints?.find(endpoint => endpoint.publicAddress?.family === 4 && endpoint.port > 0);
  if (usable) return { host: usable.publicAddress.host, port: usable.port };
  if (session.advertisedHost && session.advertisedHost !== 'localhost') {
    return { host: session.advertisedHost, port: session.advertisedPort };
  }
  throw new Error('Login service did not return a usable game endpoint');
}

export function encodeInitialTelemetry(macAddress) {
  const result = Buffer.alloc(33);
  result.writeInt32LE(0x000f0000, 0);
  result.fill(0xff, 4, 8);
  result.writeUInt16LE(0, 8);
  result.writeBigInt64LE(BigInt(Date.now()), 10);
  result.writeBigInt64LE(process.hrtime.bigint(), 18);
  Buffer.from(macAddress).copy(result, 26, 0, 6);
  result[32] = 0;
  return result;
}

export function encodeGameLogin({ accountId, token, macAddress, platform = 1 }) {
  const mods = [
    ['BPRE', 0, 0],
    ['BPEE', 0, 0],
    ['IPKE', 0, 1],
    ['IRBO', 0, 1],
  ];
  const environment = [
    [5, os.arch()],
    [4, os.release()],
    [3, 'Linux'],
  ];
  const chunks = [Buffer.from([0]), int32(accountId), Buffer.from([token.length]), Buffer.from(token)];
  chunks.push(Buffer.from(macAddress).subarray(0, 6));
  chunks.push(int32(CLIENT_REVISION), int32(CLIENT_REVISION));
  chunks.push(Buffer.from([0]), uint16(96), uint16(0), Buffer.from([31, mods.length]));
  for (const [name, type, enabled] of mods) chunks.push(utf16z(name), Buffer.from([type, enabled]));
  chunks.push(Buffer.from([environment.length]));
  for (const [key, value] of environment) chunks.push(Buffer.from([key]), utf16z(value));
  chunks.push(Buffer.from([platform, 0, 1, 0]), Buffer.alloc(32));
  return Buffer.concat(chunks);
}

export function deriveMacAddress(deviceId) {
  const mac = Buffer.from(deviceId).subarray(0, 6);
  mac[0] = (mac[0] | 0x02) & 0xfe;
  return mac;
}

export function encodeCharacterSelection(characterId, proof) {
  const payload = Buffer.alloc(16);
  payload.writeBigUInt64LE(BigInt.asUintN(64, BigInt(characterId)), 0);
  payload.writeBigUInt64LE(BigInt.asUintN(64, BigInt(proof)), 8);
  return payload;
}

export function parseCharacterNames(payload) {
  const names = [];
  for (let offset = 0; offset + 3 < payload.length; offset += 1) {
    let cursor = offset;
    let value = '';
    while (cursor + 1 < payload.length) {
      const code = payload.readUInt16LE(cursor);
      if (code === 0) break;
      if (code < 32 || code > 126) { value = ''; break; }
      value += String.fromCharCode(code);
      cursor += 2;
    }
    if (value.length >= 3 && payload.readUInt16LE(cursor) === 0) names.push(value);
  }
  return [...new Set(names)];
}

export function utf16z(value) {
  return Buffer.concat([Buffer.from(String(value), 'utf16le'), Buffer.alloc(2)]);
}

function int32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32LE(Number(value));
  return buffer;
}

function uint16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(Number(value));
  return buffer;
}

function formatAddressBytes(bytes) {
  if (bytes.length === 4) return [...bytes].join('.');
  return bytes.toString('hex');
}

class PacketReader {
  constructor(buffer) { this.buffer = Buffer.from(buffer); this.offset = 0; }
  ensure(length) { if (this.offset + length > this.buffer.length) throw new Error('Protocol packet ended unexpectedly'); }
  u8() { this.ensure(1); return this.buffer[this.offset++]; }
  u16() { this.ensure(2); const value = this.buffer.readUInt16LE(this.offset); this.offset += 2; return value; }
  u64() { this.ensure(8); const value = this.buffer.readBigUInt64LE(this.offset); this.offset += 8; return value; }
  i32() { this.ensure(4); const value = this.buffer.readInt32LE(this.offset); this.offset += 4; return value; }
  bytes(length) { this.ensure(length); const value = Buffer.from(this.buffer.subarray(this.offset, this.offset + length)); this.offset += length; return value; }
  utf16z() {
    let value = '';
    for (;;) {
      const code = this.u16();
      if (code === 0) return value;
      value += String.fromCharCode(code);
    }
  }
  address() {
    const family = this.u8();
    if (family === 4) {
      const bytes = this.bytes(4);
      return { family, host: [...bytes].reverse().join('.') };
    }
    if (family === 6) {
      const bytes = this.bytes(16);
      const groups = [];
      for (let offset = 0; offset < 16; offset += 2) groups.push(bytes.readUInt16LE(offset).toString(16));
      return { family, host: groups.join(':') };
    }
    throw new Error(`Unknown address family: ${family}`);
  }
  rest() { return this.bytes(this.buffer.length - this.offset); }
}
