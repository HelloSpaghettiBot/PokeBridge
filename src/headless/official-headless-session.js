import { EventEmitter } from 'node:events';
import { GameTransport } from './game-transport.js';
import { OfficialWorldState } from './official-world-state.js';
import { decodeBattleServerPacket } from './battle-events.js';
import { OfficialBotController } from './official-bot-controller.js';
import { decodeInventoryUpdate, POKE_BALL_ITEM_ID } from './inventory-events.js';
import {
  createDeviceId,
  deriveMacAddress,
  encodeCharacterSelection,
  encodeGameLogin,
  encodeInitialTelemetry,
  encodeLoginRequest,
  encodeMfa,
  parseCharacterNames,
  parseActiveGameSession,
  parseLoginSession,
  parseLoginStatus,
  parseMfaChallenge,
  parseServerList,
  selectGameEndpoint,
} from './official-protocol.js';

export class OfficialHeadlessSession extends EventEmitter {
  constructor(options = {}) {
    super();
    this.state = options.state;
    this.loginHost = options.loginHost ?? '207.246.96.200';
    this.loginPort = Number(options.loginPort ?? 2106);
    this.serverKeyId = options.serverKeyId ?? 'primary';
    this.characterName = options.characterName ?? 'Deltron';
    this.characterId = BigInt(options.characterId ?? '1902562831166377984');
    this.characterProof = BigInt(options.characterProof ?? '16022381992908638383');
    this.transportFactory = options.transportFactory ?? (transportOptions => new GameTransport(transportOptions));
    this.loginTransport = null;
    this.gameTransport = null;
    this.deviceId = null;
    this.macAddress = null;
    this.loginResult = null;
    this.mfaResult = null;
    this.username = null;
    this.phase = 'idle';
    this.worldEntryPending = false;
    this.worldJoinToken = null;
    this.worldJoinTimer = null;
    this.maintenanceTimer = null;
    this.initialPosition = options.initialPosition ?? null;
    this.world = new OfficialWorldState({
      characterName: this.characterName,
      characterId: this.characterId,
      moveCommitMs: options.moveCommitMs,
    });
    for (const eventName of ['playerMoved', 'playerCorrected', 'mapChanged', 'playerState', 'entitySpawned', 'entityMoved', 'entityFaced', 'entityRemoved']) {
      this.world.on(eventName, event => this.#applyWorldEvent(event));
    }
    this.botController = new OfficialBotController({
      session: this,
      state: this.state,
      graph: options.graph,
      dex: options.dex,
      centers: options.centers,
      speciesNames: options.speciesNames,
      persist: options.persist,
    });
  }

  async login({ username, password }) {
    this.close();
    this.username = username;
    this.phase = 'login_connecting';
    this.loginResult = deferred();
    this.deviceId = await createDeviceId();
    this.macAddress = deriveMacAddress(this.deviceId);
    this.patch({ connection: { state: 'connecting', detail: `${this.loginHost}:${this.loginPort} login service` } });
    this.loginTransport = this.transportFactory({
      host: this.loginHost,
      port: this.loginPort,
      serverKeyId: this.serverKeyId,
    });
    this.loginTransport.on('packet', packet => this.#handleLoginPacket(packet));
    this.loginTransport.on('disconnected', previous => this.#handleDisconnected('login', previous));
    try {
      await this.loginTransport.connect();
      this.phase = 'credentials_sent';
      this.patch({ connection: { state: 'secure_login', detail: 'Encrypted VPS login session' } });
      this.loginTransport.sendPacket(17, encodeLoginRequest({ username, password, deviceId: this.deviceId }));
    } catch (error) {
      this.#fail(error);
    }
    return this.loginResult.promise;
  }

  async submitMfa({ code }) {
    if (!this.loginTransport || this.phase !== 'mfa_required') throw new Error('The login service is not waiting for MFA');
    this.mfaResult = deferred();
    this.phase = 'mfa_sent';
    this.loginTransport.sendPacket(8, encodeMfa(code));
    return this.mfaResult.promise;
  }

  #handleLoginPacket(packet) {
    this.#countPacket(`login:${packet.opcode}`);
    try {
      if (packet.opcode === 8) {
        const challenge = parseMfaChallenge(packet.payload);
        this.phase = 'mfa_required';
        this.patch({ login: { state: 'mfa_required', username: this.username, mfaRequired: true, mfaMethod: challenge.method } });
        this.loginResult?.resolve({ mfaRequired: true });
        return;
      }
      if (packet.opcode === 1) {
        const result = parseLoginStatus(packet.payload);
        if (result.status === 3) {
          this.phase = 'mfa_transition';
          this.patch({ login: { state: 'mfa_pending', username: this.username, mfaRequired: true } });
          return;
        }
        if (result.status !== 0) throw new Error(`Login rejected by server (status ${result.status})`);
        this.phase = 'requesting_servers';
        this.loginTransport.sendPacket(2);
        return;
      }
      if (packet.opcode === 34 || packet.opcode === 18 || packet.opcode === 2) {
        const list = parseServerList(packet.payload, packet.opcode);
        const selected = list.servers.find(server => server.id === list.selectedServerId && server.online)
          ?? list.servers.find(server => server.online)
          ?? list.servers[0];
        if (!selected) throw new Error('No game servers were returned by the login service');
        this.phase = 'requesting_session';
        this.loginTransport.sendPacket(3, Buffer.from([selected.id]));
        return;
      }
      if (packet.opcode === 3) {
        const session = parseLoginSession(packet.payload);
        if (session.status !== 0) throw new Error(`Game session rejected by server (status ${session.status})`);
        this.phase = 'game_connecting';
        void this.#connectGame(session).catch(error => this.#fail(error));
        return;
      }
      if ([4, 20].includes(packet.opcode)) {
        const status = packet.payload.length ? packet.payload[0] : -1;
        throw new Error(`Login service error (status ${status})`);
      }
      if (packet.opcode === 38) {
        const active = parseActiveGameSession(packet.payload);
        if (active.characterId !== this.characterId) throw new Error('The active game session belongs to a different character');
        this.phase = 'game_reconnecting';
        this.patch({ login: { state: 'resuming_character', character: this.characterName, notice: null } });
        void this.#connectGame(active, true).catch(error => this.#fail(error));
        return;
      }
      this.patch({
        login: { state: 'login_notice', notice: `opcode ${packet.opcode}` },
        protocol: { lastLoginNotice: { opcode: packet.opcode, length: packet.payload.length, payloadHex: packet.payload.toString('hex') } },
      });
    } catch (error) {
      this.#fail(error);
    }
  }

  async #connectGame(session, resume = false) {
    const endpoint = selectGameEndpoint(session);
    this.patch({ connection: { state: 'connecting_game', detail: `${endpoint.host}:${endpoint.port} from login service` } });
    this.gameTransport = this.transportFactory({
      host: endpoint.host,
      port: endpoint.port,
      serverKeyId: this.serverKeyId,
      inboundCompression: true,
    });
    this.gameTransport.on('packet', packet => this.#handleGamePacket(packet));
    this.gameTransport.on('disconnected', previous => this.#handleDisconnected('game', previous));
    await this.gameTransport.connect();
    this.phase = resume ? 'game_resume_sent' : 'game_login_sent';
    this.patch({ connection: { state: 'secure_game', detail: `Encrypted VPS game session at ${endpoint.host}:${endpoint.port}` } });
    if (resume) {
      this.worldEntryPending = true;
      const token = Buffer.concat([Buffer.from([session.token.length]), Buffer.from(session.token)]);
      this.gameTransport.sendPacket(1, encodeWorldProof(session.characterId, token));
    } else {
      this.gameTransport.sendPacket(32, encodeInitialTelemetry(this.macAddress));
      this.gameTransport.sendPacket(1, encodeGameLogin({
        accountId: session.accountId,
        token: session.token,
        macAddress: this.macAddress,
      }));
    }
  }

  #handleGamePacket(packet) {
    this.#countPacket(`game:${packet.opcode}`);
    try {
      // The official client echoes this complete nine-byte payload. Without
      // these replies the server closes an otherwise healthy session.
      if (packet.opcode === 194) this.gameTransport.sendPacket(194, encodeKeepaliveResponse(packet.payload));
      const worldEvent = this.world.consume(packet.opcode, packet.payload);
      const battleEvent = decodeBattleServerPacket(packet.opcode, packet.payload);
      if (battleEvent) this.#applyBattleEvent(battleEvent);
      const inventoryEvent = decodeInventoryUpdate(packet.opcode, packet.payload);
      if (inventoryEvent) this.#applyInventoryEvent(inventoryEvent);
      this.emit('packet', packet);
      if (packet.opcode === 1 && this.phase === 'game_login_sent') {
        if (packet.payload[0] !== 1) throw new Error('Game server rejected the headless client bootstrap');
        this.phase = 'character_list_wait';
        this.gameTransport.sendPacket(2);
        return;
      }
      if (packet.opcode === 1 && this.phase === 'game_resume_sent') {
        if (packet.payload[0] !== 1) throw new Error('Game server rejected the active-session resume');
        this.gameTransport.sendPacket(2, encodeWorldReady());
        this.phase = 'world_sync_confirmed';
        this.world.seedPlayer(this.initialPosition);
        this.#completeWorldEntry();
        return;
      }
      if (packet.opcode === 2 && this.phase === 'character_list_wait') {
        const characterNames = parseCharacterNames(packet.payload);
        if (characterNames.length && !characterNames.includes(this.characterName)) {
          throw new Error(`Configured character ${this.characterName} was not in the server character list`);
        }
        this.phase = 'character_selected';
        this.worldEntryPending = true;
        this.patch({ login: { state: 'entering_character', character: this.characterName, characters: characterNames } });
        this.gameTransport.sendPacket(4, encodeCharacterSelection(this.characterId, this.characterProof));
        this.worldJoinTimer = setTimeout(() => this.#requestWorldBootstrap(), 150);
        return;
      }
      if (packet.opcode === 252 && this.worldEntryPending) {
        this.worldJoinToken = parseWorldJoinToken(packet.payload);
        return;
      }
      if (packet.opcode === 1 && this.phase === 'world_proof_sent' && packet.payload[0] === 1) {
        this.gameTransport.sendPacket(2, encodeWorldReady());
        this.phase = 'world_sync_confirmed';
        this.world.seedPlayer(this.initialPosition);
        this.#completeWorldEntry();
        return;
      }
      if (this.worldEntryPending && worldEvent && this.world.player) this.#completeWorldEntry();
    } catch (error) {
      this.#fail(error);
    }
  }

  #handleDisconnected(kind, previous) {
    if (kind === 'login' && ['world', 'character_selected'].includes(this.phase)) return;
    if (kind === 'login' && this.phase === 'game_connecting') return;
    if (this.phase === 'idle' || this.phase === 'failed') return;
    if (kind === 'game') this.emit('disconnected', previous);
    this.#fail(new Error(`${kind} connection closed during ${previous}`));
  }

  #requestWorldBootstrap() {
    if (!this.gameTransport || !this.worldEntryPending || this.phase !== 'character_selected') return;
    this.gameTransport.sendPacket(5);
    this.phase = 'world_bootstrap_requested';
    this.worldJoinTimer = setTimeout(() => this.#sendWorldProof(), 220);
  }

  #sendWorldProof() {
    if (!this.gameTransport || !this.worldEntryPending || this.phase !== 'world_bootstrap_requested') return;
    if (!this.worldJoinToken) return this.#fail(new Error('World bootstrap token was not received'));
    this.gameTransport.sendPacket(1, encodeWorldProof(this.characterId, this.worldJoinToken));
    this.phase = 'world_proof_sent';
  }

  #completeWorldEntry() {
    if (!this.worldEntryPending || !this.world.player) return;
    this.worldEntryPending = false;
    this.phase = 'world';
    clearTimeout(this.worldJoinTimer);
    this.patch({
      connection: { state: 'online', detail: 'VPS-only game session is in world' },
      login: { state: 'authenticated', username: this.username, mfaRequired: false, character: this.characterName },
    });
    this.loginResult?.resolve({ mfaRequired: false });
    this.mfaResult?.resolve({ authenticated: true });
    this.loginTransport?.close();
    clearInterval(this.maintenanceTimer);
    this.maintenanceTimer = setInterval(() => {
      if (this.phase !== 'world' || !this.gameTransport) return;
      this.gameTransport.sendPacket(0);
      this.gameTransport.sendPacket(32, encodeInitialTelemetry(this.macAddress));
    }, 60_000);
  }

