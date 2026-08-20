/** Timing profile that preserves normal client walk animation without fixed-interval input. */
export class HumanMovementTiming {
  constructor({
    random = Math.random,
    walkCadenceMs = 250,
    cadenceJitterMs = 16,
    turnDelayMs = 85,
    pauseEveryMin = 14,
    pauseEveryMax = 30,
    pauseMinMs = 140,
    pauseMaxMs = 360,
  } = {}) {
    this.random = random;
    this.walkCadenceMs = walkCadenceMs;
    this.cadenceJitterMs = cadenceJitterMs;
    this.turnDelayMs = turnDelayMs;
    this.pauseEveryMin = pauseEveryMin;
    this.pauseEveryMax = pauseEveryMax;
    this.pauseMinMs = pauseMinMs;
    this.pauseMaxMs = pauseMaxMs;
    this.stepsUntilPause = this.#integer(pauseEveryMin, pauseEveryMax);
  }

  nextDelay({ directionChanged = false, advanced = true, inBattle = false } = {}) {
    if (inBattle) return 90;
    const jitter = (this.random() * 2 - 1) * this.cadenceJitterMs;
    let delay = this.walkCadenceMs + jitter + (directionChanged ? this.turnDelayMs : 0);
    if (advanced) {
      this.stepsUntilPause -= 1;
      if (this.stepsUntilPause <= 0) {
        delay += this.#integer(this.pauseMinMs, this.pauseMaxMs);
        this.stepsUntilPause = this.#integer(this.pauseEveryMin, this.pauseEveryMax);
      }
    }
    return Math.max(80, Math.round(delay));
  }

  nextIntentDelay({ directionChanged = false } = {}) {
    return Math.round(85 + this.random() * 45 + (directionChanged ? 25 : 0));
  }

  nextMovementStartDelay({ directionChanged = false } = {}) {
    return Math.round(235 + this.random() * 35 + (directionChanged ? 20 : 0));
  }

  #integer(minimum, maximum) {
    return Math.round(minimum + this.random() * (maximum - minimum));
  }
}
