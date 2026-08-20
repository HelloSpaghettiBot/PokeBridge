import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLiveParty } from '../src/battle/live-party.js';

test('parses the official client live party snapshot and excludes empty-PP moves', () => {
  const party = parseLiveParty('PARTY members=0,4,16,27,39,10:29;225:3|1,16,5,19,19,33:35;45:0|2,19,4,16,16,33:0;98:30');
  assert.deepEqual(party, [
    { slot: 0, speciesId: 4, level: 16, hp: 27, maxHp: 39, moves: [10, 225], moveSlots: [10, 225], movePp: { 10: 29, 225: 3 } },
    { slot: 1, speciesId: 16, level: 5, hp: 19, maxHp: 19, moves: [33], moveSlots: [33, 45], movePp: { 33: 35, 45: 0 } },
    { slot: 2, speciesId: 19, level: 4, hp: 16, maxHp: 16, moves: [98], moveSlots: [33, 98], movePp: { 33: 0, 98: 30 } },
  ]);
});

test('preserves the client move-slot order even for numeric object keys', () => {
  const [pokemon] = parseLiveParty('PARTY members=0,4,17,43,43,10:35;225:20;33:35;52:25');
  assert.deepEqual(pokemon.moveSlots, [10, 225, 33, 52]);
  assert.deepEqual(pokemon.moves, [10, 225, 33, 52]);
});
