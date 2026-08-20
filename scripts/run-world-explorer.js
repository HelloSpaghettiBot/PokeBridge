import { appendFile, mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { chooseBestMove, chooseCatchSlot, chooseTrainerSlot, chooseTrainingSlot } from '../src/battle/party-policy.js';
import { parseLiveParty } from '../src/battle/live-party.js';
import { EncounterDex, parseEnemyIdentity } from '../src/exploration/encounter-dex.js';
import { battleDecision, chooseActivityDestination, chooseConfirmedTerrainStep } from '../src/exploration/activity-policy.js';
import { CenterRegistry } from '../src/exploration/center-registry.js';
import { planFrontier, planMappedExit, planMappedPortal, planMappedSurvey, unexploredDirections } from '../src/exploration/frontier-planner.js';
import { parseClientMapGrid } from '../src/navigation/client-map-grid.js';
import { HumanMovementTiming } from '../src/navigation/human-movement.js';
import { WorldGraph } from '../src/navigation/world-graph.js';
import { parseWorldState, tileKey } from '../src/navigation/world-state.js';
import { decodeBattleServerPacket } from '../src/headless/battle-events.js';
import { KantoBadgeCampaign } from '../src/campaign/kanto-campaign.js';

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const root = path.resolve('.');
const capturePath = path.resolve(option('capture', 'captures/decrypted-gameplay-session2.jsonl'));
const graphPath = path.resolve(option('graph', 'captures/world-graph.json'));
const encounterPath = path.resolve(option('encounters', 'captures/encounter-dex.json'));
const centersPath = path.resolve(option('centers', 'captures/pokemon-centers.json'));
const speciesIndexPath = path.resolve(option('species-index', 'captures/client-species-index.json'));
const statusPath = path.resolve(option('status', 'captures/explorer-status.json'));
const logPath = path.resolve(option('log', 'captures/world-explorer.log'));
const campaignPath = path.resolve(option('campaign', 'captures/kanto-campaign.json'));
const mapViewsPath = path.resolve(option('map-views', 'captures/map-views'));
const port = Number(option('port', '37666'));
const dexPort = Number(option('dex-port', '37667'));
const battlePort = Number(option('battle-port', '37668'));
const huntPort = Number(option('hunt-port', '37671'));
const speciesPort = Number(option('species-port', '37670'));
const clientPid = Number(option('client-pid', '0'));
const mode = String(option('mode', 'explore')).toLowerCase();
const targetSpecies = String(option('target-species', '')).trim();
const levelMin = Number(option('level-min', '1'));
const levelMax = Number(option('level-max', '100'));
const alwaysCatchShiny = String(option('always-catch-shiny', 'true')).toLowerCase() !== 'false';
const stepMs = Number(option('step-ms', '250'));
const trainingSlot = Number(option('training-slot', '0'));
const probeRetries = Number(option('probe-retries', '3'));
const maxMinutes = Number(option('max-minutes', '0'));
const maxMaps = Number(option('max-maps', '0'));

if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid --port');
if (!Number.isInteger(dexPort) || dexPort < 1024 || dexPort > 65535) throw new Error('Invalid --dex-port');
if (!Number.isInteger(battlePort) || battlePort < 1024 || battlePort > 65535) throw new Error('Invalid --battle-port');
if (!Number.isInteger(huntPort) || huntPort < 1024 || huntPort > 65535) throw new Error('Invalid --hunt-port');
if (!Number.isInteger(speciesPort) || speciesPort < 1024 || speciesPort > 65535) throw new Error('Invalid --species-port');
if (!['explore', 'train', 'hunt', 'shiny', 'badges'].includes(mode)) throw new Error('Invalid --mode');
if (!Number.isFinite(levelMin) || !Number.isFinite(levelMax) || levelMin < 1 || levelMax < levelMin) throw new Error('Invalid level range');
if (!Number.isFinite(stepMs) || stepMs < 150 || stepMs > 1500) throw new Error('Invalid --step-ms');
if (!Number.isInteger(trainingSlot) || trainingSlot < 0 || trainingSlot > 6) throw new Error('Invalid --training-slot');
if (!Number.isInteger(probeRetries) || probeRetries < 1 || probeRetries > 8) throw new Error('Invalid --probe-retries');

async function jsonFile(file, fallback = {}) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

function commandAt(commandPort, line, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: commandPort });
    let response = '';
    const timeout = setTimeout(() => socket.destroy(new Error(`Command timeout: ${line}`)), timeoutMs);
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write(`${line}\n`));
    socket.on('data', chunk => {
      response += chunk;
      const newline = response.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timeout);
      socket.end();
      const answer = response.slice(0, newline).trim();
      if (answer.startsWith('OK ')) resolve(answer.slice(3));
      else reject(new Error(answer));
    });
    socket.once('error', error => { clearTimeout(timeout); reject(error); });
  });
}

const command = (line, timeoutMs) => commandAt(port, line, timeoutMs);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const graph = new WorldGraph(await jsonFile(graphPath));
const dex = new EncounterDex(await jsonFile(encounterPath));
const centers = new CenterRegistry(await jsonFile(centersPath));
const campaign = new KantoBadgeCampaign(await jsonFile(campaignPath));
const speciesIndex = await jsonFile(speciesIndexPath, { species: {} });
for (const record of Object.values(speciesIndex.species ?? {})) {
  if (record.locations) dex.mergeClientLocations(record.id, record.locations);
}
const timing = new HumanMovementTiming({ walkCadenceMs: stepMs, pauseEveryMin: 18, pauseEveryMax: 34 });
let offset = (await stat(capturePath)).size;
let remainder = '';
let readingCapture = false;
let stopped = false;
let battle = (await command('STATE')) === 'BATTLE';
let battleReady = battle;
let battleActionPending = false;
let battleCooldownUntil = 0;
let battleGeneration = 0;
let turnReadyAt = 0;
let lastWorld = parseWorldState(await command('WORLD'));
let encounterPosition = lastWorld;
let lastDirection = lastWorld.direction;
let steps = 0;
let blockedProbes = 0;
let battles = 0;
let battleEndedAt = 0;
let battleTransitionAt = 0;
let transitionRecoveryPending = false;
let transitionRecoveryAttempts = 0;
let nextSwitchSlot = 0;
let currentEnemy = null;
let currentTerrain = null;
let battleParty = [];
let activePartySlot = 0;
let battleTrainer = false;
let partyHydration = null;
let smartSwitchUsed = false;
let pendingBattleAction = null;
let lastBattleStatePoll = 0;
let encounterIdentityPending = Promise.resolve();
let encounterAnnounced = false;
const resumedStrongestPartyMember = [...campaign.lastKnownParty]
  .filter(pokemon => Number(pokemon?.level) > 0)
  .sort((left, right) => Number(right.level) - Number(left.level))[0];
