import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeBattleServerPacket, decodeResolvedAction, extractBattlePokemon } from '../src/headless/battle-events.js';

test('classifies the live encounter and turn-ready packets', () => {
  const encounter = Buffer.from('1f0030011aa4d1c47880e3e64b60340933403b30fc0cfc8868828ba2461300', 'hex');
  const ready = Buffer.from('0500320080', 'hex');
  assert.equal(decodeBattleServerPacket(encounter[2], encounter.subarray(3)).type, 'encounter_started');
  assert.deepEqual(decodeBattleServerPacket(ready[2], ready.subarray(3, 4)), {
    type: 'battle_turn_ready', actor: 0, forced: false,
  });
});

test('classifies turn event batches and sequence counters', () => {
  assert.equal(decodeBattleServerPacket(51, Buffer.alloc(28)).type, 'battle_turn_resolved');
  assert.deepEqual(decodeBattleServerPacket(196, Buffer.from('0200', 'hex')), {
    type: 'battle_turn_sequence', sequence: 2,
  });
});

test('classifies the live battle-ended packet', () => {
  const ended = Buffer.from('130031000001ff01ff00000000000000000200', 'hex');
  assert.equal(decodeBattleServerPacket(ended[2], ended.subarray(3)).type, 'battle_ended');
});

test('extracts party and enemy state from a recorded wild encounter', () => {
  const payload = Buffer.from('02000000000000000000000000ff000000000016000000ff00200006440065006c00740072006f006e0000000000908892d042671aff00015c0326000a00030c03140004008c0000000000010300000100c048ad2943671a04000c00000000000014002100000000ff030142000a00e1002100340000010100c0482706f5bb1a10000500000100000006001300000000ff0301330021002d001c00100000020100c0884e5ff6bb1a13000400000100000003001000000000ff03013e00210027006200000001000004000c00000000000003ff000000006666666601060000000000010100000100c00804bcfabb1a10000400000100000011001100000000ff030001000010000400000000010003ff000000006666666600000000', 'hex');
  const pokemon = extractBattlePokemon(payload);
  assert.equal(pokemon.length, 4);
  assert.deepEqual(pokemon[0].moves, [10, 225, 33, 52]);
  assert.deepEqual(pokemon.at(-1), {
    entityId: '00c00804bcfabb1a', speciesId: 16, level: 4, hp: 17, maxHp: 17,
    abilityId: null, moves: [], shiny: null, secretShiny: null, ivs: null,
  });
  const event = decodeBattleServerPacket(48, payload);
  assert.equal(event.trainerBattle, false);
  assert.equal(event.enemy.speciesId, 16);
});

test('decodes authoritative remaining HP from a recorded resolved move', () => {
  const payload = Buffer.from('00c008d9e9e1bb1a2100010100c048ad2943671a02020100001100', 'hex');
  assert.deepEqual(decodeResolvedAction(payload), {
    attackerEntityId: '00c008d9e9e1bb1a',
    moveId: 33,
    defenderEntityId: '00c048ad2943671a',
    remainingHp: 17,
  });
});
