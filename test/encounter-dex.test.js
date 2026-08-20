import assert from 'node:assert/strict';
import test from 'node:test';
import { EncounterDex, parseEnemyIdentity } from '../src/exploration/encounter-dex.js';

test('parses the official client enemy identity snapshot', () => {
  assert.deepEqual(parseEnemyIdentity('ENEMY species=Rattata speciesId=19 level=4 hp=3 maxHp=16 ivs=UNKNOWN_PRE_CATCH'), {
    speciesId: 19, species: 'Rattata', level: 4, hp: 3, maxHp: 16, shiny: false, secretShiny: false,
  });
});

test('aggregates empirical levels, tiles, methods, and confidence intervals', () => {
  const dex = new EncounterDex();
  const position = { map: 'route1', name: 'Route 1', x: 13, y: 6 };
  for (let index = 0; index < 10; index += 1) dex.observeStep(position);
  dex.observeEncounter(position, 'ENEMY species=Pidgey speciesId=16 level=3 hp=10 maxHp=10 ivs=UNKNOWN_PRE_CATCH');
  dex.observeEncounter(position, 'ENEMY species=Pidgey speciesId=16 level=5 hp=18 maxHp=18 ivs=UNKNOWN_PRE_CATCH');
  const output = dex.toJSON();
  assert.equal(output.maps.route1.encounterRate, 0.2);
  assert.equal(output.maps.route1.species['16'].levelMin, 3);
  assert.equal(output.maps.route1.species['16'].levelMax, 5);
  assert.equal(output.maps.route1.encounterTiles['13,6'], 2);
  assert.ok(output.maps.route1.encounterRate95.low < 0.2);
});

test('an encounter teaches every observed tile with the same terrain signature', () => {
  const dex = new EncounterDex();
  const grass = { coordinateClass: 'f.eP1', terrainId: 13, behaviorId: 12, signature: 'f.eP1:13:12' };
  const encounterTile = { map: 'forest', name: 'Viridian Forest', x: 21, y: 58 };
  dex.observeTerrain(encounterTile, grass);
  dex.observeTerrain({ ...encounterTile, y: 57 }, grass);
  dex.observeTerrain({ ...encounterTile, x: 20 }, { coordinateClass: 'f.eP1', terrainId: 1, behaviorId: 0, signature: 'f.eP1:1:0' });
  dex.observeEncounter(encounterTile, 'ENEMY species=Weedle speciesId=13 level=5 hp=18 maxHp=18');
  assert.deepEqual(new Set(dex.encounterTerrainTiles('forest')), new Set(['21,58', '21,57']));
  assert.equal(dex.toJSON().maps.forest.species['13'].tiles['21,58'], 1);
});