let recoveryRequested = mode === 'badges' && Boolean(partyRecoveryReason(resumedStrongestPartyMember));
let recoveryDestination = null;
let lastDestinationKey = '';
let activeFrontierTarget = null;
let stalledWorldKey = '';
let stalledDirections = new Set();
let stalledRouteKey = '';
let stalledRouteCount = 0;
let waitingForTerrainLogged = false;
let lastCampaignProgressCheck = 0;
let routingTargetSpecies = targetSpecies;
let encounters = 0;
let startedAt = Date.now();
let phase = battle ? 'battle' : 'mapping';
let lastError = '';
const unavailableUntil = new Map();
const speciesInfoCache = new Map();
const moveInfoCache = new Map();
const capturedMapViews = new Set();
const campaignNorthmostY = new Map();

function partyRecoveryReason(pokemon) {
  if (!pokemon) return null;
  const hp = Number(pokemon.hp);
  const maxHp = Number(pokemon.maxHp);
  if (hp <= 0) return 'strongest_party_member_fainted';
  if (maxHp > 0 && hp / maxHp <= 0.35) return 'strongest_party_member_low_hp';
  const pp = Object.values(pokemon.movePp ?? {}).map(Number).filter(Number.isFinite);
  if (pp.length && pp.every(value => value <= 0)) return 'strongest_party_member_out_of_pp';
  return null;
}

graph.observe(lastWorld);
centers.observe(graph, lastWorld);
if (mode === 'badges') {
  campaign.observeWorld(lastWorld);
  campaignNorthmostY.set(lastWorld.map, lastWorld.y);
  const strongestKnown = [...campaign.lastKnownParty]
    .filter(pokemon => Number(pokemon?.level) > 0)
    .sort((left, right) => Number(right.level) - Number(left.level))[0];
  if (partyRecoveryReason(strongestKnown)) recoveryRequested = true;
}
try { await observeCurrentTerrain(lastWorld); } catch {}
try { await refreshClientMap('startup'); } catch (error) { lastError = `Client map hook unavailable; using learned routing: ${error.message}`; }

if (targetSpecies && !/^\d+$/.test(targetSpecies)) {
  try {
    const resolved = parseFields(await commandAt(speciesPort, `RESOLVE ${targetSpecies}`));
    if (resolved.SPECIES === true && Number.isInteger(Number(resolved.id))) {
      routingTargetSpecies = String(resolved.id);
      const locations = await clientLocations(Number(resolved.id));
      if (locations) dex.mergeClientLocations(Number(resolved.id), locations);
    }
  } catch (error) {
    lastError = `Species resolution failed: ${error.message}`;
  }
}

