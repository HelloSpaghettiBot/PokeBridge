import assert from 'node:assert/strict';
import test from 'node:test';
import { GameCommandEncoder } from '../src/headless/game-command-encoder.js';

test('turns loop commands into verified movement and Ember packets', () => {
  const encoder = new GameCommandEncoder({ position: { x: 14, y: 9 }, moveIds: [52] });
  const movement = encoder.encode({ type: 'move', direction: 'left', steps: 2 });
  assert.deepEqual(movement.map(({ opcode, payload }) => `${opcode}:${payload.toString('hex')}`), [
    '6:0d00090002',
    '6:0c00090002',
  ]);
  const battle = encoder.encode({ type: 'battle_move', slot: 0 });
  assert.equal(battle[0].opcode, 50);
  assert.equal(battle[0].payload.toString('hex'), '0000340000');
});
