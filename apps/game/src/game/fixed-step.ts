// Runs the sim at its fixed tick rate regardless of frame rate. Each frame adds
// real elapsed time; the caller runs that many ticks, then renders between the
// last two states using alpha.

export class FixedStep {
  private accumulator = 0;

  /**
   * @param tickRate ticks per second (the sim's TICK_RATE)
   * @param maxFrameSeconds longest frame to catch up on, so a stall (a hidden tab,
   *   a breakpoint) doesn't trigger a burst of ticks
   */
  constructor(private readonly tickRate: number, private readonly maxFrameSeconds = 0.25) {}

  /** Adds elapsed real time and returns how many ticks to run now. */
  advance(seconds: number): number {
    this.accumulator += Math.min(Math.max(seconds, 0), this.maxFrameSeconds);
    const ticks = Math.floor(this.accumulator * this.tickRate);
    this.accumulator -= ticks / this.tickRate;
    return ticks;
  }

  /** How far between the previous tick and the next one, 0 to 1, for interpolation. */
  get alpha(): number {
    return Math.min(this.accumulator * this.tickRate, 1);
  }
}
