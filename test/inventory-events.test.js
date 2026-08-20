import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeInventoryUpdate } from '../src/headless/inventory-events.js';

test('decodes the recorded five Poke Ball inventory update', () => {
  assert.deepEqual(decodeInventoryUpdate(66, Buffer.from('0100005088f632ebbb1a8c13050001', 'hex')), {
    type: 'inventory_updated', entityId: '005088f632ebbb1a', itemId: 5004, quantity: 5, pocket: 1,
  });
});
