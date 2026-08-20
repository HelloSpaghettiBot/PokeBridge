import { tileKey } from './world-state.js';

const DELTAS = {
  0: { dx: 0, dy: 1 },
  1: { dx: 0, dy: -1 },
  2: { dx: -1, dy: 0 },
  3: { dx: 1, dy: 0 },
};

function followsDirection(before, direction, after) {
  const delta = DELTAS[direction];
  if (!delta) return false;
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  const distance = Math.abs(dx) + Math.abs(dy);
  return distance > 0 && dx === delta.dx * distance && dy === delta.dy * distance;
}

export class WorldGraph {
  constructor(serialized = {}) {
    this.maps = new Map(Object.entries(serialized.maps ?? {}));
    this.edges = new Map(Object.entries(serialized.edges ?? {}));
    this.blocked = new Set(serialized.blocked ?? []);
    this.#normalizeLongEdges();
  }

  observe(position) {
    const existing = this.maps.get(position.map) ?? { name: position.name, visited: [] };
    existing.name ||= position.name;
    const key = `${position.x},${position.y}`;
    if (!existing.visited.includes(key)) existing.visited.push(key);
    this.maps.set(position.map, existing);
  }

  observeMapGrid(snapshot) {
    if (!snapshot?.map || !Array.isArray(snapshot.tiles)) throw new Error('Invalid client map snapshot');
    const existing = this.maps.get(snapshot.map) ?? { name: snapshot.name, visited: [] };
    existing.name ||= snapshot.name;
    existing.width = snapshot.width;
    existing.height = snapshot.height;
    existing.authoritative = true;
    existing.tiles = snapshot.tiles.map(tile => [tile.x, tile.y, tile.z, tile.terrainId, tile.behaviorId, tile.passMask,
      (tile.grass ? 1 : 0) | (tile.invalid ? 2 : 0), tile.kind ?? '']);
    existing.grass = snapshot.tiles.filter(tile => tile.grass).map(tile => `${tile.x},${tile.y}`);
    existing.portals = snapshot.tiles.filter(tile => tile.kind === 'Xi1').map(tile => `${tile.x},${tile.y}`);
    existing.exits = snapshot.tiles.filter(tile => tile.kind === 'M10').map(tile => `${tile.x},${tile.y}`);
    existing.staticBlocked = snapshot.tiles.flatMap(tile => Object.keys(DELTAS)
      .map(Number)
      .filter(direction => !(tile.passMask & (1 << direction)))
      .map(direction => `${tile.x},${tile.y}:${direction}`));
    this.maps.set(snapshot.map, existing);

    const tiles = new Map(snapshot.tiles.map(tile => [`${tile.x},${tile.y}`, tile]));
    for (const tile of snapshot.tiles) {
      const fromPosition = { map: snapshot.map, x: tile.x, y: tile.y };
      const from = tileKey(fromPosition);
      for (const [directionText, delta] of Object.entries(DELTAS)) {
        const direction = Number(directionText);
        const target = tiles.get(`${tile.x + delta.dx},${tile.y + delta.dy}`);
        if (!(tile.passMask & (1 << direction)) || !target) {
          continue;
        }
        // A client map snapshot is the authoritative static collision source.
        // Remove probe-time blocks caused by dialogue overlays or transient
        // players/NPCs so they do not permanently poison future routing.
        this.blocked.delete(`${from}:${direction}`);
        this.#addEdge(from, tileKey({ map: snapshot.map, x: target.x, y: target.y }), { direction, type: 'map' });
      }
    }
    return { map: snapshot.map, width: snapshot.width, height: snapshot.height, tiles: snapshot.tiles.length, grass: existing.grass.length };
  }

  observeStep(before, direction, after) {
    this.observe(before);
    this.observe(after);
    const from = tileKey(before);
    const to = tileKey(after);
    if (from === to) {
      this.blocked.add(`${from}:${direction}`);
      return { type: 'blocked', from, direction };
    }
    if (before.map === after.map && !followsDirection(before, direction, after)) {
      // WORLD can update just after a movement command returns. Do not teach
      // the router a diagonal, backwards, or sideways edge from that race.
      return { type: 'desync', from, to, direction };
    }
    this.blocked.delete(`${from}:${direction}`);
    const distance = Math.abs(after.x - before.x) + Math.abs(after.y - before.y);
    const type = before.map !== after.map ? 'warp' : distance === 1 ? 'walk' : 'jump';
    this.#addEdge(from, to, { direction, type });
    if (type === 'walk') this.#addEdge(to, from, { direction: direction ^ 1, type });
    return { type, from, to, direction };
  }

  hasObservedDirection(position, direction) {
    const from = tileKey(position);
    const map = this.maps.get(position.map);
    if (map?.authoritative && map.tiles?.some(tile => tile[0] === position.x && tile[1] === position.y)) return true;
    return this.blocked.has(`${from}:${direction}`)
      || (this.edges.get(from) ?? []).some(edge => edge.direction === direction);
  }

  expected(position, direction) {
    const delta = DELTAS[direction];
    if (!delta) throw new Error(`Unknown direction ${direction}`);
    return { ...position, x: position.x + delta.dx, y: position.y + delta.dy, direction };
  }

  route(start, destination) {
    const startKey = tileKey(start);
    const targetKey = tileKey(destination);
    const queue = [startKey];
    const previous = new Map([[startKey, null]]);
    while (queue.length) {
      const current = queue.shift();
      if (current === targetKey) break;
      for (const edge of this.edges.get(current) ?? []) {
        if (this.blocked.has(`${current}:${edge.direction}`)) continue;
        if (previous.has(edge.to)) continue;
        previous.set(edge.to, { from: current, edge });
        queue.push(edge.to);
      }
    }
    if (!previous.has(targetKey)) return null;
    const route = [];
    for (let cursor = targetKey; cursor !== startKey;) {
      const step = previous.get(cursor);
      route.push({ from: step.from, to: cursor, ...step.edge });
      cursor = step.from;
    }
    return route.reverse();
  }

  toJSON() {
    return {
      maps: Object.fromEntries(this.maps),
      edges: Object.fromEntries(this.edges),
      blocked: [...this.blocked],
    };
  }

  #addEdge(from, to, details) {
    const list = this.edges.get(from) ?? [];
    if (!list.some(edge => edge.to === to && edge.type === details.type)) {
      list.push({ to, ...details });
      this.edges.set(from, list);
    }
  }

  #normalizeLongEdges() {
    const normalized = new Map();
    const seenLongPairs = new Set();
    for (const [from, edges] of this.edges) {
      const output = [];
      for (const edge of edges) {
        const [fromMap, fromCoordinate] = from.split('@');
        const [toMap, toCoordinate] = edge.to.split('@');
        if (fromMap !== toMap) { output.push(edge); continue; }
        const [fromX, fromY] = fromCoordinate.split(',').map(Number);
        const [toX, toY] = toCoordinate.split(',').map(Number);
        if (!followsDirection(
          { x: fromX, y: fromY },
          edge.direction,
          { x: toX, y: toY },
        )) continue;
        if (edge.type !== 'walk') { output.push(edge); continue; }
        if (Math.abs(toX - fromX) + Math.abs(toY - fromY) <= 1) { output.push(edge); continue; }
        const pair = [from, edge.to].sort().join('<>');
        if (seenLongPairs.has(pair)) continue;
        seenLongPairs.add(pair);
        output.push({ ...edge, type: 'jump' });
      }
      if (output.length) normalized.set(from, output);
    }
    this.edges = normalized;
  }
}
