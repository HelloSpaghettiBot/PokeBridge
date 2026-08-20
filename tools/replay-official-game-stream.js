import fs from 'node:fs';
import { PersistentPacketInflater } from '../src/headless/game-transport.js';

const capturePath = process.argv[2] ?? 'captures/decrypted-gameplay-session2.jsonl';
const opcodeFilter = optionNumber('--opcode');
const from = optionValue('--from');
const to = optionValue('--to');
const contains = optionValue('--contains');
const records = fs.readFileSync(capturePath, 'utf8')
  .split(/\r?\n/)
  .map(line => { try { return JSON.parse(line); } catch { return null; } })
  .filter(record => record?.type === 'plain_packet' && record.protocolClass === 'f.hU');

const inflater = new PersistentPacketInflater();
const packets = [];
try {
  for (const record of records) {
    const frame = Buffer.from(record.dataHex, 'hex');
    if (record.direction === 'client_to_server') {
      packets.push(toPacket(record, frame.subarray(3)));
      continue;
    }
    if (frame.length < 4) continue;
    const flag = frame[3];
    if (flag === 0) packets.push(toPacket(record, frame.subarray(4)));
    else if (flag === 1) packets.push(toPacket(record, await inflater.inflate(frame.subarray(4))));
    else throw new Error(`Unknown compression flag ${flag} at ${record.timestamp}`);
  }
} finally {
  inflater.close();
}

const groups = new Map();
for (const packet of packets) {
  const key = `${packet.direction}:${packet.opcode}`;
  const group = groups.get(key) ?? {
    direction: packet.direction,
    opcode: packet.opcode,
    count: 0,
    minPayloadLength: Number.POSITIVE_INFINITY,
    maxPayloadLength: 0,
    firstTimestamp: packet.timestamp,
    lastTimestamp: packet.timestamp,
    samples: [],
  };
  group.count += 1;
  group.minPayloadLength = Math.min(group.minPayloadLength, packet.payloadLength);
  group.maxPayloadLength = Math.max(group.maxPayloadLength, packet.payloadLength);
  group.lastTimestamp = packet.timestamp;
  if (group.samples.length < 3 && !group.samples.includes(packet.payloadHex)) group.samples.push(packet.payloadHex);
  groups.set(key, group);
}

const summary = [...groups.values()].sort((a, b) =>
  a.direction.localeCompare(b.direction) || a.opcode - b.opcode);
if (opcodeFilter !== null || from || to || contains) {
  for (const packet of packets) {
    if (opcodeFilter !== null && packet.opcode !== opcodeFilter) continue;
    if (from && packet.timestamp < from) continue;
    if (to && packet.timestamp > to) continue;
    if (contains && !packet.payloadHex.includes(contains.toLowerCase())) continue;
    console.log(JSON.stringify(packet));
  }
} else {
  console.log(JSON.stringify({ packetCount: packets.length, summary }, null, 2));
}

function toPacket(record, payload) {
  return {
    timestamp: record.timestamp,
    direction: record.direction,
    opcode: record.opcode,
    payloadLength: payload.length,
    payloadHex: payload.toString('hex'),
  };
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

function optionNumber(name) {
  const value = optionValue(name);
  return value === null ? null : Number(value);
}
