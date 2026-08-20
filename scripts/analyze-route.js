import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const input = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3] ?? input.replace(/\.jsonl$/i, '.summary.json'));
const records = (await readFile(input, 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);
const movements = records.filter(record => record.classification === 'movement');
const segments = [];
let current = [];
let previous = null;

for (const record of movements) {
  let split = false;
  if (previous) {
    const gapMs = Date.parse(record.packet.timestamp) - Date.parse(previous.packet.timestamp);
    const dx = Math.abs(record.movement.x - previous.movement.x);
    const dy = Math.abs(record.movement.y - previous.movement.y);
    split = gapMs > 2000 || dx > 2 || dy > 2;
  }
  if (split && current.length) {
    segments.push(current);
    current = [];
  }
  current.push(record);
  previous = record;
}
if (current.length) segments.push(current);

const clientActions = records.filter(record =>
  record.packet?.direction === 'client_to_server' && ![0, 5, 6, 7, 32, 194].includes(record.packet.opcode));

const summary = {
  input,
  recordedAt: records[0]?.recordedAt,
  start: records.find(record => record.classification === 'route_start')?.initialPosition ?? null,
  totals: {
    packets: records.length,
    movementPackets: movements.length,
    segments: segments.length,
    clientActions: clientActions.length,
    encounters: records.filter(record => record.classification === 'unexpected_encounter').length,
  },
  segments: segments.map((segment, index) => ({
    index,
    count: segment.length,
    startedAt: segment[0].packet.timestamp,
    endedAt: segment.at(-1).packet.timestamp,
    from: { x: segment[0].movement.x, y: segment[0].movement.y },
    to: { x: segment.at(-1).movement.x, y: segment.at(-1).movement.y },
    directions: segment.map(record => record.movement.direction),
    coordinates: segment.map(record => ({ x: record.movement.x, y: record.movement.y })),
  })),
  clientActions: clientActions.map(record => ({
    sequence: record.sequence,
    timestamp: record.packet.timestamp,
    opcode: record.packet.opcode,
    dataHex: record.packet.dataHex,
    kind: record.packet.opcode === 34 ? 'npc_interaction' :
      record.packet.opcode === 33 ? 'dialogue_response' :
      record.packet.opcode === 50 ? 'battle_action' :
      record.packet.opcode === 51 ? 'battle_end_ack' : 'unknown',
  })),
};

await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${output}\n`);
