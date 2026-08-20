import test from 'node:test';
import assert from 'node:assert/strict';
import { KANTO_BADGE_PLAN } from '../src/campaign/kanto-badge-plan.js';
import { KantoBadgeCampaign } from '../src/campaign/kanto-campaign.js';
import { WorldGraph } from '../src/navigation/world-graph.js';

test('Kanto campaign preserves the official eight-gym order', () => {
  assert.deepEqual(KANTO_BADGE_PLAN.map(gym => gym.leader), ['Brock', 'Misty', 'Lt. Surge', 'Erika', 'Koga', 'Sabrina', 'Blaine', 'Giovanni']);
});

test('campaign resumes at the first unconfirmed badge', () => {
  const campaign = new KantoBadgeCampaign({ completedBadges: ['brock', 'misty'], confirmedBadgeCount: 2 });
  assert.equal(campaign.currentGym().id, 'surge');
  assert.equal(campaign.status().badges, 2);
});

test('training gate uses live party levels and never exceeds the gym cap', () => {
  const campaign = new KantoBadgeCampaign();
  campaign.observeParty([{ level: 8, hp: 20 }, { level: 7, hp: 18 }]);
  assert.equal(campaign.trainingState().needed, true);
  campaign.observeParty([{ level: 15, hp: 30 }, { level: 13, hp: 25 }]);
  assert.equal(campaign.trainingState().needed, false);
  campaign.observeParty([{ level: 17, hp: 30 }, { level: 5, hp: 20 }, { level: 4, hp: 18 }]);
  assert.equal(campaign.trainingState().needed, false);
  assert.ok(campaign.currentGym().trainingTarget < campaign.currentGym().levelCap);
});

test('campaign routes to a learned gym landmark', () => {
  const graph = new WorldGraph({
    maps: { route: { name: 'Route 2', visited: ['0,0'] }, pewter: { name: 'Pewter Gym', visited: ['3,4'] } },
    edges: { 'route@0,0': [{ to: 'pewter@3,4', direction: 1, type: 'warp' }] },
  });
  const campaign = new KantoBadgeCampaign();
  const result = campaign.findObjective(graph, { map: 'route', x: 0, y: 0 });
  assert.equal(result.destination.map, 'pewter');
  assert.equal(result.gymMap, true);
  assert.equal(result.route.length, 1);
});

test('campaign recognizes and annotates a gym from its authoritative client map key', () => {
  const graph = new WorldGraph({ maps: {
    city: { name: 'Pewter City', visited: ['1,1'] },
    '0:6:2:275': { name: 'Pewter City', visited: ['6,14'] },
  }, edges: { 'city@1,1': [{ to: '0:6:2:275@6,14', direction: 1, type: 'warp' }] } });
  const campaign = new KantoBadgeCampaign();
  const landmark = campaign.annotateMap(graph, '0:6:2:275');
  assert.equal(landmark.id, 'brock');
  assert.equal(graph.maps.get('0:6:2:275').name, 'Pewter City Gym');
  assert.equal(campaign.isCurrentGymMap(graph, { map: '0:6:2:275', name: 'Pewter City' }), true);
  assert.equal(campaign.findObjective(graph, { map: 'city', name: 'Pewter City', x: 1, y: 1 }).gymMap, true);
  campaign.confirmBadgeCount(1);
  assert.equal(campaign.isCurrentGymMap(graph, { map: '0:6:2:275', name: 'Pewter City Gym' }), false);
});

test('campaign routes to the learned Brock interaction square and facing direction', () => {
  const graph = new WorldGraph({ maps: {
    '0:6:2:275': { name: 'Pewter City Gym', visited: ['6,3', '6,4'] },
  }, edges: { '0:6:2:275@6,3': [{ to: '0:6:2:275@6,4', direction: 0, type: 'walk' }] } });
  const campaign = new KantoBadgeCampaign();
  const route = campaign.findLeaderInteraction(graph, { map: '0:6:2:275', x: 6, y: 3, direction: 0 });
  assert.equal(route.route.length, 1);
  assert.equal(route.direction, 0);
  assert.equal(campaign.findLeaderInteraction(graph, route.destination).route.length, 0);
});