async function log(event, details = {}) {
  const record = { timestamp: new Date().toISOString(), event, ...details };
  await appendFile(logPath, `${JSON.stringify(record)}\n`);
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function liveUnavailableEdges() {
  const now = Date.now();
  const result = new Set();
  for (const [edge, until] of unavailableUntil) {
    if (until <= now) unavailableUntil.delete(edge);
    else result.add(edge);
  }
  return result;
}

function planNorthernFrontier() {
  if (mode !== 'badges' || campaign.preferredExplorationDirection(lastWorld) !== 1) return null;
  const map = graph.maps.get(lastWorld.map);
  let best = null;
  for (const coordinate of map?.visited ?? []) {
    const [x, y] = coordinate.split(',').map(Number);
    if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
    const position = { map: lastWorld.map, name: lastWorld.name, x, y, direction: lastWorld.direction };
    const directions = unexploredDirections(graph, position);
    // Badge approach mapping is directional. Once north has been tested at a
    // tile, do not spend the smoke run exhaustively probing every lateral
    // adjacency there; continue to the next reachable northern frontier.
    if (!directions.includes(1)) continue;
    const route = graph.route(lastWorld, position);
    if (!route) continue;
    const direction = 1;
    const score = y * 10000 + route.length;
    if (!best || score < best.score) {
      best = route.length
        ? { kind: 'route', direction: route[0].direction, target: tileKey(position), distance: route.length, route, score }
        : { kind: 'probe', direction, target: tileKey(position), distance: 0, score };
    }
  }
  return best;
}

async function persist() {
  await Promise.all([
    writeFile(graphPath, `${JSON.stringify(graph.toJSON(), null, 2)}\n`),
    writeFile(encounterPath, `${JSON.stringify(dex.toJSON(), null, 2)}\n`),
    writeFile(centersPath, `${JSON.stringify(centers.toJSON(), null, 2)}\n`),
    ...(mode === 'badges' ? [writeFile(campaignPath, `${JSON.stringify(campaign.toJSON(), null, 2)}\n`)] : []),
    writeFile(statusPath, `${JSON.stringify({
      version: 1,
      running: !stopped,
      phase,
      activity: { mode, targetSpecies, resolvedSpeciesId: routingTargetSpecies === targetSpecies ? null : Number(routingTargetSpecies), levelMin, levelMax, alwaysCatchShiny, trainingSlot },
      enemy: currentEnemy,
      party: battleParty,
      campaign: mode === 'badges' ? campaign.status() : null,
      recoveryRequested,
      startedAt: new Date(startedAt).toISOString(),
      updatedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      world: lastWorld,
      terrain: currentTerrain,
      confirmedEncounterTerrainTiles: dex.encounterTerrainTiles(lastWorld.map).length,
      totals: { steps, blockedProbes, encounters, battles, maps: graph.maps.size, tiles: [...graph.maps.values()].reduce((sum, map) => sum + (map.visited?.length ?? 0), 0), pokemonCenters: Object.keys(centers.centers).length, speciesIndexed: Object.keys(speciesIndex.species ?? {}).length },
      lastError,
      files: { graph: graphPath, encounters: encounterPath, campaign: mode === 'badges' ? campaignPath : null, log: logPath },
    }, null, 2)}\n`),
  ]);
}

async function settledWorld() {
  let world = parseWorldState(await command('WORLD'));
  for (let attempt = 0; attempt < 12 && world.map.endsWith(':-1'); attempt += 1) {
    await delay(250);
    world = parseWorldState(await command('WORLD'));
  }
  return world;
}

async function clientLocations(speciesId) {
  try {
    const response = await commandAt(dexPort, `LOOKUP ${speciesId}`, 2000);
    if (!response.startsWith('DEX_B64 ')) return null;
    return JSON.parse(Buffer.from(response.slice(8), 'base64').toString('utf8'));
  } catch (error) {
    await log('client_dex_unavailable', { speciesId, message: error.message });
    return null;
  }
}

function parseFields(text) {
  return Object.fromEntries(String(text).split(/\s+/).map(part => {
    const index = part.indexOf('=');
    return index < 0 ? [part, true] : [part.slice(0, index), part.slice(index + 1)];
  }));
}

function parseTileTelemetry(text) {
  const value = parseFields(text);
  if (value.TILE !== true || !value.signature) return null;
  const terrainId = Number(value.terrainId);
  const behaviorId = Number(value.behaviorId);
  return {
    coordinateClass: String(value.class ?? ''),
    terrainId: Number.isInteger(terrainId) ? terrainId : null,
    behaviorId: Number.isInteger(behaviorId) ? behaviorId : null,
    signature: String(value.signature),
  };
}

async function refreshClientMap(source) {
  const snapshot = parseClientMapGrid(await command('MAPGRID', 10000));
  if (snapshot.map !== lastWorld.map) throw new Error(`Map snapshot ${snapshot.map} does not match world ${lastWorld.map}`);
  const imported = graph.observeMapGrid(snapshot);
  if (mode === 'badges') {
    const landmark = campaign.annotateMap(graph, snapshot.map);
    if (landmark) await log('campaign_map_identified', { map: snapshot.map, kind: 'gym', gymId: landmark.id, leader: landmark.leader });
  }
  await log('client_map_imported', { source, ...imported });
  return imported;
}

async function observeCurrentTerrain(position) {
  const telemetry = parseTileTelemetry(await command('TILE'));
  if (!telemetry) return null;
  currentTerrain = telemetry;
  dex.observeTerrain(position, telemetry);
  return telemetry;
}

async function refreshCampaignProgress(force = false) {
  if (mode !== 'badges' || battle || (!force && Date.now() - lastCampaignProgressCheck < 15000)) return false;
  lastCampaignProgressCheck = Date.now();
  let response;
  response = await command('PROGRESS');
  if (/UNKNOWN/i.test(response)) throw new Error('Authoritative badge memory is not calibrated for this client revision');
  const match = String(response ?? '').match(/levelCap=(\d+)/i);
  if (!match) return false;
  const before = campaign.status().badges;
  const accepted = campaign.confirmLevelCap(Number(match[1]));
  if (accepted && campaign.status().badges !== before) {
    await log('kanto_badge_confirmed', { levelCap: Number(match[1]), badgesBefore: before, badgesAfter: campaign.status().badges, nextGym: campaign.currentGym()?.leader ?? null });
  }
  return accepted;
}

function liveEnemy(text) {
  const enemy = parseEnemyIdentity(text);
  if (!enemy) return null;
  const raw = parseFields(text);
  enemy.shiny = String(raw.shiny).toLowerCase() === 'true';
  enemy.secretShiny = String(raw.secretShiny).toLowerCase() === 'true';
  enemy.wild = raw.wild === undefined ? true : String(raw.wild).toLowerCase() === 'true';
  return enemy;
}

async function inventoryBalls() {
  const inventory = await command('INVENTORY');
  return inventory.split('|').slice(1).reduce((sum, entry) => {
    const [, quantity, name = ''] = entry.split(':');
    return /ball/i.test(name) ? sum + Number(quantity || 0) : sum;
  }, 0);
}

async function verifyBallUse(before, generation) {
  for (let attempt = 0; attempt < 14; attempt += 1) {
    await delay(450);
    if (!battle || generation !== battleGeneration || (await command('STATE')) !== 'BATTLE') return 'battle_transitioned';
    if (await inventoryBalls() < before) return 'inventory_decreased';
  }
  throw new Error('Poke Ball selection was not accepted by the client');
}

async function pressActionKey(repeat = 1, durationMs = 120, betweenMs = 120) {
  try { return await commandAt(huntPort, `KEY A ${repeat} ${durationMs} ${betweenMs}`, Math.max(3000, repeat * (durationMs + betweenMs) + 1500)); }
  catch { return command(`KEY A ${repeat} ${durationMs} ${betweenMs}`, Math.max(3000, repeat * (durationMs + betweenMs) + 1500)); }
}

async function pressCancelKey(repeat = 1, durationMs = 120, betweenMs = 120) {
  try { return await commandAt(huntPort, `KEY B ${repeat} ${durationMs} ${betweenMs}`, Math.max(3000, repeat * (durationMs + betweenMs) + 1500)); }
  catch { return command(`KEY B ${repeat} ${durationMs} ${betweenMs}`, Math.max(3000, repeat * (durationMs + betweenMs) + 1500)); }
}

async function captureMapView(position) {
  // Intentionally empty: mapping is derived only from authoritative memory
  // grids and packet-confirmed movement, never screenshots.
}

async function identifyEncounter() {
  try {
    await delay(450);
    try { await observeCurrentTerrain(encounterPosition); }
    catch (error) { await log('terrain_identify_error', { message: error.message }); }
    let identityText;
    try { identityText = await commandAt(huntPort, 'ENEMY'); }
    catch { identityText = await command('IDENTIFY'); }
    const identity = dex.observeEncounter(encounterPosition, identityText, 'Walk');
    if (!identity) return log('identify_unparsed', { identityText });
    currentEnemy = liveEnemy(identityText) ?? identity;
    try {
      const liveParty = parseLiveParty(await commandAt(huntPort, 'PARTY'));
      if (liveParty.length) {
        battleParty = liveParty;
        if (mode === 'badges') campaign.observeParty(liveParty);
        battleTrainer = currentEnemy.wild === false;
        partyHydration = null;
        await log('party_identified', { party: liveParty });
      }
    } catch (error) {
      await log('party_identify_error', { message: error.message });
    }
    const locations = await clientLocations(identity.speciesId);
    if (locations) dex.mergeClientLocations(identity.speciesId, locations);
    await log('enemy_identified', { map: encounterPosition.map, x: encounterPosition.x, y: encounterPosition.y, ...currentEnemy, clientLocationCount: locations?.locations?.length ?? 0, clientLocationCached: locations?.cached ?? false });
    await persist();
  } catch (error) {
    await log('identify_error', { message: error.message });
  }
}

async function speciesInfo(speciesId) {
  if (!speciesInfoCache.has(speciesId)) speciesInfoCache.set(speciesId, (async () => {
    const fields = parseFields(await commandAt(speciesPort, `INFO ${speciesId}`));
    return { species: String(fields.name ?? `Species_${speciesId}`).replaceAll('_', ' '), types: String(fields.types ?? '').split(',').filter(Boolean).map(type => type.replaceAll('_', ' ')) };
  })().catch(() => ({ species: `Species #${speciesId}`, types: [] })));
  return speciesInfoCache.get(speciesId);
}

async function moveInfo(moveId) {
  if (!moveInfoCache.has(moveId)) moveInfoCache.set(moveId, (async () => {
    const fields = parseFields(await commandAt(huntPort, `MOVEINFO ${moveId}`));
    return { id: moveId, name: String(fields.name ?? `Move_${moveId}`).replaceAll('_', ' '), power: Number(fields.power ?? 0), type: String(fields.type ?? 'Unknown').replaceAll('_', ' ') };
  })().catch(() => ({ id: moveId, name: `Move ${moveId}`, power: 0, type: 'Unknown' })));
  return moveInfoCache.get(moveId);
}

async function hydratedBattleParty() {
  if (!partyHydration) partyHydration = Promise.all(battleParty.map(async pokemon => {
    const species = await speciesInfo(pokemon.speciesId);
    const moveDetails = await Promise.all((pokemon.moves ?? []).map(moveInfo));
    return { ...pokemon, ...species, moveDetails };
  }));
  return partyHydration;
}

async function maybeSmartSwitch(decision) {
  if (recoveryRequested || smartSwitchUsed || battleParty.length < 2) return null;
  const party = await hydratedBattleParty();
  const enemySpecies = await speciesInfo(currentEnemy.speciesId);
  const enemy = { ...currentEnemy, types: enemySpecies.types };
  let slot = -1;
  let reason = '';
  if (currentEnemy.wild === false || battleTrainer) {
    slot = chooseTrainerSlot(party, activePartySlot, enemy);
    reason = 'trainer_type_advantage';
  } else if (decision.action === 'weaken') {
    slot = chooseCatchSlot(party, activePartySlot, enemy);
    reason = 'catch_safe_attacker';
  } else if (mode === 'train' || (mode === 'badges' && campaign.trainingState().needed)) {
    slot = chooseTrainingSlot(party, activePartySlot, trainingSlot);
    reason = trainingSlot > 0 ? 'selected_exp_trainee' : 'lowest_level_exp_trainee';
  }
  smartSwitchUsed = true;
  if (slot < 0 || slot === activePartySlot) return null;
  const response = await commandAt(huntPort, `SWITCH ${slot}`);
  activePartySlot = slot;
  battleParty = party;
  return { response, slot, reason, pokemon: party[slot] };
}

async function battleAction() {
  if (!battle || !battleReady || battleActionPending || Date.now() < battleCooldownUntil || Date.now() - turnReadyAt < 800) return;
  const generation = battleGeneration;
  battleActionPending = true;
  battleReady = false;
  try {
    await encounterIdentityPending;
    if ((await command('STATE')) !== 'BATTLE' || !battle || generation !== battleGeneration) return;
    const refreshed = liveEnemy(await commandAt(huntPort, 'ENEMY'));
    if (!refreshed || refreshed.hp <= 0) return;
    currentEnemy = refreshed;
    if (!battleParty.length || mode === 'badges') {
      try {
        const liveParty = parseLiveParty(await commandAt(huntPort, 'PARTY'));
        if (liveParty.length) {
          const changed = JSON.stringify(liveParty) !== JSON.stringify(battleParty);
          battleParty = liveParty;
          partyHydration = null;
          if (mode === 'badges') campaign.observeParty(liveParty);
          if (changed) await log('party_identified', { party: liveParty });
        }
      } catch (error) {
        await log('party_identify_error', { message: error.message });
      }
    }
    try {
      const own = parseFields(await commandAt(huntPort, 'OWN'));
      if (own.NO_OWN_POKEMON === true || (own.OWN === true && Number(own.hp) <= 0)) {
        const response = await switchToHealthyPartyMember();
        pendingBattleAction = null;
        battleReady = true;
        turnReadyAt = Date.now() - 800;
        battleCooldownUntil = Date.now() + 1200;
        await log('forced_party_switch', { response, detectedBy: 'live_own_state' });
        return;
      }
    } catch (error) {
      await log('active_party_probe_error', { message: error.message });
    }
    const balls = await inventoryBalls();
    const decision = battleDecision({ mode, enemy: currentEnemy, targetSpecies, balls, alwaysCatchShiny });
    if ((await command('STATE')) !== 'BATTLE' || !battle || generation !== battleGeneration) return;
    const smartSwitch = await maybeSmartSwitch(decision);
    if (smartSwitch) {
      battleCooldownUntil = Date.now() + 1200;
      await log('smart_party_switch', smartSwitch);
      // Switch packets are advisory on some live client revisions. Continue
      // with the actual active creature if the server does not acknowledge it.
      battleReady = true;
      turnReadyAt = Date.now() - 800;
      return;
    }
    let response;
    if (currentEnemy?.wild === false) {
      const party = await hydratedBattleParty();
      const enemySpecies = await speciesInfo(currentEnemy.speciesId);
      const active = party[activePartySlot] ?? party.find(pokemon => Number(pokemon?.hp) > 0);
      const selected = chooseBestMove(active, { ...currentEnemy, types: enemySpecies.types });
      response = await commandAt(huntPort, 'TRAINER');
      phase = 'trainer_battle';
    } else if (recoveryRequested) {
      response = await commandAt(huntPort, 'RUN');
      phase = 'fleeing_for_recovery';
      battleReady = true;
      battleCooldownUntil = Date.now() + 1800;
      await log('battle_run_attempt', { response, reason: 'routing_to_recovery', enemy: currentEnemy });
      return;
    } else if (decision.action === 'catch') {
      await commandAt(huntPort, 'CATCH');
      const verified = await verifyBallUse(balls, generation);
      response = `CATCH_UI species=${currentEnemy?.species?.replaceAll(' ', '_')} ballsBefore=${balls} verified=${verified} reason=${decision.reason}`;
    } else {
      response = await commandAt(huntPort, decision.action === 'weaken' ? 'WEAKEN' : 'AUTO');
    }
    if (response.startsWith('NO_ACTIVE_POKEMON')) {
      response = await switchToHealthyPartyMember();
      pendingBattleAction = null;
      battleReady = true;
      turnReadyAt = Date.now() - 800;
      battleCooldownUntil = Date.now() + 1200;
      await log('forced_party_switch', { response });
    } else if (response.startsWith('NO_DAMAGE_PP')) {
      if (currentEnemy?.wild === false) {
        response = await commandAt(huntPort, 'TRAINER');
        await log('trainer_fallback_action', { response });
        battleCooldownUntil = Date.now() + 650;
        return;
      }
      recoveryRequested = true;
      phase = 'fleeing_for_recovery';
      response = await commandAt(huntPort, 'RUN');
      await log('pp_exhausted', { action: response });
    } else {
      battleCooldownUntil = Date.now() + 650;
      await log('battle_action', { response, decision, balls, enemy: currentEnemy });
      const moveId = Number(/\bmoveId=(\d+)/.exec(response)?.[1]);
      if (response.startsWith('AUTO_MOVE') && Number.isInteger(moveId)) {
        pendingBattleAction = {
          generation,
          moveId,
          enemyHp: currentEnemy.hp,
          verifyAt: Date.now() + 3000,
          uiAttempts: 0,
        };
      }
    }
  } catch (error) {
    battleReady = true;
    battleCooldownUntil = Date.now() + 1500;
    lastError = error.message;
    await log('battle_action_error', { message: error.message });
  } finally {
    battleActionPending = false;
  }
}

async function verifyPendingBattleAction() {
  if (!battle) { pendingBattleAction = null; return; }
  const pending = pendingBattleAction;
  if (!pending || Date.now() < pending.verifyAt) return;
  if ((await command('STATE')) !== 'BATTLE') {
    pendingBattleAction = null;
    await completeBattle();
    return;
  }
  if (!battle || pendingBattleAction !== pending) return;
  // A faint can arrive while an earlier move is still awaiting acknowledgement.
  // Detect it before retrying that move; otherwise UI fallback clicks operate on
  // the mandatory party picker and the battle can never advance.
  try {
    const own = parseFields(await commandAt(huntPort, 'OWN'));
    if (!battle || pendingBattleAction !== pending) return;
    if (own.NO_OWN_POKEMON === true || (own.OWN === true && Number(own.hp) <= 0)) {
      const liveParty = parseLiveParty(await commandAt(huntPort, 'PARTY'));
      if (liveParty.length) {
        battleParty = liveParty;
        partyHydration = null;
        if (mode === 'badges') campaign.observeParty(liveParty);
      }
      pendingBattleAction = null;
      const response = await switchToHealthyPartyMember();
      battleReady = true;
      turnReadyAt = Date.now() - 800;
      battleCooldownUntil = Date.now() + 1200;
      await log('forced_party_switch', { response, detectedBy: 'pending_move_verification' });
      return;
    }
  } catch (error) {
    await log('active_party_probe_error', { message: error.message, source: 'pending_move_verification' });
  }
  let enemy = null;
  try { enemy = liveEnemy(await commandAt(huntPort, 'ENEMY')); } catch {}
  if (!battle || pendingBattleAction !== pending) return;
  if (!enemy || enemy.hp <= 0) {
    pendingBattleAction = null;
    battleTransitionAt = Date.now();
    await log('battle_action_verified', { method: 'live_enemy_state', enemy });
    return;
  }
  if (enemy.hp < pending.enemyHp) {
    pendingBattleAction = null;
    battleReady = true;
    turnReadyAt = Date.now() - 800;
    await log('battle_action_verified', { method: 'live_enemy_state', enemy });
    return;
  }
  if (pending.uiAttempts >= 2) {
    pending.verifyAt = Date.now() + 5000;
    await log('battle_action_unacknowledged', { moveId: pending.moveId, enemy });
    return;
  }
  const fallback = await commandAt(huntPort, 'AUTO');
  pending.uiAttempts += 1;
  pending.verifyAt = Date.now() + 4500;
  phase = 'battle_packet_retry';
  await log('battle_packet_retry', { fallback, attempt: pending.uiAttempts, enemy });
}

async function pollBattleState() {
  if (!battle || Date.now() - lastBattleStatePoll < 1000) return;
  lastBattleStatePoll = Date.now();
  if ((await command('STATE')) !== 'BATTLE') await completeBattle();
}

async function switchToHealthyPartyMember() {
  const knownSlot = battleParty.findIndex((pokemon, slot) => slot !== activePartySlot && Number(pokemon?.hp) > 0);
  if (knownSlot >= 0) {
    const packetResponse = await commandAt(huntPort, `SWITCH ${knownSlot}`);
    activePartySlot = knownSlot;
    await delay(700);
    try {
      const own = parseFields(await commandAt(huntPort, 'OWN'));
      if (own.OWN === true && Number(own.hp) > 0) {
        return `SWITCHED slot=${knownSlot} speciesId=${battleParty[knownSlot].speciesId} hp=${own.hp} via=packet response=${packetResponse}`;
      }
    } catch {}
    return `SWITCH_SENT slot=${knownSlot} speciesId=${battleParty[knownSlot].speciesId} hp=${battleParty[knownSlot].hp}`;
  }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const slot = nextSwitchSlot++ % 6;
    await commandAt(huntPort, `SWITCH ${slot}`);
    activePartySlot = slot;
    await delay(1100);
    try {
      const own = parseFields(await commandAt(huntPort, 'OWN'));
      if (own.OWN === true && Number(own.hp) > 0) return `SWITCHED slot=${slot} species=${own.species} hp=${own.hp}`;
    } catch {}
  }
  return 'NO_HEALTHY_PARTY_MEMBER';
}

