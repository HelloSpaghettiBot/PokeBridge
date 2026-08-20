import { EventEmitter } from 'node:events';
import { battleDecision, chooseActivityDestination } from '../exploration/activity-policy.js';
import { CenterRegistry } from '../exploration/center-registry.js';
import { EncounterDex } from '../exploration/encounter-dex.js';
import { planFrontier } from '../exploration/frontier-planner.js';
import { HumanMovementTiming } from '../navigation/human-movement.js';
import { WorldGraph } from '../navigation/world-graph.js';
import { decodeBattleServerPacket } from './battle-events.js';
import { encodeFleeCommand, encodeItemCommand, encodeMoveCommand, encodeSwitchCommand } from './battle-packets.js';
import { encodeMovement, encodeMovementIntent, GAME_MOVEMENT_INTENT_OPCODE, stepPosition } from './movement-packets.js';
import { DIALOGUE_RESPONSE_OPCODE, encodeDialogueResponse, encodeNpcInteraction, NPC_INTERACTION_OPCODE } from './interaction-packets.js';

const STATUS_MOVES = new Set([45, 108]);

export class OfficialBotController extends EventEmitter {
  constructor(options = {}) {
    super();
    this.session = options.session;
    this.state = options.state;
    this.graph = options.graph instanceof WorldGraph ? options.graph : new WorldGraph(options.graph);
    this.dex = options.dex instanceof EncounterDex ? options.dex : new EncounterDex(options.dex);
    this.centers = options.centers instanceof CenterRegistry ? options.centers : new CenterRegistry(options.centers);
    this.persist = options.persist ?? (() => {});
    this.speciesNames = options.speciesNames ?? {};
    this.timing = options.timing ?? new HumanMovementTiming();
    this.running = false;
    this.activity = null;
    this.timer = null;
    this.lastDirection = null;
    this.battle = null;
    this.exhaustedMoves = new Map();
    this.recoveryRequired = false;
    this.healing = false;
    this.steps = 0;
    this.onPacket = packet => this.#handlePacket(packet);
    this.onDisconnected = () => this.stop('disconnected');
    this.session.on('packet', this.onPacket);
    this.session.on('disconnected', this.onDisconnected);
  }

  start(activity = {}) {
    if (this.session.phase !== 'world' || !this.session.world.player) throw new Error('The game session has no authoritative world position yet');
    if (this.running) this.stop('reconfigured');
    this.activity = { ...activity, running: true };
    this.recoveryRequired = false;
    this.lastDirection = null;
    this.running = true;
    this.#patchActivity({ ...this.activity, botState: 'searching', stopReason: '', steps: this.steps });
    this.#schedule(() => void this.#moveOnce(), 50);
  }

  stop(reason = 'requested') {
    this.running = false;
    this.healing = false;
    clearTimeout(this.timer);
    this.timer = null;
    this.#patchActivity({ running: false, botState: 'stopped', stopReason: reason });
  }

  close() {
    this.stop('closed');
    this.session.off('packet', this.onPacket);
    this.session.off('disconnected', this.onDisconnected);
  }

