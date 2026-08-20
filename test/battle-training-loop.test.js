import assert from 'node:assert/strict';
import test from 'node:test';
import { BattleTrainingLoop } from '../src/headless/battle-training-loop.js';

test('searches, battles repeatedly, and resumes after battle end', () => {
  const commands = [];
  const loop = new BattleTrainingLoop({
    send: (command) => commands.push(command),
    searchPattern: ['left', 'right'],
    searchSteps: 3,
    moveSlot: 2,
    maxBattles: 2,
  });

  loop.start();
  loop.handle({ type: 'movement_complete' });
  loop.handle({ type: 'encounter_started' });
  loop.handle({ type: 'battle_turn_ready', health: 20, maxHealth: 25 });
  loop.handle({ type: 'battle_turn_resolved' });
  loop.handle({ type: 'battle_turn_ready', health: 18, maxHealth: 25 });
  loop.handle({ type: 'battle_ended' });
  loop.handle({ type: 'world_ready' });

  assert.deepEqual(commands, [
    { type: 'move', direction: 'left', steps: 3 },
    { type: 'move', direction: 'right', steps: 3 },
    { type: 'battle_move', slot: 2 },
    { type: 'battle_move', slot: 2 },
    { type: 'move', direction: 'left', steps: 3 },
  ]);
  assert.equal(loop.getStatus().battlesCompleted, 1);
});

test('stops at low health and does not send a move', () => {
  const commands = [];
  const loop = new BattleTrainingLoop({
    send: (command) => commands.push(command),
    minHealthRatio: 0.3,
  });

  loop.start();
  loop.handle({ type: 'encounter_started' });
  loop.handle({ type: 'battle_turn_ready', health: 5, maxHealth: 25 });

  assert.deepEqual(commands.at(-1), { type: 'stop', reason: 'low_health' });
  assert.equal(commands.some((command) => command.type === 'battle_move'), false);
  assert.deepEqual(loop.getStatus(), {
    state: 'stopped',
    battlesCompleted: 0,
    stopReason: 'low_health',
  });
});

test('stops after the configured battle count', () => {
  const commands = [];
  const loop = new BattleTrainingLoop({ send: (command) => commands.push(command), maxBattles: 1 });
  loop.start();
  loop.handle({ type: 'encounter_started' });
  loop.handle({ type: 'battle_ended' });
  loop.handle({ type: 'world_ready' });

  assert.equal(loop.getStatus().state, 'stopped');
  assert.deepEqual(commands.at(-1), { type: 'stop', reason: 'max_battles' });
});