async function packet(record) {
  if (record.type !== 'plain_packet' || record.direction !== 'server_to_client') return;
  if (record.opcode === 48) {
    encounterAnnounced = true;
    battle = true;
    battleGeneration += 1;
    battleReady = false;
    battleTransitionAt = 0;
    transitionRecoveryAttempts = 0;
    phase = 'encounter';
    try {
      const bytes = Buffer.from(record.dataHex, 'hex');
      const event = decodeBattleServerPacket(record.opcode, bytes.subarray(3));
      battleParty = event?.party ?? [];
      battleTrainer = Boolean(event?.trainerBattle);
    } catch {
      battleParty = [];
      battleTrainer = false;
    }
    activePartySlot = 0;
    partyHydration = null;
    smartSwitchUsed = false;
    try {
      encounterPosition = await settledWorld();
      lastWorld = encounterPosition;
    } catch {
      encounterPosition = lastWorld;
    }
    encounters += 1;
    await log('encounter', { map: lastWorld.map, name: lastWorld.name, x: lastWorld.x, y: lastWorld.y });
    currentEnemy = null;
    encounterIdentityPending = identifyEncounter();
  } else if (record.opcode === 50) {
    if (!battle && Date.now() - battleEndedAt < 2000) {
      await log('stale_turn_ignored');
      return;
    }
    if (!encounterAnnounced) {
      encounterAnnounced = true;
      try {
        encounterPosition = await settledWorld();
        lastWorld = encounterPosition;
      } catch {
        encounterPosition = lastWorld;
      }
      encounters += 1;
      await log('encounter_recovered_from_turn', { map: lastWorld.map, name: lastWorld.name, x: lastWorld.x, y: lastWorld.y });
      currentEnemy = null;
      encounterIdentityPending = identifyEncounter();
    }
    battle = true;
    battleReady = true;
    pendingBattleAction = null;
    battleTransitionAt = 0;
    transitionRecoveryAttempts = 0;
    turnReadyAt = Date.now();
    phase = 'battle';
  } else if (record.opcode === 49) {
    battleGeneration += 1;
    battleReady = false;
    phase = 'battle_transition';
    await log('battle_boundary');
    await delay(2200);
    if ((await command('STATE')) === 'BATTLE') {
      battle = true;
      battleTransitionAt = Date.now();
      transitionRecoveryAttempts = 0;
      await log('battle_continues', { reason: 'next_opponent_failed_catch_or_modal' });
    } else {
      await completeBattle();
    }
  }
}

