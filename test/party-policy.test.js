import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseBestMove, chooseCatchSlot, chooseTrainerSlot, chooseTrainingSlot, typeEffectiveness } from '../src/battle/party-policy.js';

test('calculates dual-type effectiveness', () => {
  assert.equal(typeEffectiveness('Fire', ['Grass', 'Steel']), 4);
  assert.equal(typeEffectiveness('Electric', ['Water', 'Ground']), 0);
});

test('auto training selects the lowest-level living non-lead slot', () => {
  const party = [{ level: 40, hp: 80, maxHp: 80 }, { level: 12, hp: 20, maxHp: 30 }, { level: 5, hp: 0, maxHp: 20 }];
  assert.equal(chooseTrainingSlot(party, 0, 0), 1);
  assert.equal(chooseTrainingSlot(party, 0, 2), 1);
  assert.equal(chooseTrainingSlot([{ level: 5, hp: 20, maxHp: 20 }, { level: 12, hp: 20, maxHp: 20 }], 0, 0), -1);
});

test('catching swaps away from an overleveled one-hit lead', () => {
  const enemy = { level: 7, types: ['Bug'] };
  const party = [
    { level: 40, hp: 90, maxHp: 90, types: ['Dragon'], moveDetails: [{ power: 60, type: 'Dragon' }] },
    { level: 8, hp: 25, maxHp: 25, types: ['Normal'], moveDetails: [{ power: 35, type: 'Normal' }] },
  ];
  assert.equal(chooseCatchSlot(party, 0, enemy), 1);
});

test('trainer switching prefers a healthy super-effective attacker', () => {
  const enemy = { types: ['Grass'] };
  const party = [
    { hp: 30, maxHp: 30, types: ['Water'], moveDetails: [{ power: 40, type: 'Water' }] },
    { hp: 25, maxHp: 30, types: ['Fire'], moveDetails: [{ power: 40, type: 'Fire' }] },
  ];
  assert.equal(chooseTrainerSlot(party, 0, enemy), 1);
});

test('trainer move selection accounts for resistance instead of raw power alone', () => {
  const member = {
    types: ['Fire'],
    movePp: { 163: 20, 225: 20 },
    moveDetails: [
      { id: 163, name: 'Slash', power: 70, type: 'Normal' },
      { id: 225, name: 'DragonBreath', power: 60, type: 'Dragon' },
    ],
  };
  assert.equal(chooseBestMove(member, { types: ['Rock', 'Ground'] }).id, 225);
});
