import { KANTO_BADGE_PLAN, KANTO_LEVEL_CAPS } from './kanto-badge-plan.js';

const normalized = value => String(value ?? '').normalize('NFKD').replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase();
const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mapNameMatches = (left, right) => {
  const a = normalized(left);
  const b = normalized(right);
  if (!a || !b) return false;
  return new RegExp(`(^| )${escaped(b)}($| )`).test(a)
    || new RegExp(`(^| )${escaped(a)}($| )`).test(b);
};

function partyLevels(party) {
  return (party ?? [])
    .filter(pokemon => Number(pokemon?.hp ?? 1) > 0 && Number(pokemon?.level) > 0)
    .map(pokemon => Number(pokemon.level))
    .sort((a, b) => b - a);
}

export class KantoBadgeCampaign {
  constructor(serialized = {}) {
    this.completedBadges = [...new Set(serialized.completedBadges ?? [])]
      .filter(id => KANTO_BADGE_PLAN.some(gym => gym.id === id));
    this.confirmedBadgeCount = Math.max(this.completedBadges.length, Number(serialized.confirmedBadgeCount ?? 0));
    this.lastKnownParty = Array.isArray(serialized.lastKnownParty) ? serialized.lastKnownParty : [];
    this.visitedMilestones = [...new Set(serialized.visitedMilestones ?? [])];
    this.attemptedInteractions = [...new Set(serialized.attemptedInteractions ?? [])];
    this.startedAt = serialized.startedAt ?? new Date().toISOString();
    this.updatedAt = serialized.updatedAt ?? this.startedAt;
  }

  currentGym() {
    return KANTO_BADGE_PLAN.find(gym => !this.completedBadges.includes(gym.id)) ?? null;
  }

  gymForMap(map) {
    return KANTO_BADGE_PLAN.find(gym => (gym.mapKeys ?? []).includes(String(map))) ?? null;
  }

  annotateMap(graph, map) {
    const gym = this.gymForMap(map);
    const record = graph?.maps?.get(map);
    if (!gym || !record) return null;
    record.kind = 'gym';
    record.gymId = gym.id;
    record.name = `${gym.city} Gym`;
    return gym;
  }

  isCurrentGymMap(graph, current) {
    const gym = this.currentGym();
    if (!gym) return false;
    const record = graph?.maps?.get(current?.map);
    // Once a gym has an authoritative identity, never treat it as whichever
    // gym happens to be next merely because its display name contains "Gym".
    if (record?.gymId) return record.gymId === gym.id;
    return (gym.mapKeys ?? []).includes(String(current?.map))
      || /gym/i.test(record?.name ?? current?.name ?? '');
  }

  findLeaderInteraction(graph, current) {
    const gym = this.currentGym();
    const approach = gym?.leaderApproach;
    if (!approach || !graph?.maps?.has(approach.map)) return null;
    const destination = { map: approach.map, name: `${gym.city} Gym`, x: approach.x, y: approach.y, direction: approach.direction };
    const route = graph.route(current, destination);
    return route && { destination, direction: approach.direction, route, gym };
  }

  observeWorld(world) {
    const name = normalized(world?.name);
    for (const gym of KANTO_BADGE_PLAN) {
      for (const milestone of gym.milestones) {
        if (mapNameMatches(name, milestone)) {
          if (!this.visitedMilestones.includes(milestone)) this.visitedMilestones.push(milestone);
        }
      }
    }
    this.updatedAt = new Date().toISOString();
  }

  observeParty(party) {
    if (Array.isArray(party) && party.length) this.lastKnownParty = party;
    this.updatedAt = new Date().toISOString();
  }

  confirmBadgeCount(count) {
    const safeCount = Math.max(0, Math.min(KANTO_BADGE_PLAN.length, Number(count) || 0));
    if (safeCount < this.confirmedBadgeCount) return false;
    this.confirmedBadgeCount = safeCount;
    this.completedBadges = KANTO_BADGE_PLAN.slice(0, safeCount).map(gym => gym.id);
    this.updatedAt = new Date().toISOString();
    return true;
  }

  confirmLevelCap(levelCap) {
    const index = KANTO_LEVEL_CAPS.indexOf(Number(levelCap));
    if (index < 0) return false;
    return this.confirmBadgeCount(index);
  }

  trainingState() {
    const gym = this.currentGym();
    if (!gym) return { needed: false, targetLevel: null, strongestLevel: null, teamAverage: null };
    const levels = partyLevels(this.lastKnownParty);
    if (!levels.length) return { needed: true, targetLevel: gym.trainingTarget, strongestLevel: null, teamAverage: null };
    const core = levels.slice(0, Math.min(3, levels.length));
    const average = core.reduce((sum, level) => sum + level, 0) / core.length;
    // A sufficiently strong lead can carry an early badge attempt; otherwise
    // require a usable core rather than grinding the whole captured party.
    const needed = levels[0] < gym.trainingTarget && average < gym.trainingTarget - 3;
    return { needed, targetLevel: gym.trainingTarget, strongestLevel: levels[0], teamAverage: Number(average.toFixed(1)) };
  }

