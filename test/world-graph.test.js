import assert from 'node:assert/strict';
import test from 'node:test';
import { WorldGraph } from '../src/navigation/world-graph.js';
import { parseWorldState } from '../src/navigation/world-state.js';

test('parses the live authoritative Route 1 world state', () => {
  assert.deepEqual(parseWorldState('map=0:3:19:291 name=ROUTE_1 x=14 y=6 direction=3'), {
    map: '0:3:19:291', name: 'ROUTE 1', x: 14, y: 6, direction: 3,
  });
});

test('learns walk, collision, and cross-map warp edges', () => {
  const graph = new WorldGraph();
  const start = { map: 'route1', name: 'Route 1', x: 14, y: 6, direction: 3 };
  const next = { ...start, x: 15 };
  const inside = { map: 'center', name: 'Pokemon Center', x: 7, y: 8, direction: 1 };
  assert.equal(graph.observeStep(start, 3, next).type, 'walk');
  assert.equal(graph.observeStep(next, 3, next).type, 'blocked');
  assert.equal(graph.observeStep(next, 1, inside).type, 'warp');
  const route = graph.route(start, inside);
  assert.deepEqual(route.map(step => step.type), ['walk', 'warp']);
  assert.equal(graph.blocked.has('route1@15,6:3'), true);
});

test('records a same-map ledge jump as one-way movement', () => {
  const graph = new WorldGraph();
  const top = { map: 'route', name: 'Route', x: 7, y: 14, direction: 0 };
  const bottom = { ...top, y: 16 };
  assert.equal(graph.observeStep(top, 0, bottom).type, 'jump');
  assert.equal(graph.edges.get('route@7,14')[0].type, 'jump');
  assert.equal(graph.edges.has('route@7,16'), false);
});

test('rejects a same-map position update that does not match the commanded direction', () => {
  const graph = new WorldGraph({ edges: {
    'route@17,7': [{ to: 'route@18,8', direction: 1, type: 'jump' }],
  } });
  assert.equal(graph.edges.has('route@17,7'), false);
  const before = { map: 'route', name: 'Route', x: 17, y: 7, direction: 1 };
  const after = { ...before, x: 18, y: 8 };
  assert.equal(graph.observeStep(before, 1, after).type, 'desync');
  assert.equal(graph.edges.has('route@17,7'), false);
});

test('authoritative map memory clears transient blocks on walkable edges', () => {
  const graph = new WorldGraph({ blocked: ['gym@0,0:3'] });
  graph.observeMapGrid({
    map: 'gym', name: 'Gym', width: 2, height: 1,
    tiles: [
      { x: 0, y: 0, z: 0, terrainId: 1, behaviorId: 0, passMask: 8, grass: false, invalid: false, kind: '' },
      { x: 1, y: 0, z: 0, terrainId: 1, behaviorId: 0, passMask: 4, grass: false, invalid: false, kind: '' },
    ],
  });
  assert.equal(graph.blocked.has('gym@0,0:3'), false);
  assert.equal(graph.route({ map: 'gym', x: 0, y: 0 }, { map: 'gym', x: 1, y: 0 }).length, 1);
});