  #fail(error) {
    if (this.phase === 'failed') return;
    this.phase = 'failed';
    this.patch({
      connection: { state: 'error', detail: error.message },
      login: { state: 'error', username: this.username, mfaRequired: false, error: error.message },
    });
    this.loginResult?.reject(error);
    this.mfaResult?.reject(error);
    this.emit('sessionError', error);
  }

  #countPacket(key) {
    if (!this.state) return;
    const counts = { ...this.state.value.protocol.packetCounts };
    counts[key] = (counts[key] ?? 0) + 1;
    this.patch({ protocol: { packetCounts: counts } });
  }

  patch(value) { this.state?.patch(value); }

  sendPacket(opcode, payload) {
    if (this.phase !== 'world' || !this.gameTransport) throw new Error('Headless game session is not in world');
    const sent = this.gameTransport.sendPacket(opcode, payload);
    this.#traceOutbound(opcode, payload);
    this.world.observeOutbound(opcode, payload);
    return sent;
  }

  sendMovement(payload, expectedPayload = payload) {
    if (this.phase !== 'world' || !this.gameTransport) throw new Error('Headless game session is not in world');
    const authoritative = expectedPayload === null ? this.world.waitForAuthoritativePlayerUpdate(900) : null;
    this.gameTransport.sendPacket(6, payload);
    this.#traceOutbound(6, payload);
    if (authoritative) {
      return authoritative.then(result => ({
        status: result.event ? 'authoritative' : 'unconfirmed',
        position: result.position,
      }));
    }
    return this.world.observeOutbound(6, expectedPayload);
  }

  primeMovement(payload) {
    if (this.phase !== 'world' || !this.gameTransport) throw new Error('Headless game session is not in world');
    // The official client emits a same-tile opcode 6 after opcode 7 when a
    // movement direction starts. It drives the walk animation and must not be
    // treated as a completed step by the authoritative-position tracker.
    const confirmation = this.world.waitForAuthoritativePlayerUpdate(650);
    this.gameTransport.sendPacket(6, payload);
    this.#traceOutbound(6, payload);
    return confirmation;
  }

  startBot(activity) { this.botController.start(activity); }
  stopBot(reason = 'dashboard') { this.botController.stop(reason); }

  #applyWorldEvent(event) {
    const snapshot = this.world.snapshot();
    const player = snapshot.player;
    const visited = [...(this.state?.value.map.visited ?? [])];
    if (player) {
      const tile = `${player.x},${player.y}`;
      if (!visited.includes(tile)) visited.push(tile);
    }
    const resolvedPlayer = player ? this.botController.graphPosition(player) : null;
    this.patch({
      player: resolvedPlayer ? {
        map: resolvedPlayer.map,
        mapName: resolvedPlayer.name,
        x: resolvedPlayer.x,
        y: resolvedPlayer.y,
        direction: resolvedPlayer.direction,
      } : {},
      nearby: {
        players: snapshot.entities
          .filter(entity => entity.id !== player?.id && entity.kind === 'player')
          .map(entity => ({ id: entity.id, name: entity.name, x: entity.x, y: entity.y })),
        trainers: snapshot.entities
          .filter(entity => entity.kind === 'trainer')
          .map(entity => ({ id: entity.id, name: entity.name, x: entity.x, y: entity.y })),
        npcs: snapshot.entities
          .filter(entity => entity.kind === 'npc')
          .map(entity => ({ id: entity.id, name: entity.name, x: entity.x, y: entity.y })),
      },
      map: { visited },
      protocol: {
        lastWorldEvent: event.type,
        ...(event.type === 'playerCorrected' ? {
          lastCorrection: { reason: event.reason, payloadHex: event.payloadHex },
          correctionTrace: [...(this.state?.value.protocol.correctionTrace ?? []), {
            at: Date.now(), reason: event.reason, payloadHex: event.payloadHex,
          }].slice(-40),
        } : {}),
      },
    });
  }

  #traceOutbound(opcode, payload) {
    if (![6, 7].includes(opcode) || !this.state) return;
    const trace = [...(this.state.value.protocol.outboundTrace ?? []), {
      at: Date.now(), opcode, payloadHex: Buffer.from(payload ?? []).toString('hex'),
    }].slice(-40);
    this.patch({ protocol: { outboundTrace: trace } });
  }

  #applyBattleEvent(event) {
    if (event.type === 'encounter_started') {
      this.patch({
        battle: {
          phase: 'starting',
          trainerBattle: event.trainerBattle,
          enemy: event.enemy,
          party: event.party,
          turnReady: false,
        },
      });
      return;
    }
    if (event.type === 'battle_turn_ready') {
      this.patch({ battle: { phase: 'awaiting_action', turnReady: true, actor: event.actor, forced: event.forced } });
      return;
    }
    if (event.type === 'battle_turn_resolved' || event.type === 'battle_turn_sequence') {
      this.patch({ battle: { phase: 'resolving', turnReady: false } });
      return;
    }
    if (event.type === 'battle_ended') {
      this.patch({ battle: null });
      if (this.phase === 'world' && this.gameTransport) this.gameTransport.sendPacket(51);
    }
  }

  #applyInventoryEvent(event) {
    const items = { ...(this.state?.value.inventory.items ?? {}) };
    items[event.itemId] = event.quantity;
    this.patch({ inventory: { items, balls: event.itemId === POKE_BALL_ITEM_ID ? event.quantity : this.state?.value.inventory.balls } });
  }

  close() {
    this.botController.stop('session_closed');
    this.world.close();
    this.phase = 'idle';
    const loginTransport = this.loginTransport;
    const gameTransport = this.gameTransport;
    this.loginTransport = null;
    this.gameTransport = null;
    loginTransport?.removeAllListeners('packet');
    loginTransport?.removeAllListeners('disconnected');
    gameTransport?.removeAllListeners('packet');
    gameTransport?.removeAllListeners('disconnected');
    loginTransport?.close();
    gameTransport?.close();
    this.worldEntryPending = false;
    this.worldJoinToken = null;
    clearTimeout(this.worldJoinTimer);
    this.worldJoinTimer = null;
    clearInterval(this.maintenanceTimer);
    this.maintenanceTimer = null;
  }
}

export function encodeKeepaliveResponse(payload) {
  const bytes = Buffer.from(payload);
  if (bytes.length !== 9 || bytes[0] !== 1) throw new Error('Invalid game keepalive payload');
  return bytes;
}

export function parseWorldJoinToken(payload) {
  const bytes = Buffer.from(payload);
  const length = bytes[0];
  if (length !== 16 || bytes.length < 1 + length) throw new Error('Invalid world bootstrap token');
  return Buffer.from(bytes.subarray(0, 1 + length));
}

export function encodeWorldProof(characterId, token) {
  const proof = Buffer.alloc(8 + token.length);
  proof.writeBigUInt64LE(BigInt.asUintN(64, BigInt(characterId)), 0);
  Buffer.from(token).copy(proof, 8);
  return proof;
}

export function encodeWorldReady() {
  return Buffer.from('006000feff00', 'hex');
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  promise.catch(() => {});
  return { promise, resolve, reject };
}
