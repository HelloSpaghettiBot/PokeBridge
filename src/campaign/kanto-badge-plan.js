export const KANTO_BADGE_PLAN = Object.freeze([
  {
    id: 'brock', order: 1, badge: 'Boulder Badge', leader: 'Brock', city: 'Pewter City',
    gymType: 'Rock', levelCap: 20, trainingTarget: 14,
    // Learned from the authoritative client MAPGRID key during the live
    // Pewter smoke test. Unlike the HUD label, this key identifies the room.
    mapKeys: ['0:6:2:275'],
    // Brock is NPC model 80 at (6,5) in the live entity stream. Interact from
    // the walkable square immediately north of him while facing south.
    leaderApproach: { map: '0:6:2:275', x: 6, y: 4, direction: 0 },
    mapAliases: ['Pewter City', 'Pewter Gym', 'Pewter City Gym', 'Pokémon Gym (Pewter City)'],
    milestones: ['Route 2', 'Viridian Forest', 'Pewter City', 'Pewter Gym'],
  },
  {
    id: 'misty', order: 2, badge: 'Cascade Badge', leader: 'Misty', city: 'Cerulean City',
    gymType: 'Water', levelCap: 26, trainingTarget: 22,
    mapKeys: [],
    leaderApproach: null,
    mapAliases: ['Cerulean City', 'Cerulean Gym', 'Cerulean City Gym', 'Pokémon Gym (Cerulean City)'],
    milestones: ['Route 3', 'Mt. Moon', 'Cerulean City', 'Cerulean Gym'],
  },
  {
    id: 'surge', order: 3, badge: 'Thunder Badge', leader: 'Lt. Surge', city: 'Vermilion City',
    gymType: 'Electric', levelCap: 32, trainingTarget: 28,
    mapKeys: [],
    leaderApproach: null,
    mapAliases: ['Vermilion City', 'Vermilion Gym', 'Vermilion City Gym', 'Pokémon Gym (Vermilion City)'],
    milestones: ['Route 24', 'Route 25', 'S.S. Anne', 'Vermilion City', 'Vermilion Gym'],
  },
  {
    id: 'erika', order: 4, badge: 'Rainbow Badge', leader: 'Erika', city: 'Celadon City',
    gymType: 'Grass', levelCap: 37, trainingTarget: 34,
    mapKeys: [],
    leaderApproach: null,
    mapAliases: ['Celadon City', 'Celadon Gym', 'Celadon City Gym', 'Pokémon Gym (Celadon City)'],
    milestones: ['Rock Tunnel', 'Lavender Town', 'Celadon City', 'Rocket Game Corner', 'Celadon Gym'],
  },
  {
    id: 'koga', order: 5, badge: 'Soul Badge', leader: 'Koga', city: 'Fuchsia City',
    gymType: 'Poison', levelCap: 46, trainingTarget: 42,
    mapKeys: [],
    leaderApproach: null,
    mapAliases: ['Fuchsia City', 'Fuchsia Gym', 'Fuchsia City Gym', 'Pokémon Gym (Fuchsia City)'],
    milestones: ['Pokémon Tower', 'Fuchsia City', 'Fuchsia Gym'],
  },
  {
    id: 'sabrina', order: 6, badge: 'Marsh Badge', leader: 'Sabrina', city: 'Saffron City',
    gymType: 'Psychic', levelCap: 47, trainingTarget: 44,
    mapKeys: [],
    leaderApproach: null,
    mapAliases: ['Saffron City', 'Saffron Gym', 'Saffron City Gym', 'Pokémon Gym (Saffron City)'],
    milestones: ['Silph Co.', 'Saffron City', 'Saffron Gym'],
  },
  {
    id: 'blaine', order: 7, badge: 'Volcano Badge', leader: 'Blaine', city: 'Cinnabar Island',
    gymType: 'Fire', levelCap: 50, trainingTarget: 48,
    mapKeys: [],
    leaderApproach: null,
    mapAliases: ['Cinnabar Island', 'Cinnabar Gym', 'Cinnabar Island Gym', 'Pokémon Gym (Cinnabar Island)'],
    milestones: ['Cinnabar Island', 'Pokémon Mansion', 'Cinnabar Gym'],
  },
  {
    id: 'giovanni', order: 8, badge: 'Earth Badge', leader: 'Giovanni', city: 'Viridian City',
    gymType: 'Ground', levelCap: 55, trainingTarget: 52,
    mapKeys: [],
    leaderApproach: null,
    mapAliases: ['Viridian City', 'Viridian Gym', 'Viridian City Gym', 'Pokémon Gym (Viridian City)'],
    milestones: ['Viridian City', 'Viridian Gym'],
  },
]);

// PokeMMO's Kanto obedience cap starts at 20 and rises after each badge.
export const KANTO_LEVEL_CAPS = Object.freeze([20, 26, 32, 37, 46, 47, 50, 55, 62]);

export function kantoGym(id) {
  return KANTO_BADGE_PLAN.find(gym => gym.id === String(id).toLowerCase()) ?? null;
}
