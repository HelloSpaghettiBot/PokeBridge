export const GAME_BATTLE_ACTION_OPCODE = 50;
export const GAME_BATTLE_END_ACK_OPCODE = 51;

export const BATTLE_ACTION = Object.freeze({
  MOVE: 0,
  ITEM: 1,
  SWITCH: 2,
  FLEE: 3,
});

export function packBattleActor(position, activeSlot) {
  assertNibble(position, 'position');
  assertNibble(activeSlot, 'activeSlot');
  return position | (activeSlot << 4);
}

export function unpackBattleActor(value) {
  assertByte(value, 'actor');
  return { position: value & 0x0f, activeSlot: (value >>> 4) & 0x0f };
}

export function encodeMoveCommand({ actor, moveId, target = 0 }) {
  assertByte(actor, 'actor');
  assertUnsignedShort(moveId, 'moveId');
  assertByte(target, 'target');
  const payload = Buffer.allocUnsafe(5);
  payload[0] = actor;
  payload[1] = BATTLE_ACTION.MOVE;
  payload.writeUInt16LE(moveId, 2);
  payload[4] = target;
  return payload;
}

export function encodeItemCommand({ actor, itemId, targetEntityId, target = 0 }) {
  assertByte(actor, 'actor');
  assertUnsignedShort(itemId, 'itemId');
  assertByte(target, 'target');
  const payload = Buffer.allocUnsafe(13);
  payload[0] = actor;
  payload[1] = BATTLE_ACTION.ITEM;
  payload.writeUInt16LE(itemId, 2);
  payload.writeBigUInt64LE(BigInt.asUintN(64, BigInt(targetEntityId)), 4);
  payload[12] = target;
  return payload;
}

export function encodePokeBallCommand({ actor = 0, itemId = 5004 } = {}) {
  return encodeItemCommand({ actor, itemId, targetEntityId: 0n, target: 0xff });
}

export function encodeSwitchCommand({ actor, partySlot }) {
  assertByte(actor, 'actor');
  assertUnsignedShort(partySlot, 'partySlot');
  const payload = Buffer.allocUnsafe(4);
  payload[0] = actor;
  payload[1] = BATTLE_ACTION.SWITCH;
  payload.writeUInt16LE(partySlot, 2);
  return payload;
}

export function encodeFleeCommand({ actor }) {
  assertByte(actor, 'actor');
  return Buffer.from([actor, BATTLE_ACTION.FLEE]);
}

export function encodeBattleEndAck() {
  return Buffer.alloc(0);
}

export function decodeBattleCommand(payload) {
  const bytes = Buffer.from(payload);
  if (bytes.length < 2) throw new Error('Battle command payload is too short');
  const actor = bytes[0];
  const action = bytes[1];
  if (action === BATTLE_ACTION.MOVE) {
    requireLength(bytes, 5, 'move');
    return { action, actor, moveId: bytes.readUInt16LE(2), target: bytes[4] };
  }
  if (action === BATTLE_ACTION.ITEM) {
    requireLength(bytes, 13, 'item');
    return {
      action,
      actor,
      itemId: bytes.readUInt16LE(2),
      targetEntityId: bytes.readBigUInt64LE(4),
      target: bytes[12],
    };
  }
  if (action === BATTLE_ACTION.SWITCH) {
    requireLength(bytes, 4, 'switch');
    return { action, actor, partySlot: bytes.readUInt16LE(2) };
  }
  if (action === BATTLE_ACTION.FLEE) {
    requireLength(bytes, 2, 'flee');
    return { action, actor };
  }
  return { action, actor, raw: Buffer.from(bytes.subarray(2)) };
}

function requireLength(buffer, expected, label) {
  if (buffer.length !== expected) throw new Error(`Invalid ${label} battle command length: ${buffer.length}`);
}

function assertByte(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new TypeError(`${label} must be an unsigned byte`);
}

function assertNibble(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0x0f) throw new TypeError(`${label} must be between 0 and 15`);
}

function assertUnsignedShort(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new TypeError(`${label} must be an unsigned short`);
}
