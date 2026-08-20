import { tileKey } from '../navigation/world-state.js';

const VERIFIED_SEED = {
  '0:5:4:303': {
    map: '0:5:4:303', name: 'Viridian City Pokemon Center', healTile: { x: 7, y: 5, direction: 1 },
    exitTile: { x: 7, y: 8, direction: 0 },
    status: 'verified', evidence: 'recorded_heal',
  },
  '0:6:5:303': {
    map: '0:6:5:303', name: 'Pewter City Pokemon Center', healTile: { x: 7, y: 5, direction: 1 },
    exitTile: { x: 7, y: 8, direction: 0 },
    status: 'verified', evidence: 'client_map_and_shared_center_layout',
  },
};

export class CenterRegistry {
  constructor(serialized = {}) {
    this.centers = structuredClone(VERIFIED_SEED);
    for (const [map, saved] of Object.entries(serialized.centers ?? {})) {
      this.centers[map] = { ...(this.centers[map] ?? {}), ...saved };
    }
  }

  observe(graph, position) {
    const parts = position.map.split(':').map(Number);
    const map = graph.maps.get(position.map);
    if (!map || parts.length !== 4) return null;
    const existing = this.centers[position.map];
    if (existing?.status === 'verified') return existing;

    // Kanto's shared indoor group contains Pokemon Centers. The nurse counter
    // layout is confirmed by a reachable (7,5) interaction tile blocked north.
    const groupCandidate = parts[0] === 0 && parts[1] === 5;
    const hasNurseTile = map.visited?.includes('7,5') && graph.blocked.has(`${position.map}@7,5:1`);
    if (!groupCandidate && !hasNurseTile) return null;
    const center = {
      map: position.map,
      name: `${String(map.name ?? position.name).replaceAll('_', ' ')} Pokemon Center`,
      healTile: { x: 7, y: 5, direction: 1 },
      exitTile: { x: 7, y: 8, direction: 0 },
      status: hasNurseTile ? 'verified' : 'candidate',
      evidence: hasNurseTile ? 'nurse_counter_layout' : 'pokemon_center_indoor_group',
      discoveredAt: existing?.discoveredAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.centers[position.map] = center;
    return center;
  }

  nearestVerified(graph, current) {
    let best = null;
    for (const center of Object.values(this.centers)) {
      if (center.status !== 'verified' || !graph.maps.has(center.map)) continue;
      const destination = { map: center.map, name: center.name, ...center.healTile };
      const route = graph.route(current, destination);
      if (route && (!best || route.length < best.route.length)) best = { center, destination, route };
    }
    if (best) return best;
    return null;
  }

  leaveRoute(graph, current) {
    const center = this.centers[current.map];
    if (!center) return null;
    let best = null;
    for (const [from, edges] of graph.edges) {
      if (!from.startsWith(`${current.map}@`)) continue;
      const coordinate = from.slice(from.lastIndexOf('@') + 1);
      const [x, y] = coordinate.split(',').map(Number);
      for (const edge of edges) {
        if (edge.type !== 'warp' || edge.to.startsWith(`${current.map}@`)) continue;
        const destination = { map: current.map, name: center.name, x, y, direction: edge.direction };
        const route = graph.route(current, destination);
        if (!route) continue;
        if (!best || route.length < best.route.length) best = { center, destination, route, exitEdge: edge };
      }
    }
    if (best) return best;
    const exitTile = center.exitTile;
    if (!exitTile) return null;
    const destination = { map: current.map, name: center.name, ...exitTile };
    const route = graph.route(current, destination);
    return route ? { center, destination, route, exitEdge: { direction: exitTile.direction, type: 'layout_exit' } } : null;
  }

  toJSON() {
    return { version: 1, updatedAt: new Date().toISOString(), centers: this.centers };
  }
}
