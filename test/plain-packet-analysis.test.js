import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseJavapOpcodeMap,
  parsePlainPacketJsonl,
  summarizePlainPackets,
} from '../src/headless/plain-packet-analysis.js';

test('maps javap class entries to integer opcodes', () => {
  const map = parseJavapOpcodeMap(`
    10: ldc #45 // class f/kX0
    12: iconst_1
    13: invokestatic #47
    20: ldc #49 // class f/li1
    22: sipush 194
    25: invokestatic #47
  `);
  assert.equal(map.get(1), 'f.kX0');
  assert.equal(map.get(194), 'f.li1');
});

test('excludes known heartbeats and keeps action candidates', () => {
  const records = parsePlainPacketJsonl([
    JSON.stringify({ type: 'attached', value: 'f.hU' }),
    JSON.stringify({ type: 'plain_packet', timestamp: '2026-01-01T00:00:00Z', direction: 'client_to_server', opcode: 194, length: 12, dataHex: '00' }),
    JSON.stringify({ type: 'plain_packet', timestamp: '2026-01-01T00:00:01Z', direction: 'client_to_server', opcode: 73, length: 7, dataHex: '01' }),
  ].join('\n'));
  const summary = summarizePlainPackets(records, { opcodeMap: new Map([[73, 'f.zx']]) });
  assert.equal(summary.totalPackets, 2);
  assert.equal(summary.actionCandidates.length, 1);
  assert.equal(summary.actionCandidates[0].className, 'f.zx');
});
