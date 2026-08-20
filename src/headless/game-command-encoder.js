import { GAME_BATTLE_ACTION_OPCODE, encodeMoveCommand, packBattleActor } from './battle-packets.js';
import { GAME_MOVEMENT_OPCODE, MovementSequencer } from './movement-packets.js';

export class GameCommandEncoder {
  constructor(options = {}) {
    this.movement = new MovementSequencer(options.position);
    this.moveIds = options.moveIds ?? [];
    this.actor = options.actor ?? packBattleActor(0, 0);
    this.target = options.target ?? 0;
  }

  encode(command) {
    if (command?.type === 'move') {
      return this.movement.createSteps(command.direction, command.steps, {
        running: command.running ?? false,
      }).map((payload) => ({ opcode: GAME_MOVEMENT_OPCODE, payload }));
    }
    if (command?.type === 'battle_move') {
      const moveId = this.moveIds[command.slot];
      if (!Number.isInteger(moveId)) throw new Error(`No move ID is configured for battle slot ${command.slot}`);
      return [{
        opcode: GAME_BATTLE_ACTION_OPCODE,
        payload: encodeMoveCommand({ actor: this.actor, moveId, target: this.target }),
      }];
    }
    if (command?.type === 'stop') return [];
    throw new Error(`Unsupported game command: ${command?.type ?? 'undefined'}`);
  }
}