async function completeBattle() {
  if (!battle && phase !== 'battle_transition') return;
  battle = false;
  battleReady = false;
  battleGeneration += 1;
  battleEndedAt = Date.now();
  battleTransitionAt = 0;
  transitionRecoveryAttempts = 0;
  pendingBattleAction = null;
  battles += 1;
  await log('battle_end', { battles });
  if (mode === 'badges' && battleParty.length) {
    const strongestKnown = [...battleParty]
      .filter(pokemon => Number(pokemon?.level) > 0)
      .sort((left, right) => Number(right.level) - Number(left.level))[0];
    const reason = partyRecoveryReason(strongestKnown);
    if (reason) {
      recoveryRequested = true;
      await log('campaign_recovery_required', {
        reason,
        slot: strongestKnown.slot,
        speciesId: strongestKnown.speciesId,
        level: strongestKnown.level,
      });
    }
  }
  currentEnemy = null;
  battleParty = [];
  battleTrainer = false;
  encounterAnnounced = false;
  partyHydration = null;
  try { lastWorld = await settledWorld(); } catch {}
  phase = recoveryRequested ? 'routing_to_center' : 'mapping';
  try { await refreshCampaignProgress(true); } catch (error) { await log('campaign_progress_error', { message: error.message }); }
  await persist();
}

