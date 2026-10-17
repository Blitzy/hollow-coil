// Runs the sim at its fixed tick rate regardless of frame rate. Each frame adds
// real elapsed time, at a speed (faster or slower for watching a demo); the
// caller runs that many ticks, then renders between the last two states using alpha.

export class FixedStep {
  private accumulator = 0;
  /** Sim seconds the last advance added: its real seconds, capped, times its speed. */
  elapsed = 0;
  private readonly tickRate: number;
  private readonly maxFrameSeconds: number;

  /**
   * @param tickRate ticks per second (the sim's TICK_RATE)
   * @param maxFrameSeconds longest frame to catch up on, so a stall (a hidden tab,
   *   a breakpoint) doesn't trigger a burst of ticks
   */
  constructor(tickRate: number, maxFrameSeconds = 0.25) {
    this.tickRate = tickRate;
    this.maxFrameSeconds = maxFrameSeconds;
  }

  /**
   * Adds elapsed real time, run at speed (0 for none), and returns how many ticks to run now. The stall cap applies
   * to the real time, so a fast speed still keeps up on a slow frame.
   */
  advance(seconds: number, speed = 1): number {
    this.elapsed = Math.min(Math.max(seconds, 0), this.maxFrameSeconds) * speed;
    this.accumulator += this.elapsed;
    const ticks = Math.floor(this.accumulator * this.tickRate);
    this.accumulator -= ticks / this.tickRate;
    return ticks;
  }

  /** How far between the previous tick and the next one, 0 to 1, for interpolation. */
  get alpha(): number {
    return Math.min(this.accumulator * this.tickRate, 1);
  }
}
