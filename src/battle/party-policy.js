const TYPE_CHART = Object.freeze({
  normal: { rock: 0.5, ghost: 0, steel: 0.5 },
  fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
  ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
  poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
  ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
  flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
  bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
  rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
  ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
  dragon: { dragon: 2, steel: 0.5, fairy: 0 },
  dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
  steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
  fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
});

const normalized = value => String(value ?? '').replaceAll(/[^A-Za-z]/g, '').toLowerCase();

export function typeEffectiveness(attackType, defenseTypes = []) {
  const attack = normalized(attackType);
  return defenseTypes.map(normalized).filter(Boolean)
    .reduce((factor, defense) => factor * (TYPE_CHART[attack]?.[defense] ?? 1), 1);
}

export function moveScore(member, move, enemy) {
  const power = Number(move?.power ?? 0);
  if (power <= 0) return 0;
  const factor = typeEffectiveness(move.type, enemy?.types);
  const stab = (member?.types ?? []).map(normalized).includes(normalized(move.type)) ? 1.5 : 1;
  return power * factor * stab;
}

export function chooseBestMove(member, enemy) {
  const pp = member?.movePp ?? {};
  return (member?.moveDetails ?? [])
    .filter(move => Number(move?.power) > 0 && Number(pp[move.id] ?? 0) > 0)
    .map(move => ({ move, score: moveScore(member, move, enemy) }))
    .sort((left, right) => right.score - left.score || Number(right.move.power) - Number(left.move.power))[0]?.move ?? null;
}

export function chooseTrainingSlot(party, activeSlot, requestedSlot = 0) {
  const usable = party.map((pokemon, index) => ({ pokemon, index }))
    .filter(({ pokemon }) => Number(pokemon?.hp) > 0);
  if (requestedSlot > 0) {
    const index = requestedSlot - 1;
    return index !== activeSlot && usable.some(candidate => candidate.index === index) ? index : -1;
  }
  const candidate = usable.sort((left, right) => Number(left.pokemon.level) - Number(right.pokemon.level)
      || Number(right.pokemon.hp) / Math.max(1, Number(right.pokemon.maxHp))
      - Number(left.pokemon.hp) / Math.max(1, Number(left.pokemon.maxHp)))[0];
  return candidate && candidate.index !== activeSlot ? candidate.index : -1;
}

export function chooseCatchSlot(party, activeSlot, enemy) {
  const risk = member => {
    const damaging = (member.moveDetails ?? []).map(move => moveScore(member, move, enemy)).filter(score => score > 0);
    if (!damaging.length) return Number.POSITIVE_INFINITY;
    return Math.min(...damaging) * Math.max(0.25, Number(member.level) / Math.max(1, Number(enemy.level)));
  };
  const activeRisk = risk(party[activeSlot] ?? {});
  const candidate = party.map((pokemon, index) => ({ pokemon, index, risk: risk(pokemon) }))
    .filter(({ pokemon, index, risk: value }) => index !== activeSlot && Number(pokemon?.hp) > 0 && Number.isFinite(value))
    .sort((left, right) => left.risk - right.risk || Number(left.pokemon.level) - Number(right.pokemon.level))[0];
  if (!candidate) return -1;
  const leadLooksDangerous = Number(party[activeSlot]?.level) >= Number(enemy.level) + 8;
  return leadLooksDangerous || candidate.risk * 1.3 < activeRisk ? candidate.index : -1;
}

export function chooseTrainerSlot(party, activeSlot, enemy) {
  const score = member => {
    const offense = Math.max(0, ...(member.moveDetails ?? []).map(move => moveScore(member, move, enemy)));
    const health = Number(member.hp) / Math.max(1, Number(member.maxHp));
    return offense * (0.65 + 0.35 * health);
  };
  const activeScore = score(party[activeSlot] ?? {});
  const candidate = party.map((pokemon, index) => ({ pokemon, index, score: score(pokemon) }))
    .filter(({ pokemon }) => Number(pokemon?.hp) > 0)
    .sort((left, right) => right.score - left.score)[0];
  if (!candidate || candidate.index === activeSlot) return -1;
  return candidate.score > activeScore * 1.2 ? candidate.index : -1;
}
