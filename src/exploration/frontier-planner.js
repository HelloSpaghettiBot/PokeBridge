import { tileKey } from '../navigation/world-state.js';

const DIRECTIONS = [0, 1, 2, 3];

function directionDelta(direction) {
  return direction === 0 ? { dx: 0, dy: 1 }
    : direction === 1 ? { dx: 0, dy: -1 }
      : direction === 2 ? { dx: -1, dy: 0 }
        : { dx: 1, dy: 0 };
}

function isPortalApproach(graph, key) {
  const at = key.lastIndexOf('@');
  if (at < 0) return false;
  const map = key.slice(0, at);
  const [x, y] = key.slice(at + 1).split(',').map(Number);
  const portals = graph.maps.get(map)?.portals;
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Array.isArray(portals)) return false;
  return portals.some(coordinate => {
    const [portalX, portalY] = coordinate.split(',').map(Number);
    return Number.isInteger(portalX) && Number.isInteger(portalY)
      && Math.abs(portalX - x) + Math.abs(portalY - y) <= 1;
  });
}

function directionOrder(currentDirection, random) {
  const perpendicular = currentDirection < 2 ? [2, 3] : [0, 1];
  if (random() >= 0.5) perpendicular.reverse();
  return [currentDirection, ...perpendicular, currentDirection ^ 1];
}

export function unexploredDirections(graph, position) {
  return DIRECTIONS.filter(direction => !graph.hasObservedDirection(position, direction));
}

export function planFrontier(graph, current, { random = Math.random, unavailableEdges = new Set() } = {}) {
  const local = new Set(unexploredDirections(graph, current));
  if (local.size) {
    const direction = directionOrder(current.direction, random).find(value => local.has(value));
    return { kind: 'probe', direction, target: tileKey(current), distance: 0 };
  }

  const start = tileKey(current);
  const queue = [start];
  const previous = new Map([[start, null]]);
  let target = null;
  while (queue.length) {
    const key = queue.shift();
    const [map, coordinate = ''] = key.split('@');
    const [x, y] = coordinate.split(',').map(Number);
    if (key !== start && unexploredDirections(graph, { map, x, y }).length) {
      target = key;
      break;
    }
    for (const edge of graph.edges.get(key) ?? []) {
      if (graph.blocked.has(`${key}:${edge.direction}`)) continue;
      if (unavailableEdges.has(`${key}>${edge.to}`)) continue;
      if (previous.has(edge.to)) continue;
      previous.set(edge.to, { from: key, edge });
      queue.push(edge.to);
    }
  }
  if (!target) return null;

  const route = [];
  for (let cursor = target; cursor !== start;) {
    const step = previous.get(cursor);
    route.push({ from: step.from, to: cursor, ...step.edge });
    cursor = step.from;
  }
  route.reverse();
  return { kind: 'route', direction: route[0].direction, target, distance: route.length, route };
}

export function planMappedSurvey(graph, current, { preferredDirection = null, unavailableEdges = new Set() } = {}) {
  const record = graph.maps.get(current.map);
  if (!record?.authoritative || !Array.isArray(record.tiles)) return null;
  const visited = new Set(record.visited ?? []);
  let best = null;
  for (const tile of record.tiles) {
    const [x, y] = tile;
    const coordinate = `${x},${y}`;
    if (visited.has(coordinate)) continue;
    const route = graph.route(current, { ...current, x, y });
    if (!route?.length || route.some(edge => unavailableEdges.has(`${edge.from}>${edge.to}`))) continue;
    const directional = preferredDirection === 1 ? y : preferredDirection === 0 ? -y : preferredDirection === 2 ? x : preferredDirection === 3 ? -x : 0;
    const score = directional * 100 + route.length;
    if (!best || score < best.score) best = { kind: 'route', direction: route[0].direction, target: `${current.map}@${coordinate}`, distance: route.length, route, score, source: 'client_map' };
  }
  return best;
}

export function planMappedPortal(graph, current, { unavailableEdges = new Set() } = {}) {
  const record = graph.maps.get(current.map);
  if (!record?.authoritative || !Array.isArray(record.portals)) return null;
  let best = null;
  for (const coordinate of record.portals) {
    const [portalX, portalY] = coordinate.split(',').map(Number);
    if (!Number.isInteger(portalX) || !Number.isInteger(portalY)) continue;
    const portalKey = `${current.map}@${coordinate}`;
    // The client's position can settle on either the transition tile or its
    // approach tile while a map change is reported. Treat both as the same
    // doorway so an already explored entrance is not selected forever.
    const testedSources = [portalKey, ...DIRECTIONS.map(direction => {
      const { dx, dy } = directionDelta(direction);
      return `${current.map}@${portalX - dx},${portalY - dy}`;
    })];
    if (testedSources.some(source => (graph.edges.get(source) ?? []).some(edge => edge.type === 'warp'))) continue;
    for (const direction of DIRECTIONS) {
      const delta = directionDelta(direction);
      const approach = { ...current, x: portalX - delta.dx, y: portalY - delta.dy };
      const approachKey = tileKey(approach);
      if (graph.blocked.has(`${approachKey}:${direction}`)) continue;
      if ((graph.edges.get(approachKey) ?? []).some(edge => edge.direction === direction && edge.type === 'warp')) continue;
      const route = graph.route(current, approach);
      if (!route) continue;
      if (route.some(edge => unavailableEdges.has(`${edge.from}>${edge.to}`))) continue;
      const plan = route.length
        ? { kind: 'route', direction: route[0].direction, target: approachKey, distance: route.length, route, source: 'client_portal', portal: coordinate }
        : { kind: 'probe', direction, target: approachKey, distance: 0, source: 'client_portal', portal: coordinate };
      const score = route.length;
      if (!best || score < best.score) best = { ...plan, score };
    }
  }
  return best;
}