test('campaign prefers a reachable first-gym approach over unrelated frontier', () => {
  const graph = new WorldGraph({
    maps: {
      route1: { name: 'Route 1', visited: ['0,0'] },
      route2: { name: 'Route 2', visited: ['0,0'] },
      forest: { name: 'Viridian Forest', visited: ['0,0'] },
    },
    edges: { 'route1@0,0': [{ to: 'route2@0,0', direction: 1, type: 'warp' }] },
  });
  const campaign = new KantoBadgeCampaign();
  const result = campaign.findApproach(graph, { map: 'route1', x: 0, y: 0 });
  assert.equal(result.destination.map, 'route2');
  assert.equal(result.alias, 'Route 2');
});

test('campaign does not loop from a city back into a same-named non-gym interior', () => {
  const campaign = new KantoBadgeCampaign();
  const graph = new WorldGraph({ maps: {
    city: { name: 'Pewter City', visited: ['1,1'] },
    museum: { name: 'Pewter City', visited: ['2,2'] },
  }, edges: { 'city@1,1': [{ to: 'museum@2,2', direction: 1, type: 'warp' }] } });
  assert.equal(campaign.findApproach(graph, { map: 'city', name: 'Pewter City', x: 1, y: 1, direction: 0 }), null);
});

test('campaign never backtracks below its highest reached milestone', () => {
  const campaign = new KantoBadgeCampaign({ visitedMilestones: ['Route 2', 'Viridian Forest', 'Pewter City'] });
  const graph = new WorldGraph({ maps: {
    route: { name: 'Route 2', visited: ['1,1'] },
    city: { name: 'Pewter City', visited: ['2,2'] },
  }, edges: {
    'city@2,2': [{ to: 'route@1,1', direction: 0, type: 'warp' }],
    'route@1,1': [{ to: 'city@2,2', direction: 1, type: 'warp' }],
  } });
  assert.equal(campaign.findApproach(graph, { map: 'city', name: 'Pewter City', x: 2, y: 2, direction: 0 }), null);
  assert.equal(campaign.findApproach(graph, { map: 'route', name: 'Route 2', x: 1, y: 1, direction: 0 }).destination.map, 'city');
});

test('first-gym exploration advances north on Route 2 and in Viridian Forest', () => {
  const campaign = new KantoBadgeCampaign();
  assert.equal(campaign.preferredExplorationDirection({ name: 'ROUTE 2' }), 1);
  assert.equal(campaign.preferredExplorationDirection({ name: 'VIRIDIAN FOREST' }), 1);
  assert.equal(campaign.preferredExplorationDirection({ name: 'ROUTE 1' }), null);
});

test('Route 2 does not falsely mark Routes 24 or 25 as visited', () => {
  const campaign = new KantoBadgeCampaign();
  campaign.observeWorld({ name: 'ROUTE 2' });
  assert.equal(campaign.visitedMilestones.includes('Route 24'), false);
  assert.equal(campaign.visitedMilestones.includes('Route 25'), false);
});

test('arriving at a gym or fighting does not fabricate badge completion', () => {
  const campaign = new KantoBadgeCampaign();
  campaign.observeWorld({ name: 'Pewter Gym' });
  assert.equal(campaign.status().badges, 0);
  assert.equal(campaign.currentGym().id, 'brock');
  campaign.confirmBadgeCount(1);
  assert.equal(campaign.currentGym().id, 'misty');
});

test('a confirmed Kanto level-cap increase advances the matching badge only', () => {
  const campaign = new KantoBadgeCampaign();
  assert.equal(campaign.confirmLevelCap(20), true);
  assert.equal(campaign.status().badges, 0);
  assert.equal(campaign.confirmLevelCap(26), true);
  assert.equal(campaign.status().badges, 1);
  assert.equal(campaign.currentGym().id, 'misty');
  assert.equal(campaign.confirmLevelCap(999), false);
});

test('campaign prioritizes untried blocked interactions on story maps', () => {
  const graph = new WorldGraph({
    maps: { town: { name: 'Viridian City', visited: ['0,0'] }, forest: { name: 'Viridian Forest', visited: ['1,0'] } },
    edges: { 'town@0,0': [{ to: 'forest@1,0', direction: 1, type: 'warp' }] },
    blocked: ['town@0,0:2', 'forest@1,0:3'],
  });
  const campaign = new KantoBadgeCampaign();
  const action = campaign.nextInteraction(graph, { map: 'town', x: 0, y: 0 });
  assert.equal(action.key, 'forest@1,0:3');
  campaign.markInteraction(action.key);
  assert.notEqual(campaign.nextInteraction(graph, { map: 'town', x: 0, y: 0 }).key, action.key);
});
