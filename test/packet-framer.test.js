import assert from 'node:assert/strict';
import test from 'node:test';
import { LengthPrefixedPacketFramer, hasMatchingLengthPrefix } from '../src/headless/packet-framer.js';

test('reassembles length-prefixed frames split across TCP chunks', () => {
  const framer = new LengthPrefixedPacketFramer();
  const first = Buffer.from('0500aabbcc', 'hex');
  const second = Buffer.from('060001020304', 'hex');

  assert.deepEqual(framer.push(first.subarray(0, 3)), []);
  assert.deepEqual(framer.push(Buffer.concat([first.subarray(3), second.subarray(0, 2)])), [first]);
  assert.deepEqual(framer.push(second.subarray(2)), [second]);
  assert.equal(framer.getPendingBytes().length, 0);
});

test('extracts multiple frames from one TCP chunk', () => {
  const framer = new LengthPrefixedPacketFramer();
  const first = Buffer.from('0200', 'hex');
  const second = Buffer.from('0400aabb', 'hex');
  assert.deepEqual(framer.push(Buffer.concat([first, second])), [first, second]);
});

test('rejects invalid frame lengths and detects exact records', () => {
  const framer = new LengthPrefixedPacketFramer({ maxFrameLength: 32 });
  assert.throws(() => framer.push(Buffer.from('0100', 'hex')), /Invalid frame length/);
  assert.equal(hasMatchingLengthPrefix(Buffer.from('0500aabbcc', 'hex')), true);
  assert.equal(hasMatchingLengthPrefix(Buffer.from('0600aabbcc', 'hex')), false);
});
