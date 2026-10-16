import { describe, expect, it } from "vitest";
import { TICK_RATE } from "@mandreljs/sim/constants";
import { BUTTON_ATTACK, BUTTON_JUMP } from "@mandreljs/sim/input";
import { RESPAWN_DELAY, RespawnWait } from "../../src/game/death.ts";

const DELAY_TICKS = RESPAWN_DELAY * TICK_RATE;

/** Runs a RespawnWait from a death at tick 100 for the given ticks with the given buttons held, returning the tick it restarted on, or null. */
function run(wait: RespawnWait, from: number, ticks: number, buttons: (tick: number) => number): number | null {
  for (let tick = from; tick < from + ticks; tick++) if (wait.update(tick, false, buttons(tick))) return tick;
  return null;
}

describe("RespawnWait", () => {
  it("never restarts a living player", () => {
    const wait = new RespawnWait();
    for (let tick = 0; tick < 3 * DELAY_TICKS; tick++) expect(wait.update(tick, true, BUTTON_ATTACK)).toBe(false);
  });

  it("restarts on a press of attack once the delay has passed", () => {
    const wait = new RespawnWait();
    const pressAt = 100 + DELAY_TICKS + 10;
    expect(run(wait, 100, 2 * DELAY_TICKS, (tick) => (tick >= pressAt ? BUTTON_ATTACK : 0))).toBe(pressAt);
  });

  it("restarts on jump too", () => {
    const wait = new RespawnWait();
    const pressAt = 100 + DELAY_TICKS + 1;
    expect(run(wait, 100, 2 * DELAY_TICKS, (tick) => (tick >= pressAt ? BUTTON_JUMP : 0))).toBe(pressAt);
  });

  it("ignores presses during the delay", () => {
    const wait = new RespawnWait();
    expect(run(wait, 100, DELAY_TICKS, () => BUTTON_ATTACK)).toBeNull();
    expect(wait.ready).toBe(false);
  });

  it("needs the buttons let go first, so holding fire through a death doesn't restart", () => {
    const wait = new RespawnWait();
    expect(run(wait, 100, 3 * DELAY_TICKS, () => BUTTON_ATTACK)).toBeNull();
    expect(wait.ready).toBe(false);
    const releaseAt = 100 + 3 * DELAY_TICKS;
    expect(wait.update(releaseAt, false, 0)).toBe(false);
    expect(wait.ready).toBe(true);
    expect(wait.update(releaseAt + 1, false, BUTTON_ATTACK)).toBe(true);
  });

  it("starts the wait over for the next death", () => {
    const wait = new RespawnWait();
    run(wait, 100, 2 * DELAY_TICKS, () => 0);
    expect(wait.ready).toBe(true);
    wait.update(500, true, 0); // alive again
    expect(wait.ready).toBe(false);
    expect(wait.update(600, false, 0)).toBe(false); // died again at 600
    expect(wait.update(601, false, BUTTON_ATTACK)).toBe(false);
  });
});
