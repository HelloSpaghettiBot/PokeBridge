import { EventEmitter } from 'node:events';
import { BattleTrainingLoop } from './battle-training-loop.js';
import { decodeBattleServerPacket } from './battle-events.js';
import { GAME_BATTLE_END_ACK_OPCODE, encodeBattleEndAck } from './battle-packets.js';
import { GameCommandEncoder } from './game-command-encoder.js';

export class GameBotSession extends EventEmitter {
  constructor(options = {}) {
    super();
    if (!options.transport?.on || typeof options.transport.sendPacket !== 'function') {
      throw new TypeError('transport must emit packets and implement sendPacket');
    }
    this.transport = options.transport;
    this.encoder = new GameCommandEncoder({
      position: options.position,
      moveIds: options.moveIds,
      actor: options.actor,
      target: options.target,
    });
    this.healthProvider = options.healthProvider ?? (() => ({ health: 1, maxHealth: 1, fainted: false }));
    this.stepIntervalMs = options.stepIntervalMs ?? 300;
    this.worldReadyDelayMs = options.worldReadyDelayMs ?? 250;
    this.timers = new Set();
    this.movementGeneration = 0;
    this.loop = new BattleTrainingLoop({
      ...options.loop,
      send: (command) => this.dispatch(command),
      onTransition: (transition) => this.emit('transition', transition),
    });
    this.onPacket = (packet) => this.handlePacket(packet);
    this.onDisconnected = () => this.loop.handle({ type: 'disconnected' });
    this.transport.on('packet', this.onPacket);
    this.transport.on('disconnected', this.onDisconnected);
  }

  start() {
    this.loop.start();
  }

  stop(reason = 'requested') {
    this.loop.stop(reason);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  handlePacket(packet) {
    const event = decodeBattleServerPacket(packet.opcode, packet.payload);
    if (!event) return;
    this.emit('protocolEvent', event);
    if (event.type === 'encounter_started') this.movementGeneration += 1;
    if (event.type === 'battle_turn_ready') {
      this.loop.handle({ ...event, ...this.healthProvider() });
      return;
    }
    if (event.type === 'battle_ended') {
      this.transport.sendPacket(GAME_BATTLE_END_ACK_OPCODE, encodeBattleEndAck());
      this.loop.handle(event);
      this.schedule(() => this.loop.handle({ type: 'world_ready' }), this.worldReadyDelayMs);
      return;
    }
    this.loop.handle(event);
  }

  dispatch(command) {
    this.emit('command', command);
    const packets = this.encoder.encode(command);
    const movementGeneration = command.type === 'move' ? ++this.movementGeneration : null;
    packets.forEach((packet, index) => {
      this.schedule(() => {
        if (command.type === 'move'
          && (movementGeneration !== this.movementGeneration || this.loop.state !== 'searching')) return;
        this.transport.sendPacket(packet.opcode, packet.payload);
      }, index * this.stepIntervalMs);
    });
    if (command.type === 'move' && packets.length > 0) {
      this.schedule(() => {
        if (movementGeneration === this.movementGeneration && this.loop.state === 'searching') {
          this.loop.handle({ type: 'movement_complete' });
        }
      }, Math.max(packets.length * this.stepIntervalMs, 1));
    }
  }

  schedule(callback, delay) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, delay);
    this.timers.add(timer);
  }

  close() {
    this.stop('closed');
    this.transport.off?.('packet', this.onPacket);
    this.transport.off?.('disconnected', this.onDisconnected);
  }
}
