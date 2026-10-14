// The one place the simulation's tick rate is defined. Durations in data are in
// seconds and are converted to ticks from this constant.
export const TICK_RATE = 60;

// Contents bits, using Quake 2's values (they are what .map faces and .bsp brushes store).
export const CONTENTS = {
  SOLID: 1,
  WINDOW: 2,
  PLAYERCLIP: 0x10000,
  MONSTERCLIP: 0x20000,
  /** A living enemy's box (never a brush). */
  MONSTER: 0x2000000,
} as const;

/** The player's entity id. Enemies get ids after it. */
export const PLAYER_ID = 1;

/** Spawn origins are raised 1 unit so nothing starts touching the floor (docs/MOVEMENT.md, Spawning). */
export const SPAWN_RAISE = 1;

/** Seconds to whole ticks, rounding to the nearest tick (spec/README.md, Conversion rules). */
export const secondsToTicks = (seconds: number, tickRate = TICK_RATE): number => Math.floor(seconds * tickRate + 0.5);
