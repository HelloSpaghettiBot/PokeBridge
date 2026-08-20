export const BATTLE_SERVER_OPCODE = Object.freeze({
  ENCOUNTER_STARTED: 48,
  BATTLE_ENDED: 49,
  TURN_READY: 50,
  EVENT_BATCH: 51,
  TURN_SEQUENCE: 196,
});

export function decodeBattleServerPacket(opcode, payload) {
  const bytes = Buffer.from(payload);
  if (opcode === BATTLE_SERVER_OPCODE.ENCOUNTER_STARTED) {
    const pokemon = extractBattlePokemon(bytes);
    return {
      type: 'encounter_started',
      snapshot: bytes,
      party: pokemon.slice(0, -1),
      enemy: pokemon.at(-1) ?? null,
      trainerBattle: detectTrainerBattle(bytes),
    };
  }
  if (opcode === BATTLE_SERVER_OPCODE.BATTLE_ENDED) {
    return { type: 'battle_ended', summary: bytes };
  }
  if (opcode === BATTLE_SERVER_OPCODE.TURN_READY) {
    if (bytes.length < 1) throw new Error('Turn-ready payload is empty');
    return {
      type: 'battle_turn_ready',
      actor: bytes[0] & 0x7f,
      forced: (bytes[0] & 0x80) !== 0,
    };
  }
  if (opcode === BATTLE_SERVER_OPCODE.EVENT_BATCH) {
    return { type: 'battle_turn_resolved', eventBatch: bytes, battleEnded: false, action: decodeResolvedAction(bytes) };
  }
  if (opcode === BATTLE_SERVER_OPCODE.TURN_SEQUENCE) {
    if (bytes.length < 2) throw new Error('Turn-sequence payload is too short');
    return { type: 'battle_turn_sequence', sequence: bytes.readUInt16LE(0) };
  }
  return null;
}

export function decodeResolvedAction(payload) {
  const bytes = Buffer.from(payload);
  if (bytes.length < 27) return null;
  const moveId = bytes.readUInt16LE(8);
  const defenderOffset = [12, 13, 14, 15, 16].find(offset => looksLikeBattleEntity(bytes, offset));
  if (!looksLikeBattleEntity(bytes, 0) || defenderOffset === undefined || moveId < 1) return null;
  return {
    attackerEntityId: bytes.subarray(0, 8).toString('hex'),
    moveId,
    defenderEntityId: bytes.subarray(defenderOffset, defenderOffset + 8).toString('hex'),
    remainingHp: bytes.length === 27 ? bytes.readUInt16LE(25) : null,
  };
}

export function extractBattlePokemon(payload) {
  const bytes = Buffer.from(payload);
  const pokemon = [];
  for (let offset = 0; offset + 21 <= bytes.length; offset += 1) {
    const speciesId = bytes.readUInt16LE(offset + 8);
    const level = bytes[offset + 10];
    const looksLikePokemonId = looksLikeBattleEntity(bytes, offset);
    if (!looksLikePokemonId || speciesId < 1 || speciesId > 1500 || level < 1 || level > 100) continue;
    pokemon.push({
      entityId: bytes.subarray(offset, offset + 8).toString('hex'),
      speciesId,
      level,
      hp: bytes.readUInt16LE(offset + 17),
      maxHp: bytes.readUInt16LE(offset + 19),
      abilityId: offset + 37 <= bytes.length ? bytes.readUInt16LE(offset + 27) : null,
      moves: offset + 37 <= bytes.length
        ? [29, 31, 33, 35].map(relative => bytes.readUInt16LE(offset + relative)).filter(Boolean)
        : [],
      shiny: null,
      secretShiny: null,
      ivs: null,
    });
  }
  if (pokemon.length) {
    pokemon.at(-1).abilityId = null;
    pokemon.at(-1).moves = [];
  }
  return pokemon;
}

function looksLikeBattleEntity(bytes, offset) {
  return offset + 8 <= bytes.length
    && bytes[offset] === 0
    && (bytes[offset + 1] & 0xc0) === 0xc0
    && bytes[offset + 7] === 0x1a;
}

function detectTrainerBattle(bytes) {
  let strings = 0;
  for (let offset = 0; offset + 5 < Math.min(bytes.length, 128); offset += 1) {
    let cursor = offset;
    let characters = 0;
    while (cursor + 1 < bytes.length && bytes[cursor] >= 32 && bytes[cursor] <= 126 && bytes[cursor + 1] === 0) {
      characters += 1;
      cursor += 2;
    }
    if (characters >= 3 && cursor + 1 < bytes.length && bytes[cursor] === 0 && bytes[cursor + 1] === 0) {
      strings += 1;
      offset = cursor + 1;
    }
  }
  return strings > 1;
}
