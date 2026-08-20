export function parseWorldState(response) {
  const fields = Object.fromEntries(String(response).trim().split(/\s+/).map(part => {
    const separator = part.indexOf('=');
    return separator < 0 ? [part, true] : [part.slice(0, separator), part.slice(separator + 1)];
  }));
  if (!fields.map || fields.x === undefined || fields.y === undefined) {
    throw new Error(`Invalid world state: ${response}`);
  }
  return {
    map: fields.map,
    name: String(fields.name ?? '').replaceAll('_', ' '),
    x: Number(fields.x),
    y: Number(fields.y),
    direction: Number(fields.direction),
  };
}

export function tileKey(position) {
  return `${position.map}@${position.x},${position.y}`;
}