  async #moveOnce() {
    if (!this.running || this.battle) return;
    const raw = this.session.world.player;
    if (!raw) return this.stop('position_unavailable');
    const current = this.graphPosition(raw);
    this.graph.observe(current);
    const direction = this.#chooseDirection(current);
    if (direction === null) {
      if (this.healing) return;
      return this.stop(this.recoveryRequired ? 'pokemon_center_unreachable' : 'frontier_exhausted');
    }
    const before = { ...current };
    const changed = this.lastDirection !== null && this.lastDirection !== direction;
    const needsIntent = this.lastDirection === null || changed;
    this.lastDirection = direction;
    this.#patchActivity({ botState: 'moving', lastCommand: `move:${direction}` });
    try {
      const anticipated = this.#anticipatedStep(current, direction);
      if (needsIntent) {
        this.session.sendPacket(GAME_MOVEMENT_INTENT_OPCODE, encodeMovementIntent(direction));
        const intentDelay = this.timing.nextIntentDelay?.({ directionChanged: changed }) ?? 100;
        await pause(intentDelay);
        if (!this.running || this.battle) return;
      }
      // Opcode 6 contains the tile being left. The server advances one tile in
      // the supplied direction; the adjacent tile is only our expected state.
      const confirmation = this.session.sendMovement(
        encodeMovement({ ...current, direction }),
        anticipated.warp ? null : encodeMovement({ ...anticipated.target, direction }),
      );
      const result = await confirmation;
      if (!this.running || this.battle) return;
      const after = this.graphPosition(result.position ?? this.session.world.player);
      const observation = this.graph.observeStep(before, direction, after);
      if (observation.type !== 'blocked') this.steps += 1;
      this.dex.observeStep(after);
      this.centers.observe(this.graph, after);
      this.#publishMap(after, observation);
      this.#persist();
      const delay = this.timing.nextDelay({ directionChanged: changed, advanced: observation.type !== 'blocked' });
      this.#schedule(() => void this.#moveOnce(), delay);
    } catch (error) {
      this.stop(`movement_error:${error.message}`);
    }
  }

  #anticipatedStep(current, direction) {
    const from = tileKey(current);
    const known = (this.graph.edges.get(from) ?? []).find(edge => edge.direction === direction
      && !this.graph.blocked.has(`${from}:${direction}`));
    if (known?.type === 'warp') return { warp: true, target: current };
    if (known?.to) {
      const [map, coordinate = ''] = known.to.split('@');
      const [x, y] = coordinate.split(',').map(Number);
      if (map === current.map && Number.isInteger(x) && Number.isInteger(y)) {
        return { warp: false, target: { ...current, x, y, direction } };
      }
    }
    try {
      return { warp: false, target: stepPosition(current, direction) };
    } catch {
      // A map-boundary step has no representable adjacent unsigned coordinate.
      // Wait for the server's map spawn/correction instead of crashing.
      return { warp: true, target: current };
    }
  }

  #chooseDirection(current) {
    if (this.recoveryRequired) {
      const center = this.centers.nearestVerified(this.graph, current);
      if (!center) return null;
      if (center.route.length) {
        this.#patchActivity({ botState: 'seeking_center', destination: center.center.name, routeSteps: center.route.length });
        return center.route[0].direction;
      }
      this.#patchActivity({ botState: 'at_center', destination: center.center.name, routeSteps: 0 });
      this.#beginHealing(center.center);
      return null;
    }
    if (this.activity?.mode === 'explore') {
      const plan = planFrontier(this.graph, current);
      return plan?.direction ?? null;
    }
    if (['hunt', 'shiny', 'train'].includes(this.activity?.mode)) {
      const destination = chooseActivityDestination({
        graph: this.graph,
        dex: this.dex,
        current,
        mode: this.activity.mode,
        targetSpecies: this.activity.targetSpecies,
        levelMin: Number(this.activity.levelMin ?? 1),
        levelMax: Number(this.activity.levelMax ?? 100),
      });
      if (destination?.route.length) {
        this.#patchActivity({ destination: destination.mapName, routeSteps: destination.route.length });
        return destination.route[0].direction;
      }
      if (destination?.inArea) {
        this.#patchActivity({ destination: destination.mapName, routeSteps: 0, botState: this.activity.mode === 'train' ? 'training' : 'hunting' });
        return this.#patrolDirection(current);
      }
    }
    const candidates = this.lastDirection === null
      ? [current.direction ?? 2, (current.direction ?? 2) ^ 1, 0, 1]
      : [this.lastDirection ^ 1, this.lastDirection, 0, 1, 2, 3];
    return candidates.find(direction => !this.graph.blocked.has(`${tileKey(current)}:${direction}`)) ?? null;
  }

  #patrolDirection(current) {
    const from = tileKey(current);
    const edges = (this.graph.edges.get(from) ?? [])
      .filter(edge => edge.type === 'walk'
        && edge.to.startsWith(`${current.map}@`)
        && !this.graph.blocked.has(`${from}:${edge.direction}`));
    if (!edges.length) return null;
    const forward = this.lastDirection === null ? edges : edges.filter(edge => edge.direction !== (this.lastDirection ^ 1));
    const candidates = forward.length ? forward : edges;
    return candidates[Math.floor(Math.random() * candidates.length)].direction;
  }

  #handlePacket(packet) {
    if (this.healing && packet.opcode === DIALOGUE_RESPONSE_OPCODE && packet.payload.length) {
      const sequence = packet.payload[0];
      this.session.sendPacket(DIALOGUE_RESPONSE_OPCODE, encodeDialogueResponse(sequence, sequence === 0 ? 1 : 0));
      this.#patchActivity({ botState: 'healing', lastCommand: `dialogue:${sequence}` });
      if (sequence >= 3) this.#schedule(() => this.#finishHealing(), 1200);
    }
    const event = decodeBattleServerPacket(packet.opcode, packet.payload);
    if (!event) return;
    if (event.type === 'encounter_started') {
      clearTimeout(this.timer);
      const enemy = this.#namePokemon({ ...event.enemy, wild: !event.trainerBattle });
      this.battle = {
        ...event,
        enemy,
        weakened: false,
        activeSlot: 0,
        lastMoveId: null,
        lastMovePokemonId: null,
        actionPending: false,
      };
      const position = this.session.world.player && this.graphPosition(this.session.world.player);
      if (position && enemy) {
        this.dex.observeEncounter(position, `ENEMY species=${String(enemy.species).replaceAll(' ', '_')} speciesId=${enemy.speciesId} level=${enemy.level} hp=${enemy.hp} maxHp=${enemy.maxHp}`);
        this.#persist();
      }
      this.state?.patch({ battle: { phase: 'starting', trainerBattle: event.trainerBattle, enemy, party: event.party.map(pokemon => this.#namePokemon(pokemon)), turnReady: false } });
      this.#patchActivity({ botState: 'battle_starting' });
      return;
    }
    if (event.type === 'battle_turn_ready') void this.#actBattleTurn(event);
    if (event.type === 'battle_turn_resolved' || event.type === 'battle_turn_sequence') {
      if (this.battle) {
        this.#applyResolvedAction(event.action);
        this.battle.actionPending = false;
        this.battle.lastMoveId = null;
      }
    }
    if (event.type === 'battle_ended') {
      this.battle = null;
      if (this.running) {
        this.#patchActivity({ botState: 'returning_to_world' });
        this.#schedule(() => void this.#moveOnce(), 900);
      }
    }
  }

  async #actBattleTurn(turn) {
    if (!this.running || !this.battle) return;
    if (this.battle.actionPending && this.battle.lastMoveId !== null) {
      this.#exhaustedFor(this.battle.lastMovePokemonId).add(this.battle.lastMoveId);
      this.battle.lastMoveId = null;
      this.battle.lastMovePokemonId = null;
    }
    this.battle.actionPending = false;
    const active = this.battle.party[this.battle.activeSlot] ?? null;
    if (turn.forced || !active || active.hp <= 0) {
      const switchSlot = this.#switchSlot();
      if (switchSlot >= 0) {
        this.#sendSwitch(turn.actor, switchSlot, 'forced_switch');
        return;
      }
      if (!this.battle.trainerBattle) {
        this.#sendFlee(turn.actor);
        return;
      }
      this.stop('no_living_trainer_battle_pokemon');
      return;
    }
    const enemy = this.battle.enemy;
    const decision = battleDecision({
      mode: this.activity.mode,
      enemy,
      targetSpecies: this.activity.targetSpecies,
      balls: this.state?.value.inventory?.balls ?? Number.POSITIVE_INFINITY,
    });
    const hpKnown = Number.isFinite(enemy.hp) && Number.isFinite(enemy.maxHp);
    if (decision.action === 'catch' || decision.action === 'weaken' && this.battle.weakened && !hpKnown) {
      const targetEntityId = littleEndianHexToBigInt(enemy.entityId);
      this.session.sendPacket(50, encodeItemCommand({ actor: turn.actor, itemId: 5004, targetEntityId, target: 0xff }));
      this.battle.actionPending = true;
      this.#patchActivity({ botState: 'catching', lastCommand: 'poke_ball' });
      this.state?.patch({ battle: { phase: 'catching', turnReady: false } });
      return;
    }
    const exhausted = this.#exhaustedFor(active.entityId);
    const moveId = active.moves.find(id => !STATUS_MOVES.has(id) && !exhausted.has(id))
      ?? active.moves.find(id => !exhausted.has(id));
    if (moveId) {
      this.session.sendPacket(50, encodeMoveCommand({ actor: turn.actor, moveId, target: 0 }));
      this.battle.lastMoveId = moveId;
      this.battle.lastMovePokemonId = active.entityId;
      this.battle.actionPending = true;
      if (decision.action === 'weaken') this.battle.weakened = true;
      this.#patchActivity({ botState: decision.action === 'weaken' ? 'weakening' : 'battling', lastCommand: `move:${moveId}` });
      this.state?.patch({ battle: { phase: 'resolving', turnReady: false } });
      return;
    }
    const switchSlot = this.#switchSlot();
    if (switchSlot >= 0) {
      this.#sendSwitch(turn.actor, switchSlot, 'switch');
      return;
    }
    if (!this.battle.trainerBattle) {
      this.#sendFlee(turn.actor);
      return;
    }
    this.session.sendPacket(50, encodeMoveCommand({ actor: turn.actor, moveId: 165, target: 0 }));
    this.battle.actionPending = true;
    this.recoveryRequired = true;
    this.#patchActivity({ botState: 'battling', lastCommand: 'struggle:165', recoveryRequired: true });
  }

  graphPosition(position) {
    const prefix = position.map;
    const known = [...this.graph.maps.keys()].find(key => key === prefix || key.startsWith(`${prefix}:`));
    return { ...position, map: known ?? prefix, name: this.graph.maps.get(known)?.name ?? null };
  }

  #applyResolvedAction(action) {
    if (!action || action.remainingHp === null || !this.battle) return;
    if (this.battle.enemy?.entityId === action.defenderEntityId) this.battle.enemy.hp = action.remainingHp;
    const partyMember = this.battle.party.find(pokemon => pokemon.entityId === action.defenderEntityId);
    if (partyMember) partyMember.hp = action.remainingHp;
    this.state?.patch({
      battle: {
        enemy: this.battle.enemy,
        party: this.battle.party.map(pokemon => this.#namePokemon(pokemon)),
        lastAction: action,
      },
    });
  }

  #beginHealing(center) {
    if (this.healing) return;
    const current = this.graphPosition(this.session.world.player);
    const candidates = [...this.session.world.entities.values()]
      .filter(entity => entity.kind === 'npc' && this.graphPosition(entity).map === current.map)
      .sort((left, right) => Number(right.modelId === 64) - Number(left.modelId === 64)
        || Math.abs(left.x - center.healTile.x) + Math.abs(left.y - center.healTile.y)
        - Math.abs(right.x - center.healTile.x) - Math.abs(right.y - center.healTile.y));
    const nurse = candidates[0];
    if (!nurse) return this.stop('nurse_not_visible');
    this.healing = true;
    this.session.sendPacket(NPC_INTERACTION_OPCODE, encodeNpcInteraction(nurse.id));
    this.#patchActivity({ botState: 'opening_heal_dialogue', lastCommand: `interact:${nurse.id}` });
  }

  #finishHealing() {
    if (!this.running || !this.healing) return;
    this.healing = false;
    this.recoveryRequired = false;
    this.exhaustedMoves.clear();
    this.#patchActivity({ botState: 'healed', recoveryRequired: false, lastCommand: 'heal_complete' });
    this.#schedule(() => void this.#moveOnce(), 900);
  }

  #publishMap(position, observation) {
    const map = this.graph.maps.get(position.map) ?? { visited: [] };
    this.state?.patch({
      player: { map: position.map, mapName: map.name ?? null, x: position.x, y: position.y, direction: position.direction },
      map: { visited: map.visited ?? [], blocked: [...this.graph.blocked].filter(key => key.startsWith(`${position.map}@`)) },
      survey: { maps: this.graph.maps.size, tiles: [...this.graph.maps.values()].reduce((sum, value) => sum + (value.visited?.length ?? 0), 0) },
      protocol: { lastMovementResult: observation.type },
      activity: { steps: this.steps },
    });
  }

  #namePokemon(pokemon) {
    if (!pokemon) return pokemon;
    return { ...pokemon, species: this.speciesNames[pokemon.speciesId] ?? `Species #${pokemon.speciesId}` };
  }

  #exhaustedFor(entityId) {
    const key = String(entityId ?? 'unknown');
    if (!this.exhaustedMoves.has(key)) this.exhaustedMoves.set(key, new Set());
    return this.exhaustedMoves.get(key);
  }

  #switchSlot() {
    return this.battle.party.findIndex((pokemon, index) => index !== this.battle.activeSlot
      && pokemon.hp > 0
      && pokemon.moves.some(moveId => !this.#exhaustedFor(pokemon.entityId).has(moveId)));
  }

  #sendSwitch(actor, switchSlot, command) {
    this.session.sendPacket(50, encodeSwitchCommand({ actor, partySlot: switchSlot }));
    this.battle.activeSlot = switchSlot;
    this.battle.actionPending = true;
    this.battle.lastMoveId = null;
    this.battle.lastMovePokemonId = null;
    this.#patchActivity({ botState: 'switching', lastCommand: `${command}:${switchSlot}` });
  }

  #sendFlee(actor) {
    this.session.sendPacket(50, encodeFleeCommand({ actor }));
    this.battle.actionPending = true;
    this.recoveryRequired = true;
    this.#patchActivity({ botState: 'seeking_center', lastCommand: 'flee', recoveryRequired: true });
  }

  #patchActivity(patch) { this.state?.patch({ activity: patch }); }
  #persist() { void Promise.resolve(this.persist({ graph: this.graph, dex: this.dex, centers: this.centers })).catch(error => this.#patchActivity({ persistenceError: error.message })); }
  #schedule(callback, delay) { clearTimeout(this.timer); this.timer = setTimeout(callback, delay); }
}

function littleEndianHexToBigInt(hex) {
  if (!hex) return 0n;
  return Buffer.from(hex, 'hex').reverse().readBigUInt64BE();
}

function tileKey(position) { return `${position.map}@${position.x},${position.y}`; }
function pause(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
