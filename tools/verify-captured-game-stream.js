import fs from 'node:fs';
import { PersistentPacketInflater } from '../src/headless/game-transport.js';
import { parseCharacterNames } from '../src/headless/official-protocol.js';

const records = fs.readFileSync('captures/decrypted-gameplay-session2.jsonl', 'utf8')
  .split(/\r?\n/)
  .map(line => { try { return JSON.parse(line); } catch { return null; } })
  .filter(record => record?.type === 'plain_packet'
    && record.protocolClass === 'f.hU'
    && record.direction === 'server_to_client');
const inflater = new PersistentPacketInflater();
try {
  for (const record of records) {
    const frame = Buffer.from(record.dataHex, 'hex');
    if (frame[3] !== 1) continue;
    const payload = await inflater.inflate(frame.subarray(4));
    if (record.opcode === 2) {
      console.log(JSON.stringify({ opcode: 2, length: payload.length, names: parseCharacterNames(payload) }));
      break;
    }
  }
} finally {
  inflater.close();
}