async function recoverStalledBattleUi() {
  if (transitionRecoveryPending || !battleTransitionAt || Date.now() - battleTransitionAt < 3500) return;
  transitionRecoveryPending = true;
  try {
    try {
      const nextEnemy = liveEnemy(await commandAt(huntPort, 'ENEMY'));
      if (nextEnemy?.hp > 0 && (nextEnemy.speciesId !== currentEnemy?.speciesId || currentEnemy?.hp <= 0)) {
        currentEnemy = nextEnemy;
        battleTransitionAt = 0;
        transitionRecoveryAttempts = 0;
        pendingBattleAction = null;
        battleReady = true;
        turnReadyAt = Date.now() - 800;
        phase = 'trainer_battle';
        await log('trainer_next_opponent', { enemy: nextEnemy });
        return;
      }
    } catch {}
    transitionRecoveryAttempts += 1;
    phase = 'settling_post_battle_animation';
    await log('battle_result_prompt', {
      action: 'allow_evolution_and_advance_text',
      attempt: transitionRecoveryAttempts,
    });
    // Never send Cancel from this generic post-battle recovery path. PokeMMO
    // uses Cancel to abort an evolution, and elapsed time cannot reliably
    // distinguish an evolution from an optional move-replacement prompt.
    // Confirm is safe for battle text and lets evolution finish naturally.
    await pressActionKey();
    await delay(5000);
    if ((await command('STATE')) === 'OVERWORLD') {
      await completeBattle();
    } else {
      battleTransitionAt = Date.now();
    }
  } catch (error) {
    lastError = error.message;
    battleTransitionAt = Date.now();
    await log('battle_ui_recovery_error', { message: error.message });
  } finally {
    transitionRecoveryPending = false;
  }
}

function centerTarget() {
  return centers.nearestVerified(graph, lastWorld)?.destination ?? null;
}

async function recoverAtCenter() {
  phase = 'healing_at_center';
  await log('center_heal_started', { world: lastWorld });
  await pressActionKey(6, 120, 1900);
  await delay(3500);
  if (mode === 'badges' && campaign.lastKnownParty.length) {
    campaign.observeParty(campaign.lastKnownParty.map(pokemon => ({
      ...pokemon,
      hp: Number(pokemon.maxHp) > 0 ? Number(pokemon.maxHp) : Number(pokemon.hp),
    })));
    await log('campaign_party_restored', { reason: 'pokemon_center_heal' });
  }
  recoveryRequested = false;
  recoveryDestination = null;
  lastError = '';
  phase = 'mapping';
  await log('center_heal_complete');
}

async function policyMove() {
  if (recoveryRequested) {
    recoveryDestination ??= centerTarget();
    if (!recoveryDestination) {
      const recoveryExit = planMappedExit(graph, lastWorld, {
        unavailableEdges: liveUnavailableEdges(), allowGym: true,
      });
      if (recoveryExit?.route?.length) return {
        direction: recoveryExit.route[0].direction, expectedEdge: recoveryExit.route[0], phase: 'leaving_for_recovery',
      };
      if (recoveryExit?.kind === 'probe') return { direction: recoveryExit.direction, probe: true, phase: 'leaving_for_recovery' };
      return null;
    }
    if (lastWorld.map === recoveryDestination.map && lastWorld.x === recoveryDestination.x && lastWorld.y === recoveryDestination.y) {
      await recoverAtCenter();
      return { handled: true };
    }
    const route = graph.route(lastWorld, recoveryDestination);
    if (route?.length) return { direction: route[0].direction, expectedEdge: route[0], phase: 'routing_to_center' };
    return null;
  }
  const centerExit = centers.leaveRoute(graph, lastWorld);
  if (centerExit) {
    if (centerExit.route.length) {
      return { direction: centerExit.route[0].direction, expectedEdge: centerExit.route[0], phase: 'leaving_pokemon_center' };
    }
    return { direction: centerExit.exitEdge.direction, expectedEdge: centerExit.exitEdge.type === 'warp' ? centerExit.exitEdge : null, phase: 'leaving_pokemon_center' };
  }
  if (mode === 'badges') {
    const mappedExit = campaign.isCurrentGymMap(graph, lastWorld)
      ? null : planMappedExit(graph, lastWorld, { unavailableEdges: liveUnavailableEdges() });
    if (mappedExit?.route?.length) {
      return { direction: mappedExit.route[0].direction, expectedEdge: mappedExit.route[0], phase: 'leaving_non_gym_interior' };
    }
    if (mappedExit?.kind === 'probe') return { direction: mappedExit.direction, probe: true, phase: 'probing_return_portal' };
    const leaderInteraction = campaign.findLeaderInteraction(graph, lastWorld);
    if (leaderInteraction?.route?.length) return {
      direction: leaderInteraction.route[0].direction,
      expectedEdge: leaderInteraction.route[0],
      phase: 'routing_to_gym_leader',
    };
    if (leaderInteraction?.route?.length === 0) {
      phase = 'challenging_gym_leader';
      await command(`MOVE ${leaderInteraction.direction}`);
      await delay(350);
      await pressActionKey(4, 120, 550);
      await delay(1800);
      if ((await command('STATE')) === 'BATTLE') {
        battle = true;
        battleReady = true;
        turnReadyAt = Date.now() - 800;
        phase = 'gym_leader_battle';
        void battleAction();
      }
      return { handled: true };
    }
    const campaignStatus = campaign.status();
    if (campaignStatus.complete) {
      phase = 'kanto_badges_complete';
      await delay(700);
      return { handled: true };
    }
    if (!campaignStatus.training.needed) {
      const objective = campaign.findObjective(graph, lastWorld);
      if (objective?.route?.length) {
        phase = objective.gymMap ? 'routing_to_next_gym' : 'routing_to_next_gym_city';
        return { direction: objective.route[0].direction, expectedEdge: objective.route[0], phase };
      }
      if (objective?.route?.length === 0 && objective.gymMap) {
        phase = 'mapping_current_gym';
        return null;
      }
      const approach = campaign.findApproach(graph, lastWorld);
      if (approach?.route?.length) {
        phase = 'routing_to_badge_approach';
        return { direction: approach.route[0].direction, expectedEdge: approach.route[0], phase };
      }
      const preferredDirection = campaign.preferredExplorationDirection(lastWorld);
      const northmostY = campaignNorthmostY.get(lastWorld.map) ?? lastWorld.y;
      if (preferredDirection !== null && lastWorld.y <= northmostY
        && !graph.blocked.has(`${tileKey(lastWorld)}:${preferredDirection}`)) {
        const expectedEdge = (graph.edges.get(tileKey(lastWorld)) ?? [])
          .find(edge => edge.direction === preferredDirection && edge.type !== 'warp');
        phase = 'advancing_to_first_gym';
        return { direction: preferredDirection, expectedEdge, probe: !expectedEdge, phase };
      }
      phase = 'mapping_route_to_next_gym';
      return null;
    }
    const target = campaignStatus.training.targetLevel;
    const strongest = Number(campaignStatus.training.strongestLevel);
    const trainingMin = Number.isFinite(strongest) && strongest > 0
      ? Math.max(1, Math.min(target - 6, strongest - 2))
      : 1;
    const selectedTraining = chooseActivityDestination({
      graph, dex, current: lastWorld, mode: 'train', targetSpecies: '',
      levelMin: trainingMin, levelMax: target,
    });
    if (selectedTraining) return activityMove(selectedTraining, 'badge_training', trainingMin, target);
    phase = 'mapping_better_training_area';
    return null;
  }
  const selected = chooseActivityDestination({ graph, dex, current: lastWorld, mode, targetSpecies: routingTargetSpecies, levelMin, levelMax });
  if (!selected) {
    if (['hunt', 'shiny', 'train'].includes(mode)) {
      phase = 'waiting_for_confirmed_encounter_terrain';
      if (!waitingForTerrainLogged) {
        waitingForTerrainLogged = true;
        await log('waiting_for_confirmed_encounter_terrain', { mode, map: lastWorld.map, name: lastWorld.name });
      }
      await delay(700);
      return { handled: true };
    }
    return null;
  }
  return activityMove(selected, mode === 'train' ? 'training' : 'hunting', levelMin, levelMax);
}

