export const GAME_MOVEMENT_OPCODE = 6;
export const GAME_MOVEMENT_INTENT_OPCODE = 7;

export const MOVEMENT_DIRECTION = Object.freeze({
  down: 0,
  up: 1,
  left: 2,
  right: 3,
});

const DIRECTION_MASK = 0x3f;
const SECONDARY_FLAG = 0x40;
const RUNNING_FLAG = 0x80;

export function encodeMovement({ x, y, direction, running = false, secondary = false }) {
  assertCoordinate(x, 'x');
  assertCoordinate(y, 'y');
  const directionValue = normalizeDirection(direction);
  let flags = directionValue;
  if (secondary) flags |= SECONDARY_FLAG;
  if (running) flags |= RUNNING_FLAG;

  const payload = Buffer.allocUnsafe(5);
  payload.writeUInt16LE(x, 0);
  payload.writeUInt16LE(y, 2);
  payload[4] = flags;
  return payload;
}

export function encodeMovementIntent(direction) {
  return Buffer.from([normalizeDirection(direction)]);
}

export function decodeMovement(payload) {
  const bytes = Buffer.from(payload);
  if (bytes.length !== 5) throw new Error(`Invalid movement payload length: ${bytes.length}`);
  const flags = bytes[4];
  const direction = flags & DIRECTION_MASK;
  return {
    x: bytes.readUInt16LE(0),
    y: bytes.readUInt16LE(2),
    direction,
    directionName: directionName(direction),
    running: (flags & RUNNING_FLAG) !== 0,
    secondary: (flags & SECONDARY_FLAG) !== 0,
  };
}

export function stepPosition(position, direction) {
  const directionValue = normalizeDirection(direction);
  const next = { x: position.x, y: position.y };
  if (directionValue === MOVEMENT_DIRECTION.down) next.y += 1;
  else if (directionValue === MOVEMENT_DIRECTION.up) next.y -= 1;
  else if (directionValue === MOVEMENT_DIRECTION.left) next.x -= 1;
  else if (directionValue === MOVEMENT_DIRECTION.right) next.x += 1;
  assertCoordinate(next.x, 'x');
  assertCoordinate(next.y, 'y');
  return next;
}

export class MovementSequencer {
  constructor(position) {
    this.setPosition(position);
  }

  setPosition(position) {
    assertCoordinate(position?.x, 'x');
    assertCoordinate(position?.y, 'y');
    this.position = { x: position.x, y: position.y };
  }

  createSteps(direction, count, options = {}) {
    if (!Number.isInteger(count) || count < 1) throw new TypeError('count must be a positive integer');
    const packets = [];
    for (let index = 0; index < count; index += 1) {
      this.position = stepPosition(this.position, direction);
      packets.push(encodeMovement({ ...this.position, direction, ...options }));
    }
    return packets;
  }
}

function normalizeDirection(direction) {
  const value = typeof direction === 'string' ? MOVEMENT_DIRECTION[direction.toLowerCase()] : direction;
  if (!Number.isInteger(value) || value < 0 || value > 3) {
    throw new TypeError('direction must be down, up, left, right, or a value from 0 through 3');
  }
  return value;
}

function directionName(value) {
  return Object.entries(MOVEMENT_DIRECTION).find(([, direction]) => direction === value)?.[0] ?? null;
}

function assertCoordinate(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new TypeError(`${label} must be an unsigned short`);
  }
}
