import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BATTLE_ACTION,
  decodeBattleCommand,
  encodeFleeCommand,
  encodeItemCommand,
  encodeMoveCommand,
  encodePokeBallCommand,
  encodeSwitchCommand,
  packBattleActor,
  unpackBattleActor,
} from '../src/headless/battle-packets.js';

test('encodes the reverse-engineered move command schema', () => {
  const actor = packBattleActor(2, 1);
  const encoded = encodeMoveCommand({ actor, moveId: 52, target: 3 });
  assert.deepEqual(encoded, Buffer.from('1200340003', 'hex'));
  assert.deepEqual(decodeBattleCommand(encoded), {
    action: BATTLE_ACTION.MOVE,
    actor,
    moveId: 52,
    target: 3,
  });
  assert.deepEqual(unpackBattleActor(actor), { position: 2, activeSlot: 1 });
});

test('encodes the accepted official-client Poke Ball fixture', () => {
  assert.deepEqual(encodePokeBallCommand(), Buffer.from('00018c130000000000000000ff', 'hex'));
});

test('round trips item, switch, and flee commands', () => {
  const item = encodeItemCommand({ actor: 0, itemId: 4, targetEntityId: 0x0102030405060708n, target: 1 });
  assert.deepEqual(decodeBattleCommand(item), {
    action: BATTLE_ACTION.ITEM,
    actor: 0,
    itemId: 4,
    targetEntityId: 0x0102030405060708n,
    target: 1,
  });
  assert.deepEqual(decodeBattleCommand(encodeSwitchCommand({ actor: 0, partySlot: 3 })), {
    action: BATTLE_ACTION.SWITCH,
    actor: 0,
    partySlot: 3,
  });
  assert.deepEqual(decodeBattleCommand(encodeFleeCommand({ actor: 0 })), {
    action: BATTLE_ACTION.FLEE,
    actor: 0,
  });
});
