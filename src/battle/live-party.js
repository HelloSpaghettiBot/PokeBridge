export function parseLiveParty(text) {
  const source = String(text ?? '');
  const marker = 'members=';
  const start = source.indexOf(marker);
  if (start < 0) return [];
  return source.slice(start + marker.length).split('|').map(record => {
    const [slotText, speciesText, levelText, hpText, maxHpText, movesText = ''] = record.split(',', 6);
    const slot = Number(slotText);
    const speciesId = Number(speciesText);
    const level = Number(levelText);
    const hp = Number(hpText);
    const maxHp = Number(maxHpText);
    if (![slot, speciesId, level, hp, maxHp].every(Number.isFinite) || slot < 0 || slot > 5 || speciesId < 1 || level < 1) return null;
    const moveEntries = movesText.split(';').filter(Boolean).map(entry => {
      const [moveId, pp] = entry.split(':').map(Number);
      return [moveId, pp];
    }).filter(([moveId, pp]) => Number.isInteger(moveId) && moveId > 0 && Number.isInteger(pp) && pp >= 0);
    const movePp = Object.fromEntries(moveEntries);
    const moveSlots = moveEntries.map(([moveId]) => moveId);
    const moves = moveEntries.filter(([, pp]) => pp > 0).map(([moveId]) => moveId);
    return { slot, speciesId, level, hp, maxHp, moves, moveSlots, movePp };
  }).filter(Boolean).sort((left, right) => left.slot - right.slot);
}
