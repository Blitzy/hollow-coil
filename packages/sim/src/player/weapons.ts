// The player's weapon: switching (lower, then raise) and firing on a cooldown,
// one update per tick. See docs/WEAPONS.md. Adapted from Quake 3's PM_Weapon,
// PM_BeginWeaponChange, and PM_FinishWeaponChange in bg_pmove.c (id Software,
// GPLv2 or later), with times in ticks instead of milliseconds.

import { secondsToTicks } from "../constants.ts";
import type { WeaponsData } from "../data.ts";
import { BUTTON_ATTACK, type InputCommand } from "../input.ts";

/**
 * ready: idle, can fire or switch now.
 * firing: fired; `time` counts down the cooldown, and switching waits for it.
 * lowering: putting the current weapon away; then the desired weapon is raised.
 * raising: bringing the current weapon up; another weapon key starts lowering again.
 */
export type WeaponPhase = "ready" | "firing" | "lowering" | "raising";

export interface WeaponState {
  /** The weapon in hand (a key of weapons.json's weapons). */
  readonly current: string;
  /** The weapon the player last asked for; differs from current until a switch finishes. */
  readonly desired: string;
  readonly phase: WeaponPhase;
  /** Ticks until the weapon can act again (the cooldown, or what's left of lowering or raising). */
  readonly time: number;
}

/** What the weapon code needs from the data, with durations in ticks. Built once by weaponContext(). */
export interface WeaponContext {
  /** The player's weapons by slot. Slots without one of the player's weapons are ignored. */
  readonly bySlot: ReadonlyMap<number, string>;
  /** Ticks between shots, by weapon. At least 1. */
  readonly fireTicks: ReadonlyMap<string, number>;
  readonly lowerTicks: number;
  readonly raiseTicks: number;
}

export function weaponContext(weapons: WeaponsData, owned: readonly string[]): WeaponContext {
  const bySlot = new Map<number, string>();
  const fireTicks = new Map<string, number>();
  for (const id of owned) {
    const weapon = weapons.weapons[id];
    if (!weapon) throw new Error(`the player's weapon "${id}" is not in weapons.json`);
    bySlot.set(weapon.slot, id);
    fireTicks.set(id, Math.max(1, secondsToTicks(weapon.fire_interval)));
  }
  return {
    bySlot,
    fireTicks,
    lowerTicks: secondsToTicks(weapons.switching.lower_time),
    raiseTicks: secondsToTicks(weapons.switching.raise_time),
  };
}

/** The weapon at spawn: the starting weapon, ready to fire. */
export const startingWeapon = (id: string): WeaponState => ({ current: id, desired: id, phase: "ready", time: 0 });

export interface WeaponFrame {
  readonly weapon: WeaponState;
  /** True if the weapon fired this tick. */
  readonly fired: boolean;
}

/** Advances the weapon by one tick. */
export function weaponFrame(w: WeaponState, cmd: InputCommand, ctx: WeaponContext): WeaponFrame {
  let { current, desired, phase, time } = w;
  const done = (fired = false): WeaponFrame => ({ weapon: { current, desired, phase, time }, fired });

  if (cmd.weapon !== 0) desired = ctx.bySlot.get(cmd.weapon) ?? desired;
  if (time > 0) time--;

  // Start a switch, unless already lowering. A fired weapon finishes its cooldown first.
  if (desired !== current && phase !== "lowering" && (time <= 0 || phase !== "firing")) {
    phase = "lowering";
    time += ctx.lowerTicks;
  }
  if (time > 0) return done();

  if (phase === "lowering") {
    current = desired;
    phase = "raising";
    time += ctx.raiseTicks;
    if (time > 0) return done();
  }
  // A raised weapon can fire on the same tick, so a switch takes exactly lower_time + raise_time.
  if (phase === "raising") phase = "ready";

  if ((cmd.buttons & BUTTON_ATTACK) === 0) {
    phase = "ready";
    return done();
  }
  phase = "firing";
  time += ctx.fireTicks.get(current)!;
  return done(true);
}
