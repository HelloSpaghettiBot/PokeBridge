import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { BATTLE_ACTION, decodeBattleCommand } from '../src/headless/battle-packets.js';
import { OfficialBotController } from '../src/headless/official-bot-controller.js';
import { HeadlessState } from '../src/headless/headless-state.js';

class FakeSession extends EventEmitter {
  constructor() {
    super();
    this.phase = 'world';
    this.world = { player: { id: 'self', map: '0:3:19', x: 15, y: 9, direction: 2 } };
    this.sent = [];
    this.moves = [];
  }

  sendMovement(payload, expectedPayload = payload) {
    this.moves.push(Buffer.from(payload));
    if (expectedPayload === null) return Promise.resolve({ position: this.world.player });
    const expected = Buffer.from(expectedPayload);
    this.world.player = { ...this.world.player, x: expected.readUInt16LE(0), y: expected.readUInt16LE(2), direction: expected[4] & 3 };
    return Promise.resolve({ position: this.world.player });
  }

  primeMovement(payload) { this.sent.push({ opcode: 6, payload: Buffer.from(payload) }); return Promise.resolve(); }

  sendPacket(opcode, payload) { this.sent.push({ opcode, payload: Buffer.from(payload ?? []) }); }
}

function encounterPayload() {
  const bytes = Buffer.alloc(96);
  writePokemon(bytes, 8, 4, 39, [10, 108, 33, 52]);
  writePokemon(bytes, 56, 16, 4, []);
  return bytes;
}

function encounterPayloadWithParty() {
  const bytes = Buffer.alloc(136);
  writePokemon(bytes, 8, 4, 15, [10, 108, 33, 52]);
  writePokemon(bytes, 48, 16, 5, [33, 45, 28, 16]);
  writePokemon(bytes, 96, 163, 5, []);
  return bytes;
}

function writePokemon(bytes, offset, speciesId, level, moves) {
  bytes[offset] = 0;
  bytes[offset + 1] = 0xc0;
  bytes[offset + 7] = 0x1a;
  bytes.writeUInt16LE(speciesId, offset + 8);
  bytes[offset + 10] = level;
  bytes.writeUInt16LE(20, offset + 17);
  bytes.writeUInt16LE(20, offset + 19);
  moves.forEach((move, index) => bytes.writeUInt16LE(move, offset + 29 + index * 2));
}

function resolvedMovePayload(encounter, remainingHp) {
  const bytes = Buffer.alloc(27);
  encounter.copy(bytes, 0, 8, 16);
  bytes.writeUInt16LE(10, 8);
  bytes[11] = 1;
  bytes[12] = 1;
  encounter.copy(bytes, 13, 56, 64);
  bytes.writeUInt16LE(remainingHp, 25);
  return bytes;
}

test('start produces the official intent and one current-tile movement frame', async t => {
  const session = new FakeSession();
  const state = new HeadlessState();
  const controller = new OfficialBotController({
    session,
    state,
    graph: { maps: { '0:3:19:291': { name: 'Route 1', visited: [] } } },
    timing: { nextDelay: () => 10000, nextIntentDelay: () => 0 },
  });
  t.after(() => controller.close());
  controller.start({ mode: 'explore' });
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(session.moves.length, 1);
  assert.deepEqual(session.sent[0], { opcode: 7, payload: Buffer.from([2]) });
  assert.deepEqual(session.moves[0], Buffer.from('0f00090002', 'hex'));
  assert.equal(state.value.activity.running, true);
  assert.equal(state.value.activity.lastCommand.startsWith('move:'), true);
});

test('a known map-boundary warp sends the boundary tile without creating a negative coordinate', async t => {
  const session = new FakeSession();
  session.world.player = { id: 'self', map: 'town', x: 12, y: 0, direction: 1 };
  const state = new HeadlessState();
  const controller = new OfficialBotController({
    session,
    state,
    graph: {
      maps: { town: { name: 'Town', visited: ['12,0'] }, route: { name: 'Route', visited: ['12,39'] } },
      edges: { 'town@12,0': [{ to: 'route@12,39', direction: 1, type: 'warp' }] },
      blocked: ['town@12,0:0', 'town@12,0:2', 'town@12,0:3'],
    },
    timing: { nextDelay: () => 10000, nextIntentDelay: () => 0 },
  });
  t.after(() => controller.close());
  controller.start({ mode: 'explore' });
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.deepEqual(session.moves[0], Buffer.from('0c00000001', 'hex'));
  assert.equal(state.value.activity.running, true);
});

