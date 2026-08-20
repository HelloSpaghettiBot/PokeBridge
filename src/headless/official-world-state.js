import { EventEmitter } from 'node:events';
import { decodeMovement, GAME_MOVEMENT_OPCODE } from './movement-packets.js';

const SERVER = Object.freeze({
  ENTITY_SPAWN: 5,
  NPC_SPAWN: 18,
  ENTITY_REMOVE: 13,
  ENTITY_FACING: 15,
  POSITION_CORRECTION: 17,
  ENTITY_MOVEMENT: 234,
});

export class OfficialWorldState extends EventEmitter {
  constructor(options = {}) {
    super();
    this.characterName = String(options.characterName ?? '');
    this.characterId = BigInt(options.characterId ?? 0);
    this.characterIdBytes = Buffer.alloc(8);
    this.characterIdBytes.writeBigUInt64LE(BigInt.asUintN(64, this.characterId));
    this.moveCommitMs = Number(options.moveCommitMs ?? 120);
    this.entities = new Map();
    this.player = null;
    this.pendingMove = null;
  }

  consume(opcode, payload) {
    const bytes = Buffer.from(payload);
    let event = null;
    if (opcode === SERVER.ENTITY_SPAWN) event = this.#spawn(bytes);
    else if (opcode === SERVER.NPC_SPAWN) event = this.#npc(bytes);
    else if (opcode === SERVER.ENTITY_REMOVE) event = this.#remove(bytes);
    else if (opcode === SERVER.ENTITY_FACING) event = this.#facing(bytes);
    else if (opcode === SERVER.POSITION_CORRECTION) event = this.#correction(bytes);
    else if (opcode === SERVER.ENTITY_MOVEMENT) event = this.#movement(bytes);
    if (event) this.emit(event.type, event);
    return event;
  }

  observeOutbound(opcode, payload) {
    if (opcode !== GAME_MOVEMENT_OPCODE) return null;
    const movement = decodeMovement(payload);
    this.#settlePending({ status: 'superseded', position: this.player });
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const timer = setTimeout(() => {
      const previous = this.player;
      this.player = { ...previous, ...movement, map: previous?.map ?? null };
      this.#settlePending({ status: 'accepted', position: this.player });
      this.emit('playerMoved', { type: 'playerMoved', source: 'accepted_outbound', previous, player: this.player });
    }, this.moveCommitMs);
    this.pendingMove = { movement, resolve, promise, timer };
    return promise;
  }

  snapshot() {
    return {
      player: this.player ? { ...this.player } : null,
      entities: [...this.entities.values()].map(entity => ({ ...entity })),
    };
  }

  waitForAuthoritativePlayerUpdate(timeoutMs = 650) {
    return new Promise(resolve => {
      let timer;
      const finish = event => {
        clearTimeout(timer);
        this.off('playerCorrected', finish);
        this.off('mapChanged', finish);
        this.off('playerState', finish);
        resolve({ event: event ?? null, position: this.player ? { ...this.player } : null });
      };
      this.once('playerCorrected', finish);
      this.once('mapChanged', finish);
      this.once('playerState', finish);
      timer = setTimeout(() => finish(null), timeoutMs);
    });
  }

