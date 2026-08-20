import test from 'node:test';
import assert from 'node:assert/strict';
import { OfficialWorldState } from '../src/headless/official-world-state.js';

const CHARACTER_ID = 1902562831166377984n;
const INITIAL_SPAWN = Buffer.from('00908892d042671a00015c0326000a00030c03140004008c440065006c00740072006f006e0000000003130f00090002000000040400', 'hex');
const INTERIOR_SPAWN = Buffer.from('00908892d042671a00015c0326000a00030c03140004008c440065006c00740072006f006e00000000040004000800f6010000040400', 'hex');

test('decodes authoritative player spawn and map transition from recorded packets', () => {
  const world = new OfficialWorldState({ characterName: 'Deltron', characterId: CHARACTER_ID });
  const initial = world.consume(5, INITIAL_SPAWN);
  assert.equal(initial.type, 'mapChanged');
  assert.deepEqual(pick(world.player), { map: '0:3:19', x: 15, y: 9, direction: 0 });

  const transition = world.consume(5, INTERIOR_SPAWN);
  assert.equal(transition.type, 'mapChanged');
  assert.deepEqual(pick(world.player), { map: '0:4:0', x: 4, y: 8, direction: 1 });
});

test('server correction wins over a pending outbound move', async () => {
  const world = new OfficialWorldState({ characterName: 'Deltron', characterId: CHARACTER_ID, moveCommitMs: 1000 });
  world.consume(5, INITIAL_SPAWN);
  const result = world.observeOutbound(6, Buffer.from('0600070001', 'hex'));
  world.consume(17, Buffer.from('00908892d042671a000300060008000201', 'hex'));
  assert.deepEqual(await result, { status: 'corrected', position: world.player });
  assert.deepEqual(pick(world.player), { map: '0:3:0', x: 6, y: 8, direction: 2 });
});

test('a same-tile primer can be acknowledged separately from the target step', async () => {
  const state = new OfficialWorldState({ characterName: 'Deltron', characterId: CHARACTER_ID, moveCommitMs: 50 });
  state.consume(5, INITIAL_SPAWN);
  const acknowledged = state.waitForAuthoritativePlayerUpdate(100);
  state.consume(17, Buffer.from('00908892d042671a0003130f0009000201', 'hex'));
  const result = await acknowledged;
  assert.equal(result.position.x, 15);
  assert.equal(result.event.type, 'playerCorrected');
  state.close();
});

test('commits an outbound move only after the correction window', async () => {
  const world = new OfficialWorldState({ characterName: 'Deltron', characterId: CHARACTER_ID, moveCommitMs: 5 });
  world.consume(5, INITIAL_SPAWN);
  const result = await world.observeOutbound(6, Buffer.from('0d00070000', 'hex'));
  assert.equal(result.status, 'accepted');
  assert.deepEqual(pick(world.player), { map: '0:3:19', x: 13, y: 7, direction: 0 });
});

test('decodes nearby NPC world entities from the recorded packet schema', () => {
  const world = new OfficialWorldState({ characterId: 1n });
  const payload = Buffer.from('01e0c8626ee1bb1a001300020501030003131300100002020800', 'hex');
  const event = world.consume(18, payload);
  assert.equal(event.entity.kind, 'npc');
  assert.deepEqual({ map: event.entity.map, x: event.entity.x, y: event.entity.y, direction: event.entity.direction }, {
    map: '0:3:19', x: 19, y: 16, direction: 2,
  });
});

function pick(player) {
  return { map: player.map, x: player.x, y: player.y, direction: player.direction };
}
