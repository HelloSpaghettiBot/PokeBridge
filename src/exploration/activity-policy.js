function normalized(value) {
  return String(value ?? '').replaceAll('_', ' ').replace(/[^a-z0-9]+/gi, '').toLowerCase();
}

export function targetMatches(enemy, target) {
  if (!enemy || !target) return false;
  const numeric = Number(target);
  return Number.isInteger(numeric) && numeric > 0
    ? enemy.speciesId === numeric
    : normalized(enemy.species) === normalized(target);
}

export function battleDecision({ mode, enemy, targetSpecies, balls, alwaysCatchShiny = true, weakenAt = 0.5 }) {
  if (enemy?.wild === false) return { action: 'battle', reason: 'trainer_battle', isTarget: false, wantedShiny: false };
  const isTarget = targetMatches(enemy, targetSpecies);
  const wantedShiny = Boolean(enemy?.shiny) && alwaysCatchShiny;
  const modeWantsCatch = mode === 'hunt' && isTarget || mode === 'shiny' && Boolean(enemy?.shiny) && (!targetSpecies || isTarget);
  const wantsCatch = wantedShiny || modeWantsCatch;
  if (wantsCatch && balls <= 0) return { action: 'battle', reason: 'out_of_balls', isTarget, wantedShiny };
  if (wantsCatch) {
    const hpRatio = enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 1;
    return { action: hpRatio <= weakenAt ? 'catch' : 'weaken', reason: wantedShiny ? 'shiny' : 'target', isTarget, wantedShiny };
  }
  return { action: 'battle', reason: mode === 'train' ? 'training' : 'path_battle', isTarget, wantedShiny };
}

export function resolveTargetSpeciesId(dex, target) {
  const numeric = Number(target);
  if (Number.isInteger(numeric) && numeric > 0) return numeric;
  for (const area of Object.values(dex.maps ?? {})) {
    for (const species of Object.values(area.species ?? {})) {
      if (normalized(species.name) === normalized(target)) return Number(species.speciesId);
    }
  }
  return null;
}

export function confirmedEncounterTerrain(dex, mapKey, area = dex.maps?.[mapKey]) {
  if (!area) return [];
  if (typeof dex.encounterTerrainTiles === 'function') return dex.encounterTerrainTiles(mapKey);
  const signatures = new Set(Object.entries(area.encounterTerrainSignatures ?? {})
    .filter(([, evidence]) => Number(evidence?.encounters ?? 0) > 0)
    .map(([signature]) => signature));
  const result = new Set(Object.keys(area.encounterTiles ?? {}));
  for (const [coordinate, terrain] of Object.entries(area.terrainTiles ?? {})) {
    if (signatures.has(terrain?.signature)) result.add(coordinate);
  }
  return [...result];
}

export function chooseConfirmedTerrainStep({ graph, current, terrainTiles, random = Math.random }) {
  const allowed = new Set(terrainTiles ?? []);
  const from = `${current.map}@${current.x},${current.y}`;
  const localEdges = (graph.edges.get(from) ?? []).filter(edge => {
    if (!['walk', 'map'].includes(edge.type) || !edge.to.startsWith(`${current.map}@`)) return false;
    return allowed.has(edge.to.slice(edge.to.lastIndexOf('@') + 1));
  });
  if (localEdges.length) return localEdges[Math.min(localEdges.length - 1, Math.floor(random() * localEdges.length))];
  let best = null;
  for (const coordinate of allowed) {
    const [x, y] = coordinate.split(',').map(Number);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x === current.x && y === current.y) continue;
    const route = graph.route(current, { ...current, x, y });
    if (route?.length && (!best || route.length < best.length)) best = route;
  }
  return best?.[0] ?? null;
}

export function chooseActivityDestination({ graph, dex, current, mode, targetSpecies, levelMin = 1, levelMax = 100 }) {
  if (!['hunt', 'shiny', 'train'].includes(mode)) return null;
  const wantedSpeciesId = resolveTargetSpeciesId(dex, targetSpecies);
  const candidateNames = new Set();
  for (const [speciesId, payload] of Object.entries(dex.clientLocations ?? {})) {
    if ((mode === 'hunt' || mode === 'shiny') && wantedSpeciesId && Number(speciesId) !== wantedSpeciesId) continue;
    for (const location of payload.locations ?? []) {
      const overlaps = Number(location.levelMax) >= levelMin && Number(location.levelMin) <= levelMax;
      if ((mode !== 'train' || overlaps) && String(location.type).toLowerCase().includes('grass')) candidateNames.add(normalized(location.location));
    }
  }
  let best = null;
  for (const [mapKey, map] of graph.maps) {
    if (!candidateNames.has(normalized(map.name))) continue;
    const area = dex.maps?.[mapKey];
    const empiricalSpecies = wantedSpeciesId ? area?.species?.[String(wantedSpeciesId)] : null;
    const empiricallySuitable = mode === 'train'
      ? Number(area?.encounters ?? 0) > 0
      : Boolean(empiricalSpecies);
    const terrainTiles = [...new Set([...confirmedEncounterTerrain(dex, mapKey, area), ...(map.grass ?? [])])];
    if (!empiricallySuitable || !terrainTiles.length) continue;
    const currentCoordinate = `${current.x},${current.y}`;
    if (mapKey === current.map && terrainTiles.includes(currentCoordinate)) {
      return { destination: { ...current, name: map.name }, route: [], mapName: map.name, inArea: true, terrainTiles };
    }
    const coordinates = [...terrainTiles].sort((left, right) => Number(area?.encounterTiles?.[right] ?? 0) - Number(area?.encounterTiles?.[left] ?? 0));
    const seen = new Set();
    for (const coordinate of coordinates) {
      if (seen.has(coordinate)) continue;
      seen.add(coordinate);
      const [x, y] = coordinate.split(',').map(Number);
      if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
      const destination = { map: mapKey, name: map.name, x, y, direction: 0 };
      const route = graph.route(current, destination);
      if (route && (!best || route.length < best.route.length)) best = { destination, route, mapName: map.name, inArea: false, terrainTiles };
    }
  }
  return best;
}
