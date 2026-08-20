import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWorldProof, encodeWorldReady, parseWorldJoinToken } from '../src/headless/official-headless-session.js';

test('reproduces the recorded post-character world proof', () => {
  const packet252 = Buffer.from('10311a44fdf5e666fc4d052d3a2a7e2fbd010004880db4b906010093c8a06e022aad45c4ece6b80000641e0a', 'hex');
  const token = parseWorldJoinToken(packet252);
  assert.equal(encodeWorldProof(1902562831166377984n, token).toString('hex'), '00908892d042671a10311a44fdf5e666fc4d052d3a2a7e2fbd');
  assert.equal(encodeWorldReady().toString('hex'), '006000feff00');
});