  seedPlayer(position) {
    if (this.player || !position) return this.player;
    const parts = String(position.map ?? '').split(':').map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some(value => !Number.isInteger(value))) return null;
    const player = {
      id: this.#ownId(),
      name: this.characterName,
      kind: 'player',
      mapRegion: parts[0],
      mapArea: parts[1],
      mapLayer: parts[2],
      map: parts.slice(0, 3).join(':'),
      x: Number(position.x),
      y: Number(position.y),
      direction: Number(position.direction ?? 0) & 3,
      movementMode: 0,
    };
    if (![player.x, player.y].every(Number.isInteger)) return null;
    this.player = player;
    this.entities.set(player.id, player);
    this.emit('playerState', { type: 'playerState', source: 'persisted_position', previous: null, player: { ...player } });
    return this.player;
  }

  reset() {
    this.#settlePending({ status: 'reset', position: this.player });
    this.entities.clear();
    this.player = null;
  }

  close() { this.reset(); }

  #spawn(bytes) {
    if (bytes.length < 25) return null;
    const id = entityId(bytes);
    const nameStart = 24;
    const nameEnd = findUtf16Terminator(bytes, nameStart);
    if (nameEnd < 0 || nameEnd + 10 > bytes.length) return null;
    const name = bytes.subarray(nameStart, nameEnd).toString('utf16le');
    const position = decodePosition(bytes, nameEnd + 2);
    if (!position) return null;
    const entity = { id, name, ...position, kind: id === this.#ownId() ? 'player' : 'player' };
    this.entities.set(id, entity);
    if (id === this.#ownId() || name === this.characterName) {
      const previous = this.player;
      this.#settlePending({ status: 'map_changed', position: entity });
      this.player = { ...entity };
      return { type: previous?.map !== entity.map ? 'mapChanged' : 'playerState', previous, player: this.player };
    }
    return { type: 'entitySpawned', entity };
  }

  #movement(bytes) {
    if (bytes.length !== 14) return null;
    const id = entityId(bytes);
    const entity = this.entities.get(id);
    if (!entity) return null;
    const previous = { ...entity };
    Object.assign(entity, {
      mapRegion: bytes.readInt8(8),
      mapArea: bytes.readInt8(9),
      x: bytes.readInt8(10),
      y: bytes.readInt8(11),
      movementMode: bytes.readInt8(12),
      direction: bytes[13] & 3,
    });
    entity.map = mapKey(entity);
    if (id === this.#ownId()) this.player = { ...entity };
    return { type: 'entityMoved', previous, entity: { ...entity } };
  }

  #npc(bytes) {
    if (bytes.length < 26) return null;
    const id = entityId(bytes);
    const position = decodePosition(bytes, 15);
    if (!position) return null;
    const flags = bytes.readUInt16LE(24);
    const trainer = (flags & 2) !== 0;
    const modelId = bytes.readUInt16LE(9);
    const entity = {
      id,
      name: `${trainer ? 'Trainer' : 'NPC'} #${modelId}`,
      modelId,
      kind: trainer ? 'trainer' : 'npc',
      interactive: true,
      flags,
      ...position,
    };
    this.entities.set(id, entity);
    return { type: 'entitySpawned', entity };
  }

  #facing(bytes) {
    if (bytes.length !== 9) return null;
    const id = entityId(bytes);
    const entity = this.entities.get(id);
    if (!entity) return null;
    entity.direction = bytes[8] & 3;
    if (id === this.#ownId()) this.player = { ...entity };
    return { type: 'entityFaced', entity: { ...entity } };
  }

  #correction(bytes) {
    if (bytes.length !== 17 || entityId(bytes) !== this.#ownId()) return null;
    const previous = this.player;
    const corrected = {
      ...(previous ?? {}),
      id: this.#ownId(),
      mapRegion: bytes.readInt8(8),
      mapArea: bytes.readInt8(9),
      mapLayer: bytes.readInt8(10),
      x: bytes.readInt16LE(11),
      y: bytes.readInt16LE(13),
      direction: bytes[15] & 3,
      map: `${bytes.readInt8(8)}:${bytes.readInt8(9)}:${bytes.readInt8(10)}`,
    };
    this.player = corrected;
    this.#settlePending({ status: 'corrected', position: corrected });
    return { type: 'playerCorrected', previous, player: corrected, reason: bytes[16], payloadHex: bytes.toString('hex') };
  }

  #remove(bytes) {
    if (bytes.length < 8) return null;
    const id = entityId(bytes);
    const entity = this.entities.get(id);
    this.entities.delete(id);
    return entity ? { type: 'entityRemoved', entity } : null;
  }

  #settlePending(result) {
    if (!this.pendingMove) return;
    clearTimeout(this.pendingMove.timer);
    this.pendingMove.resolve(result);
    this.pendingMove = null;
  }

  #ownId() { return this.characterIdBytes.toString('hex'); }
}

export function decodePosition(bytes, offset = 0) {
  if (offset + 9 > bytes.length) return null;
  const flags = bytes[offset + 8];
  const position = {
    mapRegion: bytes.readInt8(offset),
    mapArea: bytes.readInt8(offset + 1),
    mapLayer: bytes.readInt8(offset + 2),
    x: bytes.readInt16LE(offset + 3),
    y: bytes.readInt16LE(offset + 5),
    movementMode: bytes.readInt8(offset + 7),
    direction: flags & 3,
    running: (flags & 8) !== 0,
  };
  position.map = mapKey(position);
  return position;
}

function mapKey(position) {
  return `${position.mapRegion}:${position.mapArea}:${position.mapLayer ?? 0}`;
}

function entityId(bytes) { return bytes.subarray(0, 8).toString('hex'); }

function findUtf16Terminator(bytes, start) {
  for (let offset = start; offset + 1 < bytes.length; offset += 2) {
    if (bytes[offset] === 0 && bytes[offset + 1] === 0) return offset;
  }
  return -1;
}
