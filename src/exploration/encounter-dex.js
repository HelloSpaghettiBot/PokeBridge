function fields(text) {
  return Object.fromEntries(String(text).trim().split(/\s+/).map(part => {
    const separator = part.indexOf('=');
    return separator < 0 ? [part, true] : [part.slice(0, separator), part.slice(separator + 1)];
  }));
}

export function parseEnemyIdentity(text) {
  const value = fields(text);
  if (value.ENEMY !== true && !String(text).startsWith('ENEMY ')) return null;
  const speciesId = Number(value.speciesId);
  const level = Number(value.level);
  if (!Number.isInteger(speciesId) || !Number.isInteger(level)) return null;
  return {
    speciesId,
    species: String(value.species ?? `Species_${speciesId}`).replaceAll('_', ' '),
    level,
    hp: Number(value.hp),
    maxHp: Number(value.maxHp),
    shiny: String(value.shiny).toLowerCase() === 'true',
    secretShiny: String(value.secretShiny).toLowerCase() === 'true',
  };
}

function wilson(successes, trials, z = 1.96) {
  if (!trials) return { low: 0, high: 1 };
  const proportion = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const center = (proportion + (z * z) / (2 * trials)) / denominator;
  const margin = z * Math.sqrt((proportion * (1 - proportion) + (z * z) / (4 * trials)) / trials) / denominator;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

export class EncounterDex {
  constructor(serialized = {}) {
    this.version = 1;
    this.createdAt = serialized.createdAt ?? new Date().toISOString();
    this.maps = serialized.maps ?? {};
    this.clientLocations = serialized.clientLocations ?? {};
  }

  observeStep(position) {
    const area = this.#area(position);
    area.walkSteps += 1;
    area.lastSeenAt = new Date().toISOString();
  }

  observeTerrain(position, telemetry) {
    if (!telemetry?.signature) return null;
    const area = this.#area(position);
    const coordinate = `${position.x},${position.y}`;
    const existing = area.terrainTiles[coordinate] ?? { observations: 0 };
    area.terrainTiles[coordinate] = {
      ...existing,
      signature: telemetry.signature,
      coordinateClass: telemetry.coordinateClass,
      terrainId: telemetry.terrainId,
      behaviorId: telemetry.behaviorId,
      observations: existing.observations + 1,
      lastSeenAt: new Date().toISOString(),
    };
    return area.terrainTiles[coordinate];
  }

  observeEncounter(position, identityText, method = 'Walk') {
    const identity = parseEnemyIdentity(identityText);
    if (!identity) return null;
    const area = this.#area(position);
    area.encounters += 1;
    area.lastSeenAt = new Date().toISOString();
    const speciesKey = String(identity.speciesId);
    const species = area.species[speciesKey] ?? {
      speciesId: identity.speciesId,
      name: identity.species,
      samples: 0,
      levelMin: identity.level,
      levelMax: identity.level,
      levels: {},
      methods: {},
      firstSeenAt: new Date().toISOString(),
    };
    species.samples += 1;
    species.levelMin = Math.min(species.levelMin, identity.level);
    species.levelMax = Math.max(species.levelMax, identity.level);
    species.levels[identity.level] = (species.levels[identity.level] ?? 0) + 1;
    species.methods[method] = (species.methods[method] ?? 0) + 1;
    species.lastSeenAt = new Date().toISOString();
    area.species[speciesKey] = species;
    const coordinate = `${position.x},${position.y}`;
    area.encounterTiles[coordinate] = (area.encounterTiles[coordinate] ?? 0) + 1;
    species.tiles ??= {};
    species.tiles[coordinate] = (species.tiles[coordinate] ?? 0) + 1;
    const terrain = area.terrainTiles[coordinate];
    if (terrain?.signature) {
      const signature = area.encounterTerrainSignatures[terrain.signature] ?? { encounters: 0 };
      signature.encounters += 1;
      signature.lastSeenAt = new Date().toISOString();
      area.encounterTerrainSignatures[terrain.signature] = signature;
    }
    return identity;
  }

  encounterTerrainTiles(mapKey) {
    const area = this.maps[mapKey];
    if (!area) return [];
    const signatures = new Set(Object.entries(area.encounterTerrainSignatures ?? {})
      .filter(([, evidence]) => Number(evidence?.encounters ?? 0) > 0)
      .map(([signature]) => signature));
    const result = new Set(Object.keys(area.encounterTiles ?? {}));
    for (const [coordinate, terrain] of Object.entries(area.terrainTiles ?? {})) {
      if (signatures.has(terrain?.signature)) result.add(coordinate);
    }
    return [...result];
  }

  mergeClientLocations(speciesId, payload) {
    if (!payload || !Array.isArray(payload.locations)) return;
    this.clientLocations[String(speciesId)] = {
      ...payload,
      speciesId: Number(speciesId),
      readAt: new Date().toISOString(),
    };
  }

  toJSON() {
    const maps = structuredClone(this.maps);
    for (const area of Object.values(maps)) {
      area.encounterRate = area.walkSteps ? area.encounters / area.walkSteps : 0;
      area.encounterRate95 = wilson(area.encounters, area.walkSteps);
      for (const species of Object.values(area.species)) {
        species.observedShare = area.encounters ? species.samples / area.encounters : 0;
        species.observedShare95 = wilson(species.samples, area.encounters);
      }
    }
    return {
      version: this.version,
      createdAt: this.createdAt,
      updatedAt: new Date().toISOString(),
      maps,
      clientLocations: this.clientLocations,
    };
  }

  #area(position) {
    const existing = this.maps[position.map] ?? {
      name: position.name,
      walkSteps: 0,
      encounters: 0,
      species: {},
      encounterTiles: {},
      terrainTiles: {},
      encounterTerrainSignatures: {},
      firstSeenAt: new Date().toISOString(),
    };
    existing.terrainTiles ??= {};
    existing.encounterTerrainSignatures ??= {};
    existing.name ||= position.name;
    this.maps[position.map] = existing;
    return existing;
  }
}