  findObjective(graph, current) {
    const gym = this.currentGym();
    if (!gym) return null;
    const aliases = gym.mapAliases.map(normalized);
    let best = null;
    for (const [map, record] of graph.maps) {
      this.annotateMap(graph, map);
      const name = normalized(record?.name);
      if (!aliases.some(alias => name.includes(alias) || alias.includes(name))) continue;
      for (const coordinate of record.visited ?? []) {
        const [x, y] = String(coordinate).split(',').map(Number);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const destination = { map, name: record.name, x, y, direction: 0 };
        const route = graph.route(current, destination);
        if (!route) continue;
        const gymMap = record.gymId === gym.id || /gym/i.test(record.name ?? '');
        const score = route.length - (gymMap ? 1000 : 0);
        if (!best || score < best.score) best = { destination, route, gymMap, score };
      }
    }
    return best && { destination: best.destination, route: best.route, gymMap: best.gymMap };
  }

  findApproach(graph, current) {
    const gym = this.currentGym();
    if (!gym) return null;
    const reachedPriority = gym.milestones.reduce((highest, milestone, index) =>
      this.visitedMilestones.some(visited => mapNameMatches(visited, milestone)) ? Math.max(highest, index) : highest, -1);
    let best = null;
    for (const [priority, alias] of gym.milestones.entries()) {
      if (priority < reachedPriority) continue;
      for (const [map, record] of graph.maps) {
        if (map === current.map || !mapNameMatches(record?.name, alias)) continue;
        if (mapNameMatches(current?.name, alias) && !/gym/i.test(record?.name ?? '')) continue;
        for (const coordinate of record.visited ?? []) {
          const [x, y] = String(coordinate).split(',').map(Number);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          const destination = { map, name: record.name, x, y, direction: 0 };
          const route = graph.route(current, destination);
          if (!route?.length) continue;
          const score = priority * 10000 - route.length;
          if (!best || score > best.score) best = { destination, route, alias, score };
        }
      }
    }
    return best && { destination: best.destination, route: best.route, alias: best.alias };
  }

  preferredExplorationDirection(world) {
    const gym = this.currentGym();
    if (gym?.id !== 'brock') return null;
    if (mapNameMatches(world?.name, 'Route 2') || mapNameMatches(world?.name, 'Viridian Forest')) return 1;
    return null;
  }

  nextInteraction(graph, current) {
    const gym = this.currentGym();
    if (!gym) return null;
    const milestoneNames = gym.milestones.map(normalized);
    const candidates = [];
    for (const blocked of graph.blocked) {
      if (this.attemptedInteractions.includes(blocked)) continue;
      const split = blocked.lastIndexOf(':');
      if (split < 0) continue;
      const from = blocked.slice(0, split);
      const direction = Number(blocked.slice(split + 1));
      const at = from.lastIndexOf('@');
      if (at < 0 || !Number.isInteger(direction)) continue;
      const map = from.slice(0, at);
      const [x, y] = from.slice(at + 1).split(',').map(Number);
      const record = graph.maps.get(map);
      const destination = { map, name: record?.name ?? map, x, y, direction };
      const route = graph.route(current, destination);
      if (!route) continue;
      const name = normalized(record?.name);
      const storyMap = milestoneNames.some(milestone => name.includes(milestone) || milestone.includes(name));
      const gymMap = /gym/i.test(record?.name ?? '');
      candidates.push({ key: blocked, destination, direction, route, storyMap, gymMap,
        score: route.length - (gymMap ? 2000 : storyMap ? 1000 : 0) });
    }
    candidates.sort((a, b) => a.score - b.score);
    const selected = candidates[0];
    return selected && { key: selected.key, destination: selected.destination, direction: selected.direction,
      route: selected.route, storyMap: selected.storyMap, gymMap: selected.gymMap };
  }

  markInteraction(key) {
    if (key && !this.attemptedInteractions.includes(key)) this.attemptedInteractions.push(key);
    this.updatedAt = new Date().toISOString();
  }

  status() {
    const gym = this.currentGym();
    const training = this.trainingState();
    return {
      region: 'Kanto',
      complete: !gym,
      badges: this.completedBadges.length,
      confirmedBadgeCount: this.confirmedBadgeCount,
      completedBadges: [...this.completedBadges],
      currentGym: gym ? { ...gym } : null,
      training,
      objective: gym
        ? `${training.needed ? `Train toward Lv. ${gym.trainingTarget}, then ` : ''}challenge ${gym.leader} in ${gym.city}`
        : 'All eight Kanto badges confirmed',
      visitedMilestones: [...this.visitedMilestones],
      attemptedInteractions: this.attemptedInteractions.length,
    };
  }

  toJSON() {
    return {
      version: 1,
      region: 'Kanto',
      completedBadges: [...this.completedBadges],
      confirmedBadgeCount: this.confirmedBadgeCount,
      lastKnownParty: this.lastKnownParty,
      visitedMilestones: [...this.visitedMilestones],
      attemptedInteractions: [...this.attemptedInteractions],
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
    };
  }
}