async function activityMove(selected, localPhase, selectedLevelMin, selectedLevelMax) {
  waitingForTerrainLogged = false;
  if (selected.route.length === 0) {
    const edge = chooseConfirmedTerrainStep({ graph, current: lastWorld, terrainTiles: selected.terrainTiles });
    if (edge) {
      return { direction: edge.direction, expectedEdge: edge, phase: localPhase };
    }
    phase = 'waiting_on_confirmed_encounter_terrain';
    await delay(700);
    return { handled: true };
  }
  const key = tileKey(selected.destination);
  if (key !== lastDestinationKey) {
    lastDestinationKey = key;
    await log('activity_destination', { mode, targetSpecies, levelMin: selectedLevelMin, levelMax: selectedLevelMax, destination: key, mapName: selected.mapName, confirmedTerrainTiles: selected.terrainTiles.length });
  }
  return { direction: selected.route[0].direction, expectedEdge: selected.route[0], phase: 'routing_to_training_area' };
}

async function tryCampaignInteraction() {
  const interaction = campaign.nextInteraction(graph, lastWorld);
  if (!interaction) return false;
  if (interaction.route.length) {
    phase = 'routing_to_story_interaction';
    await move(interaction.route[0].direction, { expectedEdge: interaction.route[0] });
    return true;
  }
  phase = interaction.gymMap ? 'probing_gym_interaction' : 'probing_story_interaction';
  await command(`MOVE ${interaction.direction}`);
  await delay(350);
  campaign.markInteraction(interaction.key);
  await log('campaign_interaction_probe', { key: interaction.key, world: lastWorld, gymMap: interaction.gymMap, storyMap: interaction.storyMap });
  await pressActionKey(4, 120, 550);
  await delay(1800);
  try { lastWorld = await settledWorld(); campaign.observeWorld(lastWorld); } catch {}
  await persist();
  return true;
}

async function readCapture() {
  if (readingCapture) return;
  readingCapture = true;
  try {
    const currentSize = (await stat(capturePath)).size;
    if (currentSize < offset) { offset = 0; remainder = ''; }
    if (currentSize === offset) return;
    const length = currentSize - offset;
    const buffer = Buffer.alloc(length);
    const file = await open(capturePath, 'r');
    try { await file.read(buffer, 0, length, offset); }
    finally { await file.close(); }
    offset = currentSize;
    const lines = (remainder + buffer.toString('utf8')).split(/\r?\n/);
    remainder = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) {
      try { await packet(JSON.parse(line)); }
      catch (error) { await log('capture_parse_error', { message: error.message }); }
    }
  } finally { readingCapture = false; }
}

