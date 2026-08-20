export function parseClientMapGrid(text) {
  const value = String(text ?? '').trim();
  if (!value.startsWith('MAPGRID ')) throw new Error(`Invalid map-grid response: ${value.slice(0, 80)}`);
  const marker = ' tiles=';
  const markerIndex = value.indexOf(marker);
  if (markerIndex < 0) throw new Error('Map-grid response has no tile payload');
  const header = Object.fromEntries(value.slice(8, markerIndex).split(/\s+/).map(part => {
    const index = part.indexOf('=');
    return index < 0 ? [part, true] : [part.slice(0, index), part.slice(index + 1)];
  }));
  const width = Number(header.width);
  const height = Number(header.height);
  if (!header.map || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Map-grid header is invalid');
  }
  const tiles = value.slice(markerIndex + marker.length).split(';').filter(Boolean).map(record => {
    const parts = record.split(',');
    const values = parts.slice(0, 7).map(Number);
    if (parts.length < 7 || values.some(item => !Number.isInteger(item))) throw new Error(`Invalid map tile: ${record}`);
    const [x, y, z, terrainId, behaviorId, passMask, flags] = values;
    return { x, y, z, terrainId, behaviorId, passMask, grass: Boolean(flags & 1), invalid: Boolean(flags & 2), kind: parts[7] ?? '' };
  });
  return { map: header.map, name: String(header.name ?? '').replaceAll('_', ' '), width, height, tiles };
}
