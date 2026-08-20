export const INVENTORY_UPDATE_OPCODE = 66;
export const POKE_BALL_ITEM_ID = 5004;

export function decodeInventoryUpdate(opcode, payload) {
  if (opcode !== INVENTORY_UPDATE_OPCODE) return null;
  const bytes = Buffer.from(payload);
  if (bytes.length < 15) throw new Error('Inventory update is too short');
  const flags = bytes[1];
  let offset = 2;
  const entityId = bytes.subarray(offset, offset + 8).toString('hex');
  offset += 8;
  if (flags & 1) offset += 8;
  if (offset + 5 > bytes.length) throw new Error('Inventory update flags exceed packet length');
  const itemId = bytes.readUInt16LE(offset);
  const quantity = bytes.readUInt16LE(offset + 2);
  const pocket = bytes[offset + 4];
  return { type: 'inventory_updated', entityId, itemId, quantity, pocket };
}
