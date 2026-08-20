import assert from 'node:assert/strict';
import test from 'node:test';
import { planFrontier, planMappedExit, planMappedPortal, planMappedSurvey, unexploredDirections } from '../src/exploration/frontier-planner.js';
import { WorldGraph } from '../src/navigation/world-graph.js';

test('probes a direction that has not been observed at the current tile', () => {
  const graph = new WorldGraph();
  const position = { map: 'route', name: 'Route', x: 1, y: 1, direction: 3 };
  graph.observe(position);
  graph.blocked.add('route@1,1:0');
  graph.blocked.add('route@1,1:1');
  graph.blocked.add('route@1,1:2');
  assert.deepEqual(unexploredDirections(graph, position), [3]);
  assert.equal(planFrontier(graph, position).direction, 3);
});

test('routes to the closest mapped tile with an unexplored edge', () => {
  const graph = new WorldGraph();
  const start = { map: 'route', name: 'Route', x: 0, y: 0, direction: 3 };
  const next = { ...start, x: 1 };
  graph.observeStep(start, 3, next);
  for (const direction of [0, 1, 2]) graph.blocked.add(`route@0,0:${direction}`);
  const plan = planFrontier(graph, start);
  assert.equal(plan.kind, 'route');
  assert.equal(plan.direction, 3);
  assert.equal(plan.target, 'route@1,0');
});

test('never routes through an edge the live server has just blocked', () => {
  const graph = new WorldGraph({
    maps: { map: { visited: ['0,0', '1,0', '0,1'] } },
    edges: {
      'map@0,0': [
        { to: 'map@1,0', direction: 3, type: 'walk' },
        { to: 'map@0,1', direction: 0, type: 'walk' },
      ],
    },
    blocked: ['map@0,0:3'],
  });
  for (const direction of [0, 1, 2, 3]) graph.blocked.add(`map@0,0:${direction}`);
  for (const direction of [0, 1, 2, 3]) graph.blocked.add(`map@0,1:${direction}`);
  const plan = planFrontier(graph, { map: 'map', x: 0, y: 0, direction: 3 }, { random: () => 0 });
  assert.equal(plan, null);
});

test('authoritative map survey routes through known collision-free edges without probing walls', () => {
  const graph = new WorldGraph();
  graph.observeMapGrid({ map: 'map', name: 'Map', width: 3, height: 1, tiles: [
    { x: 0, y: 0, z: 0, terrainId: 1, behaviorId: 1, passMask: 8 },
    { x: 1, y: 0, z: 0, terrainId: 1, behaviorId: 1, passMask: 12 },
    { x: 2, y: 0, z: 0, terrainId: 1, behaviorId: 1, passMask: 4 },
  ] });
  const current = { map: 'map', name: 'Map', x: 0, y: 0, direction: 3 };
  graph.observe(current);
  const plan = planMappedSurvey(graph, current);
  assert.equal(plan.target, 'map@1,0');
  assert.equal(plan.direction, 3);
  assert.equal(plan.source, 'client_map');
});

test('authoritative portal planning routes to the approach then probes the transition tile', () => {
  const graph = new WorldGraph();
  graph.observeMapGrid({ map: 'map', name: 'Map', width: 3, height: 2, tiles: [
    { x: 0, y: 1, z: 0, terrainId: 1, behaviorId: 1, passMask: 8, kind: 'Ro0' },
    { x: 1, y: 1, z: 0, terrainId: 1, behaviorId: 1, passMask: 12, kind: 'Ro0' },
    { x: 2, y: 1, z: 0, terrainId: 1, behaviorId: 1, passMask: 4, kind: 'Ro0' },
    { x: 2, y: 0, z: 0, terrainId: 2, behaviorId: 1, passMask: 0, kind: 'Xi1' },
  ] });
  const start = { map: 'map', name: 'Map', x: 0, y: 1, direction: 3 };
  const route = planMappedPortal(graph, start);
  assert.equal(route.target, 'map@2,1');
  assert.equal(route.direction, 3);
  const probe = planMappedPortal(graph, { ...start, x: 2 });
  assert.equal(probe.kind, 'probe');
  assert.equal(probe.direction, 1);
});

