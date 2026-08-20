import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GAME_MOVEMENT_OPCODE,
  MovementSequencer,
  decodeMovement,
  encodeMovement,
  encodeMovementIntent,
} from '../src/headless/movement-packets.js';

test('decodes the live Route 1 movement fixtures', () => {
  const firstFrame = Buffer.from('0800060d00090002', 'hex');
  const secondFrame = Buffer.from('0800060c00090002', 'hex');
  assert.equal(firstFrame[2], GAME_MOVEMENT_OPCODE);
  assert.deepEqual(decodeMovement(firstFrame.subarray(3)), {
    x: 13, y: 9, direction: 2, directionName: 'left', running: false, secondary: false,
  });
  assert.deepEqual(decodeMovement(secondFrame.subarray(3)), {
    x: 12, y: 9, direction: 2, directionName: 'left', running: false, secondary: false,
  });
});

test('reproduces the official movement-intent packet sent before walking', () => {
  assert.equal(encodeMovementIntent(2).toString('hex'), '02');
});

test('encodes movement flags and sequences absolute positions', () => {
  assert.equal(encodeMovement({ x: 13, y: 9, direction: 'left' }).toString('hex'), '0d00090002');
  assert.equal(encodeMovement({ x: 13, y: 9, direction: 'right', running: true }).toString('hex'), '0d00090083');
  const sequencer = new MovementSequencer({ x: 14, y: 9 });
  assert.deepEqual(
    sequencer.createSteps('left', 2).map((packet) => packet.toString('hex')),
    ['0d00090002', '0c00090002'],
  );
});
