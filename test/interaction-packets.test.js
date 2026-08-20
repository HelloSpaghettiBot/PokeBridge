import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeDialogueResponse, encodeNpcInteraction } from '../src/headless/interaction-packets.js';

test('reproduces both recorded native NPC interaction proofs', () => {
  assert.equal(encodeNpcInteraction('00e008b9d1eabb1a').toString('hex'), '00e008b9d1eabb1a232028790ac12c54');
  assert.equal(encodeNpcInteraction('00e0889ee9eabb1a').toString('hex'), '00e0889ee9eabb1a399f17af331ec89a');
});

test('encodes the recorded nurse dialogue choices', () => {
  assert.equal(encodeDialogueResponse(0, 1).toString('hex'), '0001');
  assert.equal(encodeDialogueResponse(3, 0).toString('hex'), '0300');
});