export function planMappedExit(graph, current, { unavailableEdges = new Set(), allowGym = false } = {}) {
  const record = graph.maps.get(current.map);
  if (!record?.authoritative || (!allowGym && /\bgym\b/i.test(record.name ?? ''))) return null;
  // A warp by itself does not make a map an interior: outdoor city maps have
  // many building warps too. An incoming warp from a real client-map portal
  // identifies the entered map without relying on localized map names.
  const arrivals = [];
  for (const [from, edges] of graph.edges) for (const edge of edges) {
    if (edge.type !== 'warp' || !edge.to.startsWith(`${current.map}@`) || !isPortalApproach(graph, from)) continue;
    const [x, y] = edge.to.slice(edge.to.lastIndexOf('@') + 1).split(',').map(Number);
    if (Number.isInteger(x) && Number.isInteger(y)) arrivals.push({ ...current, x, y });
  }
  if (!arrivals.length) return null;
  let knownExit = null;
  for (const [from, edges] of graph.edges) {
    if (!from.startsWith(`${current.map}@`)) continue;
    for (const edge of edges) {
      if (edge.type !== 'warp') continue;
      const [x, y] = from.slice(from.lastIndexOf('@') + 1).split(',').map(Number);
      const route = graph.route(current, { ...current, x, y });
      if (!route || route.some(step => unavailableEdges.has(`${step.from}>${step.to}`))) continue;
      const fullRoute = [...route, { from, ...edge }];
      if (!knownExit || fullRoute.length < knownExit.route.length) knownExit = {
        kind: 'route', direction: fullRoute[0].direction, target: edge.to, distance: fullRoute.length,
        route: fullRoute, source: 'known_return_warp', score: fullRoute.length,
      };
    }
  }
  if (knownExit) return knownExit;
  let mappedExit = null;
  for (const coordinate of record.exits ?? []) {
    const [x, y] = coordinate.split(',').map(Number);
    if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
    const destination = { ...current, x, y };
    const route = graph.route(current, destination);
    if (!route || route.some(step => unavailableEdges.has(`${step.from}>${step.to}`))) continue;
    const directions = [
      { direction: 0, distance: Math.max(0, Number(record.height) - 1 - y) },
      { direction: 1, distance: y },
      { direction: 2, distance: x },
      { direction: 3, distance: Math.max(0, Number(record.width) - 1 - x) },
    ].sort((left, right) => left.distance - right.distance);
    const plan = route.length
      ? { kind: 'route', direction: route[0].direction, target: tileKey(destination), distance: route.length,
        route, source: 'client_exit_tile' }
      : { kind: 'probe', direction: directions[0].direction, target: tileKey(destination), distance: 0,
        source: 'client_exit_tile' };
    const score = route.length;
    if (!mappedExit || score < mappedExit.score) mappedExit = { ...plan, score };
  }
  if (mappedExit) return mappedExit;
  let best = null;
  for (const arrival of arrivals) {
    const route = graph.route(current, arrival);
    if (!route || route.some(edge => unavailableEdges.has(`${edge.from}>${edge.to}`))) continue;
    const directions = [
      { direction: 0, distance: Math.max(0, Number(record.height) - 1 - arrival.y) },
      { direction: 1, distance: arrival.y },
      { direction: 2, distance: arrival.x },
      { direction: 3, distance: Math.max(0, Number(record.width) - 1 - arrival.x) },
    ].sort((left, right) => left.distance - right.distance);
    for (const { direction } of directions) {
      if (graph.blocked.has(`${tileKey(arrival)}:${direction}`)) continue;
      const plan = route.length
        ? { kind: 'route', direction: route[0].direction, target: tileKey(arrival), distance: route.length, route, source: 'client_return_portal' }
        : { kind: 'probe', direction, target: tileKey(arrival), distance: 0, source: 'client_return_portal' };
      const score = route.length;
      if (!best || score < best.score) best = { ...plan, score };
      break;
    }
  }
  return best;
}