test('a resolved turn allows the same damaging move to be reused', async t => {
  const session = new FakeSession();
  const state = new HeadlessState();
  const controller = new OfficialBotController({ session, state });
  t.after(() => controller.close());
  controller.start({ mode: 'train' });
  session.emit('packet', { opcode: 48, payload: encounterPayload() });
  session.emit('packet', { opcode: 50, payload: Buffer.from([0]) });
  session.emit('packet', { opcode: 51, payload: Buffer.from([1]) });
  session.emit('packet', { opcode: 50, payload: Buffer.from([0]) });
  const commands = session.sent.map(value => decodeBattleCommand(value.payload));
  assert.deepEqual(commands.map(value => value.moveId), [10, 10]);
});

test('a repeated unresolved turn falls back from a rejected or empty-PP move', async t => {
  const session = new FakeSession();
  const state = new HeadlessState();
  const controller = new OfficialBotController({ session, state });
  t.after(() => controller.close());
  controller.start({ mode: 'train' });
  session.emit('packet', { opcode: 48, payload: encounterPayload() });
  session.emit('packet', { opcode: 50, payload: Buffer.from([0]) });
  session.emit('packet', { opcode: 50, payload: Buffer.from([0]) });
  const commands = session.sent.map(value => decodeBattleCommand(value.payload));
  assert.deepEqual(commands.map(value => value.moveId), [10, 33]);
});

test('empty-PP rejection remains remembered across encounters until healing', async t => {
  const session = new FakeSession();
  const state = new HeadlessState();
  const controller = new OfficialBotController({ session, state });
  t.after(() => controller.close());
  controller.start({ mode: 'train' });
  session.emit('packet', { opcode: 48, payload: encounterPayload() });
  session.emit('packet', { opcode: 50, payload: Buffer.from([0]) });
  session.emit('packet', { opcode: 50, payload: Buffer.from([0]) });
  session.emit('packet', { opcode: 49, payload: Buffer.alloc(1) });
  session.emit('packet', { opcode: 48, payload: encounterPayload() });
  session.emit('packet', { opcode: 50, payload: Buffer.from([0]) });
  const commands = session.sent.map(value => decodeBattleCommand(value.payload)).filter(Boolean);
  assert.deepEqual(commands.map(value => value.moveId), [10, 33, 33]);
});

test('a forced battle turn immediately switches to a living party slot', async t => {
  const session = new FakeSession();
  const state = new HeadlessState();
  const controller = new OfficialBotController({ session, state });
  t.after(() => controller.close());
  controller.start({ mode: 'train' });
  session.emit('packet', { opcode: 48, payload: encounterPayloadWithParty() });
  session.emit('packet', { opcode: 50, payload: Buffer.from([0x80]) });
  const command = decodeBattleCommand(session.sent.at(-1).payload);
  assert.equal(command.action, BATTLE_ACTION.SWITCH);
  assert.equal(command.partySlot, 1);
  assert.equal(state.value.activity.lastCommand, 'forced_switch:1');
});

test('a hunted target is weakened before the ball targets the enemy entity', async t => {
  const session = new FakeSession();
  const state = new HeadlessState();
  state.patch({ inventory: { balls: 5 } });
  const controller = new OfficialBotController({ session, state, speciesNames: { 16: 'Pidgey' } });
  t.after(() => controller.close());
  controller.start({ mode: 'hunt', targetSpecies: 'Pidgey' });
  const encounter = encounterPayload();
  session.emit('packet', { opcode: 48, payload: encounter });
  session.emit('packet', { opcode: 50, payload: Buffer.from([0]) });
  session.emit('packet', { opcode: 51, payload: resolvedMovePayload(encounter, 5) });
  session.emit('packet', { opcode: 50, payload: Buffer.from([0]) });
  const commands = session.sent.map(value => decodeBattleCommand(value.payload));
  assert.equal(commands[0].moveId, 10);
  assert.equal(commands[1].itemId, 5004);
  assert.notEqual(commands[1].targetEntityId, 0n);
});
