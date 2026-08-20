import assert from 'node:assert/strict';
import { constants, createDeflateRaw } from 'node:zlib';
import test from 'node:test';
import { PersistentPacketInflater } from '../src/headless/game-transport.js';

test('inflates consecutive fragments from the persistent game stream', async () => {
  const deflater = createDeflateRaw();
  const inflater = new PersistentPacketInflater();
  try {
    const first = await compressFragment(deflater, Buffer.from('first world packet'));
    const second = await compressFragment(deflater, Buffer.from('second battle packet'));
    assert.equal((await inflater.inflate(first)).toString(), 'first world packet');
    assert.equal((await inflater.inflate(second)).toString(), 'second battle packet');
  } finally {
    deflater.destroy();
    inflater.close();
  }
});

function compressFragment(stream, input) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const onData = chunk => chunks.push(Buffer.from(chunk));
    stream.on('data', onData);
    stream.write(input, error => {
      if (error) return reject(error);
      stream.flush(constants.Z_SYNC_FLUSH, flushError => {
        stream.off('data', onData);
        if (flushError) return reject(flushError);
        const wire = Buffer.concat(chunks);
        assert.deepEqual(wire.subarray(-4), Buffer.from([0, 0, 0xff, 0xff]));
        resolve(wire.subarray(0, -4));
      });
    });
  });
}