async function move(direction, { probe, expectedEdge } = {}) {
  const before = lastWorld;
  let after = before;
  for (let attempt = 1; attempt <= probeRetries; attempt += 1) {
    if (battle || stopped) return { type: 'interrupted' };
    const state = await command('STATE');
    if (state === 'BATTLE') { battle = true; battleReady = true; phase = 'battle'; void battleAction(); return { type: 'interrupted' }; }
    const response = await command(`MOVE ${direction}`);
    if (response.startsWith('SKIPPED_BATTLE')) { battle = true; return { type: 'interrupted' }; }
    await delay(timing.nextDelay({ directionChanged: direction !== lastDirection, advanced: attempt === 1 }));
    after = await settledWorld();
    if (after.map !== before.map || after.x !== before.x || after.y !== before.y) break;
  }
  lastDirection = direction;
  lastWorld = after;
  if (after.map === before.map && after.x === before.x && after.y === before.y) {
    const routeStallKey = `${tileKey(before)}:${direction}`;
    if (routeStallKey === stalledRouteKey) stalledRouteCount += 1;
    else { stalledRouteKey = routeStallKey; stalledRouteCount = 1; }
    const dynamicGymBlocker = mode === 'badges' && campaign.isCurrentGymMap(graph, before);
    if (!probe && mode === 'badges' && clientPid > 0 && (stalledRouteCount >= 2 || dynamicGymBlocker)) {
      await pressActionKey(4, 120, 550);
      stalledRouteCount = 0;
      await delay(900);
      await log('campaign_dialogue_advanced', { at: tileKey(before), source: 'repeated_route_stall' });
      if ((await command('STATE')) === 'BATTLE') {
        battle = true;
        battleReady = true;
        turnReadyAt = Date.now();
        return { type: 'dialogue_battle', from: tileKey(before), direction };
      }
      graph.blocked.add(routeStallKey);
      activeFrontierTarget = null;
    }
    if (probe) {
      const stalledKey = tileKey(before);
      if (stalledKey !== stalledWorldKey) {
        stalledWorldKey = stalledKey;
        stalledDirections = new Set();
      }
      stalledDirections.add(direction);
      if (mode === 'badges' && clientPid > 0 && stalledDirections.size >= 2) {
        await pressActionKey(4, 120, 550);
        stalledDirections.clear();
        await delay(750);
        await log('campaign_dialogue_advanced', { at: stalledKey });
        if ((await command('STATE')) === 'BATTLE') {
          battle = true;
          battleReady = true;
          turnReadyAt = Date.now();
          return { type: 'dialogue_battle', from: stalledKey, direction };
        }
      }
      const result = graph.observeStep(before, direction, after);
      blockedProbes += 1;
      await log('tile_blocked', { from: tileKey(before), direction, attempts: probeRetries });
      await persist();
      return result;
    }
    if (expectedEdge) unavailableUntil.set(`${expectedEdge.from}>${expectedEdge.to}`, Date.now() + 15000);
    await log('route_edge_temporarily_blocked', { from: tileKey(before), direction, expected: expectedEdge?.to });
    return { type: 'route_blocked' };
  }

  stalledWorldKey = '';
  stalledDirections.clear();
  stalledRouteKey = '';
  stalledRouteCount = 0;
  const result = graph.observeStep(before, direction, after);
  const beforeCenter = centers.centers[after.map]?.status;
  const observedCenter = centers.observe(graph, after);
  if (mode === 'badges') campaign.observeWorld(after);
  if (mode === 'badges') {
    campaignNorthmostY.set(after.map, Math.min(campaignNorthmostY.get(after.map) ?? after.y, after.y));
  }
  if (observedCenter && observedCenter.status !== beforeCenter) {
    await log('pokemon_center_discovered', { ...observedCenter });
  }
  if (result.type === 'warp') {
    await captureMapView(after);
    try { await refreshClientMap('map_transition'); }
    catch (error) { await log('client_map_hook_unavailable', { map: after.map, message: error.message }); }
  }
  dex.observeStep(after);
  try {
    const terrain = await observeCurrentTerrain(after);
    if (terrain) await log('terrain_observed', { map: after.map, x: after.x, y: after.y, ...terrain });
  } catch (error) {
    await log('terrain_observe_error', { message: error.message });
  }
  steps += 1;
  await log(result.type === 'warp' ? 'map_transition' : 'tile_discovered', {
    from: tileKey(before), to: tileKey(after), direction, map: after.map, name: after.name, steps,
  });
  await persist();
  return result;
}

async function shutdown(signal) {
  if (stopped && signal !== 'recovery_required') return;
  stopped = true;
  phase = phase === 'complete' || phase === 'recovery_required' ? phase : 'stopped';
  clearInterval(captureTimer);
  await readCapture();
  await persist();
  await log('stopped', { signal, phase, steps, encounters, battles, maps: graph.maps.size });
}

await log('started', { capturePath, graphPath, encounterPath, centersPath, campaignPath: mode === 'badges' ? campaignPath : null, speciesIndexPath, indexedSpecies: Object.keys(speciesIndex.species ?? {}).length, statusPath, world: lastWorld, stepMs, probeRetries, maxMinutes, maxMaps, mode, targetSpecies, levelMin, levelMax, alwaysCatchShiny });
if (battle && !encounterAnnounced) {
  encounterAnnounced = true;
  encounters += 1;
  encounterPosition = lastWorld;
  await log('encounter_recovered_at_startup', { map: lastWorld.map, name: lastWorld.name, x: lastWorld.x, y: lastWorld.y });
  encounterIdentityPending = identifyEncounter();
}
await captureMapView(lastWorld);
try { await refreshCampaignProgress(true); } catch (error) { await log('campaign_progress_error', { message: error.message }); }
await persist();
const captureTimer = setInterval(() => void readCapture().catch(error => log('capture_error', { message: error.message })), 65);

process.on('SIGINT', () => void shutdown('SIGINT').finally(() => process.exit(0)));
process.on('SIGTERM', () => void shutdown('SIGTERM').finally(() => process.exit(0)));

while (!stopped) {
  if (maxMinutes > 0 && Date.now() - startedAt >= maxMinutes * 60000) { await shutdown('max_minutes'); break; }
  if (maxMaps > 0 && graph.maps.size >= maxMaps) { await shutdown('max_maps'); break; }
  if (battle) { await pollBattleState(); await verifyPendingBattleAction(); await recoverStalledBattleUi(); await battleAction(); await delay(100); continue; }
  if (activeFrontierTarget) {
    const at = activeFrontierTarget.lastIndexOf('@');
    const [x, y] = activeFrontierTarget.slice(at + 1).split(',').map(Number);
    const destination = { map: activeFrontierTarget.slice(0, at), x, y };
    const route = graph.route(lastWorld, destination);
    if (route?.length) {
      phase = 'routing_to_frontier';
      await move(route[0].direction, { expectedEdge: route[0] });
      continue;
    }
    activeFrontierTarget = null;
  }
  const policy = await policyMove();
  if (policy?.handled) continue;
  if (policy?.direction !== undefined) {
    phase = policy.phase;
    await move(policy.direction, { expectedEdge: policy.expectedEdge, probe: policy.probe });
    continue;
  }
  const plan = (mode === 'badges' && !campaign.isCurrentGymMap(graph, lastWorld)
    ? planMappedExit(graph, lastWorld, { unavailableEdges: liveUnavailableEdges() }) : null)
    ?? planMappedPortal(graph, lastWorld, { unavailableEdges: liveUnavailableEdges() })
    ?? planMappedSurvey(graph, lastWorld, {
    preferredDirection: mode === 'badges' ? campaign.preferredExplorationDirection(lastWorld) : null,
    unavailableEdges: liveUnavailableEdges(),
  }) ?? planNorthernFrontier()
    ?? planFrontier(graph, lastWorld, { unavailableEdges: liveUnavailableEdges() });
  if (!plan) {
    if (mode === 'badges' && !campaign.status().complete) {
      if (await tryCampaignInteraction()) continue;
      phase = 'campaign_needs_story_interaction';
      lastError = `No mapped route to ${campaign.currentGym()?.leader ?? 'the next gym'}; a story interaction or new landmark must be learned.`;
      await persist();
      await delay(1500);
      continue;
    }
    phase = 'complete';
    await log('reachable_world_complete', { maps: graph.maps.size, tiles: [...graph.maps.values()].reduce((sum, map) => sum + (map.visited?.length ?? 0), 0) });
    await shutdown('frontier_exhausted');
    break;
  }
  phase = plan.kind === 'probe' ? 'probing' : 'routing_to_frontier';
  if (plan.kind === 'route') activeFrontierTarget = plan.target;
  const expectedEdge = plan.kind === 'route' ? plan.route[0] : null;
  await move(plan.direction, { probe: plan.kind === 'probe', expectedEdge });
}
