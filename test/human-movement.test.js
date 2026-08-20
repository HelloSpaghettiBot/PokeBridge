import assert from 'node:assert/strict';
import test from 'node:test';
import { HumanMovementTiming } from '../src/navigation/human-movement.js';

test('varies walk cadence and adds a turn delay', () => {
  const values = [0, 0.25, 0.75, 0.5];
  const timing = new HumanMovementTiming({ random: () => values.shift() ?? 0.5, pauseEveryMin: 99, pauseEveryMax: 99 });
  const straight = timing.nextDelay({ advanced: true });
  const turn = timing.nextDelay({ directionChanged: true, advanced: false });
  assert.ok(straight >= 230 && straight <= 270);
  assert.ok(turn > straight + 50);
});

test('occasionally inserts a bounded short pause', () => {
  const timing = new HumanMovementTiming({ random: () => 0.5, cadenceJitterMs: 0, pauseEveryMin: 2, pauseEveryMax: 2, pauseMinMs: 200, pauseMaxMs: 200 });
  assert.equal(timing.nextDelay({ advanced: true }), 250);
  assert.equal(timing.nextDelay({ advanced: true }), 450);
  assert.equal(timing.nextDelay({ advanced: true }), 250);
});
