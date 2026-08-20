export const NPC_INTERACTION_OPCODE = 34;
export const DIALOGUE_RESPONSE_OPCODE = 33;

const MASK_64 = 0xffffffffffffffffn;
const SIP_KEY_0 = 0xc9d5f2fdd0b2a270n;
const SIP_KEY_1 = 0x6926c24541885700n;

export function encodeNpcInteraction(entityId) {
  const id = typeof entityId === 'string' ? Buffer.from(entityId, 'hex') : Buffer.from(entityId);
  if (id.length !== 8) throw new TypeError('NPC entity id must contain eight bytes');
  const value = id.readBigUInt64LE();
  const javaHashCode = Number((value ^ (value >> 32n)) & 0xffffffffn);
  const message = Buffer.allocUnsafe(4);
  message.writeUInt32LE(javaHashCode);
  const payload = Buffer.allocUnsafe(16);
  id.copy(payload);
  payload.writeBigUInt64LE(sipHash24(message, SIP_KEY_0, SIP_KEY_1), 8);
  return payload;
}

export function encodeDialogueResponse(sequence, choice = 0) {
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 255) throw new TypeError('dialogue sequence must be a byte');
  if (!Number.isInteger(choice) || choice < 0 || choice > 255) throw new TypeError('dialogue choice must be a byte');
  return Buffer.from([sequence, choice]);
}

export function sipHash24(message, key0 = SIP_KEY_0, key1 = SIP_KEY_1) {
  const bytes = Buffer.from(message);
  let v0 = 0x736f6d6570736575n ^ key0;
  let v1 = 0x646f72616e646f6dn ^ key1;
  let v2 = 0x6c7967656e657261n ^ key0;
  let v3 = 0x7465646279746573n ^ key1;
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    const block = bytes.readBigUInt64LE(offset);
    v3 ^= block;
    [v0, v1, v2, v3] = rounds(v0, v1, v2, v3, 2);
    v0 ^= block;
    offset += 8;
  }
  let final = BigInt(bytes.length) << 56n;
  for (let index = 0; offset + index < bytes.length; index += 1) final |= BigInt(bytes[offset + index]) << BigInt(index * 8);
  v3 ^= final;
  [v0, v1, v2, v3] = rounds(v0, v1, v2, v3, 2);
  v0 ^= final;
  v2 ^= 0xffn;
  [v0, v1, v2, v3] = rounds(v0, v1, v2, v3, 4);
  return (v0 ^ v1 ^ v2 ^ v3) & MASK_64;
}

function rounds(v0, v1, v2, v3, count) {
  for (let index = 0; index < count; index += 1) {
    v0 = add(v0, v1); v1 = rotate(v1, 13) ^ v0; v0 = rotate(v0, 32);
    v2 = add(v2, v3); v3 = rotate(v3, 16) ^ v2;
    v0 = add(v0, v3); v3 = rotate(v3, 21) ^ v0;
    v2 = add(v2, v1); v1 = rotate(v1, 17) ^ v2; v2 = rotate(v2, 32);
  }
  return [v0, v1, v2, v3];
}

function add(left, right) { return (left + right) & MASK_64; }
function rotate(value, count) { const bits = BigInt(count); return ((value << bits) | (value >> (64n - bits))) & MASK_64; }