test('authoritative portal planning remembers a transition reported from an adjacent approach tile', () => {
  const graph = new WorldGraph();
  graph.observeMapGrid({ map: 'outside', name: 'Pewter City', width: 3, height: 2, tiles: [
    { x: 0, y: 1, z: 0, terrainId: 1, behaviorId: 1, passMask: 8, kind: 'Ro0' },
    { x: 1, y: 1, z: 0, terrainId: 1, behaviorId: 1, passMask: 12, kind: 'Ro0' },
    { x: 2, y: 1, z: 0, terrainId: 1, behaviorId: 1, passMask: 4, kind: 'Ro0' },
    { x: 2, y: 0, z: 0, terrainId: 2, behaviorId: 1, passMask: 0, kind: 'Xi1' },
  ] });
  graph.edges.set('outside@2,1', [{ to: 'museum@1,1', direction: 1, type: 'warp' }]);
  const plan = planMappedPortal(graph, { map: 'outside', name: 'Pewter City', x: 0, y: 1, direction: 3 });
  assert.equal(plan, null);
});

test('badge routing returns from a non-gym interior through its arrival edge', () => {
  const graph = new WorldGraph({ maps: {
    outside: { name: 'Pewter City', visited: ['5,5'], authoritative: true, portals: ['5,4'] },
    inside: { name: 'Pewter City', visited: ['1,1'], authoritative: true, width: 3, height: 3, tiles: [[1,1,0,1,1,1,0,'Ro0']] },
  }, edges: { 'outside@5,5': [{ to: 'inside@1,1', direction: 1, type: 'warp' }] } });
  const plan = planMappedExit(graph, { map: 'inside', name: 'Pewter City', x: 1, y: 1, direction: 0 });
  assert.equal(plan.kind, 'probe');
  assert.equal(plan.target, 'inside@1,1');
});

test('badge routing does not mistake an outdoor map with building warps for an interior', () => {
  const graph = new WorldGraph({ maps: {
    outside: { name: 'Pewter City', visited: ['5,5'], authoritative: true, portals: ['5,4'], tiles: [[5,5,0,1,1,1,0,'Ro0']] },
    inside: { name: 'Pewter City', visited: ['1,1'], authoritative: true, portals: [], tiles: [[1,1,0,1,1,1,0,'Ro0']] },
  }, edges: {
    'outside@5,5': [{ to: 'inside@1,1', direction: 1, type: 'warp' }],
    'inside@1,1': [{ to: 'outside@5,5', direction: 0, type: 'warp' }],
  } });
  assert.equal(planMappedExit(graph, { map: 'outside', name: 'Pewter City', x: 5, y: 5, direction: 0 }), null);
});

test('badge routing walks onto a client exit tile and probes outward instead of returning to spawn', () => {
  const graph = new WorldGraph({ maps: {
    outside: { name: 'Pewter City', authoritative: true, portals: ['28,18'] },
    inside: { name: 'Pewter City', visited: ['4,6'], authoritative: true, width: 11, height: 9,
      exits: ['4,7'], tiles: [[4,6,2,1,1,1,0,'Ro0'], [4,7,2,2,1,1,0,'M10']] },
  }, edges: {
    'outside@28,19': [{ to: 'inside@4,6', direction: 1, type: 'warp' }],
    'inside@4,6': [{ to: 'inside@4,7', direction: 0, type: 'map' }],
    'inside@4,7': [{ to: 'inside@4,6', direction: 1, type: 'map' }],
  } });
  const route = planMappedExit(graph, { map: 'inside', name: 'Pewter City', x: 4, y: 6, direction: 0 });
  assert.equal(route.target, 'inside@4,7');
  assert.equal(route.direction, 0);
  const probe = planMappedExit(graph, { map: 'inside', name: 'Pewter City', x: 4, y: 7, direction: 0 });
  assert.equal(probe.kind, 'probe');
  assert.equal(probe.direction, 0);
});

test('recovery can explicitly leave a known gym through its client exit tile', () => {
  const graph = new WorldGraph({ maps: {
    outside: { name: 'Pewter City', authoritative: true, portals: ['15,16'] },
    gym: { name: 'Pewter City Gym', authoritative: true, width: 13, height: 16,
      exits: ['6,14'], tiles: [[6,14,2,1,1,1,0,'M10']] },
  }, edges: { 'outside@15,16': [{ to: 'gym@6,14', direction: 0, type: 'warp' }] } });
  const plan = planMappedExit(graph, { map: 'gym', name: 'Pewter City', x: 6, y: 14, direction: 0 }, { allowGym: true });
  assert.equal(plan.kind, 'probe');
  assert.equal(plan.direction, 0);
});
