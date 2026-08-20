import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeKeepaliveResponse } from '../src/headless/official-headless-session.js';

test('echoes the exact official-client game keepalive payload', () => {
  const serverPayload = Buffer.from('0180c60d869f010000', 'hex');
  assert.equal(encodeKeepaliveResponse(serverPayload).toString('hex'), '0180c60d869f010000');
});

test('rejects malformed game keepalive payloads', () => {
  assert.throws(() => encodeKeepaliveResponse(Buffer.from('0180', 'hex')), /Invalid game keepalive/);
});
