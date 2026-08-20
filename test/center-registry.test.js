import test from 'node:test';
import assert from 'node:assert/strict';
import { CenterRegistry } from '../src/exploration/center-registry.js';
import { WorldGraph } from '../src/navigation/world-graph.js';

test('recognizes and routes to a discovered nurse-counter layout', () => {
  const graph = new WorldGraph();
  const outside = { map: '0:3:1:314', name: 'Viridian City', x: 10, y: 10, direction: 0 };
  const inside = { map: '0:5:4:303', name: 'Viridian City', x: 7, y: 5, direction: 1 };
  graph.observeStep(outside, 1, inside);
  graph.observeStep(inside, 1, inside);
  const registry = new CenterRegistry();
  const center = registry.observe(graph, inside);
  assert.equal(center.status, 'verified');
  assert.equal(registry.nearestVerified(graph, outside).destination.map, inside.map);
});

test('routes directly out of a known center instead of exploring its walls', () => {
  const graph = new WorldGraph();
  const outside = { map: '0:3:1:314', name: 'Viridian City', x: 26, y: 27, direction: 0 };
  const entrance = { map: '0:5:4:303', name: 'Viridian City', x: 7, y: 8, direction: 1 };
  const nurse = { ...entrance, x: 7, y: 5, direction: 1 };
  graph.observeStep(outside, 1, entrance);
  graph.observeStep(entrance, 1, { ...entrance, y: 7 });
  graph.observeStep({ ...entrance, y: 7 }, 1, { ...entrance, y: 6 });
  graph.observeStep({ ...entrance, y: 6 }, 1, nurse);
  graph.observeStep(nurse, 1, nurse);
  graph.observeStep(entrance, 0, outside);
  const registry = new CenterRegistry();
  registry.observe(graph, nurse);

  const result = registry.leaveRoute(graph, nurse);
  assert.equal(result.destination.x, 7);
  assert.equal(result.destination.y, 8);
  assert.equal(result.route.length, 3);
  assert.equal(result.exitEdge.type, 'warp');
  assert.equal(result.exitEdge.direction, 0);
});

test('uses the verified center layout exit before an outbound warp has been observed', () => {
  const graph = new WorldGraph();
  const entrance = { map: '0:5:4:303', name: 'Viridian City', x: 7, y: 8, direction: 1 };
  const nurse = { ...entrance, y: 5 };
  graph.observeStep(entrance, 1, { ...entrance, y: 7 });
  graph.observeStep({ ...entrance, y: 7 }, 1, { ...entrance, y: 6 });
  graph.observeStep({ ...entrance, y: 6 }, 1, nurse);
  graph.observeStep(nurse, 1, nurse);
  const registry = new CenterRegistry();
  registry.observe(graph, nurse);
  const result = registry.leaveRoute(graph, nurse);
  assert.equal(result.route.length, 3);
  assert.equal(result.exitEdge.type, 'layout_exit');
  assert.equal(result.exitEdge.direction, 0);
});

test('upgrades an older saved center record with its verified exit layout', () => {
  const registry = new CenterRegistry({
    centers: {
      '0:5:4:303': {
        map: '0:5:4:303',
        name: 'Viridian City Pokemon Center',
        healTile: { x: 7, y: 5, direction: 1 },
        status: 'verified',
      },
    },
  });
  assert.deepEqual(registry.centers['0:5:4:303'].exitTile, { x: 7, y: 8, direction: 0 });
});

test('includes the client-confirmed Pewter Center with the shared nurse layout', () => {
  const registry = new CenterRegistry();
  assert.deepEqual(registry.centers['0:6:5:303'].healTile, { x: 7, y: 5, direction: 1 });
  assert.equal(registry.centers['0:6:5:303'].status, 'verified');
});
