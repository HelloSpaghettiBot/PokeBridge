const DEFAULT_SEARCH_PATTERN = ['left', 'right'];

export class BattleTrainingLoop {
  constructor(options = {}) {
    if (typeof options.send !== 'function') throw new TypeError('send must be a function');
    this.send = options.send;
    this.searchPattern = options.searchPattern ?? DEFAULT_SEARCH_PATTERN;
    this.searchSteps = options.searchSteps ?? 4;
    this.moveSlot = options.moveSlot ?? 0;
    this.maxBattles = options.maxBattles ?? Number.POSITIVE_INFINITY;
    this.minHealthRatio = options.minHealthRatio ?? 0.2;
    this.onTransition = options.onTransition ?? (() => {});
    this.state = 'idle';
    this.searchIndex = 0;
    this.battlesCompleted = 0;
    this.stopReason = undefined;
  }

  start() {
    if (this.state !== 'idle' && this.state !== 'stopped') return;
    this.stopReason = undefined;
    this.transition('searching', 'start');
    this.sendSearchMove();
  }

  handle(event) {
    if (!event?.type || this.state === 'stopped') return;
    switch (event.type) {
      case 'world_ready':
        if (this.battlesCompleted >= this.maxBattles) {
          this.stop('max_battles');
          return;
        }
        this.transition('searching', 'world_ready');
        this.sendSearchMove();
        break;
      case 'movement_complete':
        if (this.state === 'searching') this.sendSearchMove();
        break;
      case 'encounter_started':
        if (this.state === 'searching') this.transition('waiting_for_turn', 'encounter_started');
        break;
      case 'battle_turn_ready':
        this.handleBattleTurn(event);
        break;
      case 'battle_turn_resolved':
        if (this.state === 'waiting_for_result' && !event.battleEnded) {
          this.transition('waiting_for_turn', 'turn_resolved');
        }
        break;
      case 'battle_ended':
        this.battlesCompleted += 1;
        this.transition('waiting_for_world', 'battle_ended');
        break;
      case 'disconnected':
        this.stop('disconnected');
        break;
      case 'fatal_error':
        this.stop(event.reason ?? 'fatal_error');
        break;
      default:
        break;
    }
  }

  handleBattleTurn(event) {
    if (!['waiting_for_turn', 'waiting_for_result'].includes(this.state)) return;
    const healthRatio = event.maxHealth > 0 ? event.health / event.maxHealth : 1;
    if (event.fainted || healthRatio <= this.minHealthRatio) {
      this.stop(event.fainted ? 'party_fainted' : 'low_health');
      return;
    }
    this.send({ type: 'battle_move', slot: this.moveSlot });
    this.transition('waiting_for_result', 'move_sent');
  }

  sendSearchMove() {
    if (this.searchPattern.length === 0) {
      this.stop('empty_search_pattern');
      return;
    }
    const direction = this.searchPattern[this.searchIndex % this.searchPattern.length];
    this.searchIndex += 1;
    this.send({ type: 'move', direction, steps: this.searchSteps });
  }

  stop(reason = 'requested') {
    this.stopReason = reason;
    this.transition('stopped', reason);
    this.send({ type: 'stop', reason });
  }

  transition(nextState, reason) {
    const previousState = this.state;
    this.state = nextState;
    this.onTransition({ previousState, nextState, reason, battlesCompleted: this.battlesCompleted });
  }

  getStatus() {
    return {
      state: this.state,
      battlesCompleted: this.battlesCompleted,
      stopReason: this.stopReason,
    };
  }
}
