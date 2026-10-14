import { describe, expect, it } from "vitest";
import { loadWeaponsData } from "@hollow-coil/testing";
import { BUTTON_ATTACK, NEUTRAL_COMMAND, type InputCommand } from "@hollow-coil/sim/input";
import { startingWeapon, weaponContext, weaponFrame, type WeaponContext, type WeaponState } from "@hollow-coil/sim/player/weapons";

// The repo's data: pistol (slot 1) every 21 ticks, shotgun (slot 2) every 54, lower 12, raise 15.
const weapons = loadWeaponsData();
const ctx = weaponContext(weapons, ["pistol", "shotgun"]);
const ATTACK = { buttons: BUTTON_ATTACK };

interface Frame {
  readonly tick: number;
  readonly weapon: WeaponState;
  readonly fired: boolean;
}

/** Runs the weapon for ticks 1..count, with the command for each tick from input(tick). */
function run(count: number, input: (tick: number) => Partial<InputCommand>, context: WeaponContext = ctx): Frame[] {
  const frames: Frame[] = [];
  let weapon = startingWeapon("pistol");
  for (let tick = 1; tick <= count; tick++) {
    const result = weaponFrame(weapon, { ...NEUTRAL_COMMAND, ...input(tick) }, context);
    weapon = result.weapon;
    frames.push({ tick, ...result });
  }
  return frames;
}

const firedTicks = (frames: Frame[]): number[] => frames.filter((f) => f.fired).map((f) => f.tick);
const at = (frames: Frame[], tick: number): WeaponState => frames[tick - 1]!.weapon;

describe("weaponContext", () => {
  it("converts the data's times to ticks", () => {
    expect(ctx.fireTicks).toEqual(new Map([["pistol", 21], ["shotgun", 54]]));
    expect([ctx.lowerTicks, ctx.raiseTicks]).toEqual([12, 15]);
    expect(ctx.bySlot).toEqual(new Map([[1, "pistol"], [2, "shotgun"]]));
  });

  it("only maps slots to weapons the player has", () => {
    expect(weaponContext(weapons, ["shotgun"]).bySlot).toEqual(new Map([[2, "shotgun"]]));
  });

  it("fires at most once a tick, however short the interval", () => {
    const fast = { ...weapons, weapons: { pistol: { ...weapons.weapons.pistol!, fire_interval: 0.001 } } };
    expect(weaponContext(fast, ["pistol"]).fireTicks.get("pistol")).toBe(1);
  });

  it("rejects a player weapon that isn't in the data", () => {
    expect(() => weaponContext(weapons, ["railgun"])).toThrow(/railgun/);
  });
});

describe("firing", () => {
  it("starts with the starting weapon, ready", () => {
    expect(startingWeapon("pistol")).toEqual({ current: "pistol", desired: "pistol", phase: "ready", time: 0 });
  });

  it.each([
    ["pistol", 1, 21],
    ["shotgun", 2, 54],
  ])("%s: holding attack fires at once, then every fire_interval, over a long hold", (_, slot, interval) => {
    // Start with the weapon raised: switch to it first, then hold attack for 10 seconds.
    const frames = run(27 + 600, (tick) => (tick === 1 ? { weapon: slot } : tick > 27 ? ATTACK : {}));
    const shots = firedTicks(frames);
    expect(shots[0]).toBe(28);
    expect(shots.slice(1).map((t, i) => t - shots[i]!)).toEqual(Array(shots.length - 1).fill(interval));
    expect(shots).toHaveLength(Math.floor((600 - 1) / interval) + 1);
  });

  it("doesn't fire sooner when attack is tapped during the cooldown", () => {
    expect(firedTicks(run(30, (tick) => (tick % 2 === 1 ? ATTACK : {})))).toEqual([1, 23]); // ready at 22, but tick 22 isn't a press
  });

  it("is ready again once attack is released after the cooldown", () => {
    const frames = run(40, (tick) => (tick === 1 ? ATTACK : {}));
    expect(at(frames, 21)).toMatchObject({ phase: "firing", time: 1 });
    expect(at(frames, 22)).toMatchObject({ phase: "ready", time: 0 });
  });
});

describe("switching", () => {
  it("lowers for lower_time, then raises the new weapon for raise_time, and fires only when it's up", () => {
    const frames = run(60, (tick) => (tick === 1 ? { weapon: 2, ...ATTACK } : ATTACK));
    expect(at(frames, 1)).toMatchObject({ current: "pistol", phase: "lowering" });
    expect(at(frames, 12)).toMatchObject({ current: "pistol", phase: "lowering" });
    expect(at(frames, 13)).toMatchObject({ current: "shotgun", phase: "raising" });
    expect(at(frames, 27)).toMatchObject({ current: "shotgun", phase: "raising" });
    // 27 ticks after the request: lower_time + raise_time exactly.
    expect(firedTicks(frames)).toEqual([28]);
  });

  it("waits for the fire cooldown before lowering", () => {
    const frames = run(60, (tick) => (tick === 1 ? ATTACK : tick === 2 ? { weapon: 2 } : {}));
    expect(firedTicks(frames)).toEqual([1]);
    expect(at(frames, 21)).toMatchObject({ current: "pistol", desired: "shotgun", phase: "firing" });
    expect(at(frames, 22)).toMatchObject({ current: "pistol", phase: "lowering", time: 12 });
    expect(at(frames, 34)).toMatchObject({ current: "shotgun", phase: "raising" });
  });

  it("raises whichever weapon was asked for last, if a key is pressed while lowering", () => {
    const frames = run(30, (tick) => (tick === 1 ? { weapon: 2 } : tick === 5 ? { weapon: 1 } : {}));
    expect(at(frames, 13)).toMatchObject({ current: "pistol", phase: "raising" });
  });

  it("starts lowering again if another key is pressed while raising, adding the lower time to what's left", () => {
    const frames = run(60, (tick) => (tick === 1 ? { weapon: 2 } : tick === 14 ? { weapon: 1 } : {}));
    expect(at(frames, 13)).toMatchObject({ current: "shotgun", phase: "raising", time: 15 });
    expect(at(frames, 14)).toMatchObject({ current: "shotgun", phase: "lowering", time: 14 + 12 });
    expect(at(frames, 40)).toMatchObject({ current: "pistol", phase: "raising" });
  });

  it("ignores the current weapon's slot, empty slots, and slots for weapons the player lacks", () => {
    const pistolOnly = weaponContext(weapons, ["pistol"]);
    const frames = run(5, (tick) => ({ weapon: [1, 9, 2, 1, 7][tick - 1]! }), pistolOnly);
    for (const f of frames) expect(f.weapon).toEqual(startingWeapon("pistol"));
  });

  it("switches and fires in the same tick when lowering and raising take no time", () => {
    const instant = weaponContext({ ...weapons, switching: { lower_time: 0, raise_time: 0 } }, ["pistol", "shotgun"]);
    const frames = run(1, () => ({ weapon: 2, ...ATTACK }), instant);
    expect(frames[0]).toMatchObject({ fired: true, weapon: { current: "shotgun", phase: "firing", time: 54 } });
  });
});
