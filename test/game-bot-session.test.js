import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { GameBotSession } from '../src/headless/game-bot-session.js';

class FakeTransport extends EventEmitter {
  sent = [];
  sendPacket(opcode, payload) {
    this.sent.push({ opcode, payload: Buffer.from(payload) });
  }
}

test('runs a verified search, battle move, end ack, and resumed search', async (context) => {
  const transport = new FakeTransport();
  const session = new GameBotSession({
    transport,
    position: { x: 14, y: 9 },
    moveIds: [52],
    stepIntervalMs: 0,
    worldReadyDelayMs: 1,
    loop: { searchSteps: 1, maxBattles: 2 },
  });
  context.after(() => session.close());

  session.start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(`${transport.sent[0].opcode}:${transport.sent[0].payload.toString('hex')}`, '6:0d00090002');

  transport.emit('packet', { opcode: 48, payload: Buffer.alloc(1) });
  transport.emit('packet', { opcode: 50, payload: Buffer.from([0]) });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(transport.sent.at(-1).opcode, 50);
  assert.equal(transport.sent.at(-1).payload.toString('hex'), '0000340000');

  transport.emit('packet', { opcode: 49, payload: Buffer.alloc(1) });
  assert.equal(transport.sent.at(-1).opcode, 51);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(transport.sent.at(-1).opcode, 6);
  assert.equal(session.loop.getStatus().battlesCompleted, 1);
});
