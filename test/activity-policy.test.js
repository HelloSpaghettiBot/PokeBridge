import test from 'node:test';
import assert from 'node:assert/strict';
import { battleDecision, chooseActivityDestination, chooseConfirmedTerrainStep, targetMatches } from '../src/exploration/activity-policy.js';
import { WorldGraph } from '../src/navigation/world-graph.js';

const pidgey = { speciesId: 16, species: 'Pidgey', level: 3, hp: 8, maxHp: 10, shiny: false };
test('target matching accepts a readable species name or id', () => {
  assert.equal(targetMatches(pidgey, 'pidgey'), true);
  assert.equal(targetMatches(pidgey, '16'), true);
});
test('target is weakened before a ball is selected', () => {
  assert.equal(battleDecision({ mode: 'hunt', enemy: pidgey, targetSpecies: 'Pidgey', balls: 2 }).action, 'weaken');
  assert.equal(battleDecision({ mode: 'hunt', enemy: { ...pidgey, hp: 4 }, targetSpecies: 'Pidgey', balls: 2 }).action, 'catch');
});
test('any shiny overrides path and training modes when balls exist', () => {
  const decision = battleDecision({ mode: 'train', enemy: { ...pidgey, shiny: true }, balls: 1 });
  assert.equal(decision.action, 'weaken');
  assert.equal(decision.reason, 'shiny');
});
test('out of balls falls back to ordinary battling', () => {
  assert.equal(battleDecision({ mode: 'hunt', enemy: pidgey, targetSpecies: 'Pidgey', balls: 0 }).action, 'battle');
});
test('trainer Pokemon are never catch or flee targets', () => {
  const decision = battleDecision({ mode: 'hunt', enemy: { ...pidgey, shiny: true, wild: false }, targetSpecies: 'Pidgey', balls: 10 });
  assert.equal(decision.action, 'battle');
  assert.equal(decision.reason, 'trainer_battle');
});

test('training routes to a reachable encounter tile when the first recorded tile is disconnected', () => {
  const graph = new WorldGraph({
    maps: {
      town: { name: 'Pallet Town', visited: ['0,0'] },
      route: { name: 'Route 1', visited: ['0,0', '1,0'] },
    },
    edges: {
      'town@0,0': [{ to: 'route@1,0', direction: 1, type: 'warp' }],
    },
  });
  const dex = {
    clientLocations: { 16: { locations: [{ location: 'Route 1', type: 'Grass', levelMin: 2, levelMax: 5 }] } },
    maps: { route: { encounters: 2, encounterTiles: { '9,9': 3, '1,0': 1 }, species: { 16: { samples: 2 } } } },
  };
  const result = chooseActivityDestination({ graph, dex, current: { map: 'town', x: 0, y: 0 }, mode: 'train', levelMin: 2, levelMax: 5 });
  assert.equal(result.destination.map, 'route');
  assert.equal(result.destination.x, 1);
  assert.equal(result.route.length, 1);
});

test('training patrols once already inside an empirically valid area', () => {
  const graph = new WorldGraph({ maps: { route: { name: 'Route 1', visited: ['1,0'] } } });
  const dex = {
    clientLocations: { 16: { locations: [{ location: 'Route 1', type: 'Grass', levelMin: 2, levelMax: 5 }] } },
    maps: { route: { encounters: 2, encounterTiles: { '1,0': 2 }, species: { 16: { samples: 2 } } } },
  };
  const result = chooseActivityDestination({ graph, dex, current: { map: 'route', x: 1, y: 0 }, mode: 'train', levelMin: 2, levelMax: 5 });
  assert.equal(result.inArea, true);
  assert.deepEqual(result.route, []);
});

test('being on the right map but off grass routes back to confirmed encounter terrain', () => {
  const graph = new WorldGraph({
    maps: { route: { name: 'Route 1', visited: ['0,0', '1,0'] } },
    edges: { 'route@0,0': [{ to: 'route@1,0', direction: 3, type: 'walk' }] },
  });
  const dex = {
    clientLocations: { 16: { locations: [{ location: 'Route 1', type: 'Grass', levelMin: 2, levelMax: 5 }] } },
    maps: { route: { encounters: 1, encounterTiles: { '1,0': 1 }, species: { 16: { samples: 1 } } } },
  };
  const result = chooseActivityDestination({ graph, dex, current: { map: 'route', x: 0, y: 0 }, mode: 'train', levelMin: 2, levelMax: 5 });
  assert.equal(result.inArea, false);
  assert.deepEqual(result.destination, { map: 'route', name: 'Route 1', x: 1, y: 0, direction: 0 });
  assert.equal(result.route[0].to, 'route@1,0');
});

test('grass patrol refuses an adjacent road and chooses a confirmed grass neighbor', () => {
  const graph = new WorldGraph({
    maps: { route: { name: 'Route 1', visited: ['0,0', '1,0', '2,0'] } },
    edges: {
      'route@1,0': [
        { to: 'route@0,0', direction: 2, type: 'walk' },
        { to: 'route@2,0', direction: 3, type: 'walk' },
      ],
    },
  });
  const step = chooseConfirmedTerrainStep({ graph, current: { map: 'route', x: 1, y: 0 }, terrainTiles: ['1,0', '2,0'], random: () => 0 });
  assert.equal(step.to, 'route@2,0');
});
