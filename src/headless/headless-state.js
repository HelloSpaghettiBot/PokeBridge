import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';

export class HeadlessState extends EventEmitter {
  constructor() {
    super();
    this.value = {
      version: 1,
      updatedAt: new Date().toISOString(),
      connection: { state: 'offline', detail: 'Service started' },
      login: { state: 'signed_out', username: null, mfaRequired: false },
      activity: { running: false, mode: 'explore', targetSpecies: '', levelMin: 1, levelMax: 100 },
      player: { map: null, mapName: null, x: null, y: null, direction: null, money: null },
      inventory: { balls: null, items: {} },
      nearby: { players: [], trainers: [], npcs: [] },
      battle: null,
      survey: { maps: 0, tiles: 0, encounters: 0, speciesIndexed: 0, pokemonCenters: 0, centers: [] },
      map: { visited: [], blocked: [], edges: [] },
      protocol: { packetCounts: {} },
    };
  }

  patch(partial) {
    this.value = merge(this.value, partial);
    this.value.updatedAt = new Date().toISOString();
    this.emit('change', this.snapshot());
  }

  snapshot() { return structuredClone(this.value); }
}

export async function loadSurveySnapshot(paths) {
  const [status, graph, centers, species] = await Promise.all([
    json(paths.status, {}), json(paths.graph, {}), json(paths.centers, {}), json(paths.species, {}),
  ]);
  const world = status.world ?? {};
  const currentMap = graph.maps?.[world.map] ?? {};
  return {
    activity: { ...(status.activity ?? {}), running: Boolean(status.running) },
    player: { map: world.map ?? null, mapName: world.name ?? null, x: world.x ?? null, y: world.y ?? null, direction: world.direction ?? null },
    battle: status.enemy ? { enemy: status.enemy, phase: status.phase } : null,
    survey: {
      maps: status.totals?.maps ?? Object.keys(graph.maps ?? {}).length,
      tiles: status.totals?.tiles ?? 0,
      encounters: status.totals?.encounters ?? 0,
      speciesIndexed: Object.keys(species.species ?? {}).length,
      pokemonCenters: Object.keys(centers.centers ?? {}).length,
      centers: Object.values(centers.centers ?? {}),
    },
    map: {
      visited: currentMap.visited ?? [],
      blocked: (graph.blocked ?? []).filter(value => value.startsWith(`${world.map}@`)),
      edges: Object.entries(graph.edges ?? {}).filter(([from]) => from.startsWith(`${world.map}@`)).flatMap(([from, edges]) => edges.map(edge => ({ from, ...edge }))),
    },
  };
}

async function json(path, fallback) { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; } }
function merge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const output = { ...base };
  for (const [key, value] of Object.entries(patch)) output[key] = value && typeof value === 'object' && !Array.isArray(value) ? merge(base?.[key] ?? {}, value) : value;
  return output;
}
