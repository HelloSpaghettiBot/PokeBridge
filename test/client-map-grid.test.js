import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClientMapGrid } from '../src/navigation/client-map-grid.js';
import { WorldGraph } from '../src/navigation/world-graph.js';

test('parses authoritative client map tiles and imports routable edges', () => {
  const snapshot = parseClientMapGrid('MAPGRID map=0:3:2:314 name=PEWTER_CITY width=2 height=1 tiles=0,0,2,441,12,8,0,nx1;1,0,2,442,12,4,1,id');
  assert.equal(snapshot.name, 'PEWTER CITY');
  assert.equal(snapshot.tiles[1].grass, true);
  assert.equal(snapshot.tiles[1].kind, 'id');
  const graph = new WorldGraph();
  const result = graph.observeMapGrid(snapshot);
  assert.deepEqual(result, { map: '0:3:2:314', width: 2, height: 1, tiles: 2, grass: 1 });
  assert.equal(graph.route({ map: snapshot.map, x: 0, y: 0 }, { map: snapshot.map, x: 1, y: 0 }).length, 1);
  assert.equal(graph.blocked.has('0:3:2:314@0,0:2'), false);
  assert.ok(graph.maps.get(snapshot.map).staticBlocked.includes('0,0:2'));
});

test('rejects malformed client map payloads', () => {
  assert.throws(() => parseClientMapGrid('NO_MAP'), /Invalid map-grid response/);
  assert.throws(() => parseClientMapGrid('MAPGRID map=x width=2 height=2 tiles=0,0'), /Invalid map tile/);
});
