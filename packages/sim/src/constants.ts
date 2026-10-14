// The one place the simulation's tick rate is defined. Durations in data are in
// seconds and are converted to ticks from this constant.
export const TICK_RATE = 60;

// Brush contents bits, using Quake 2's values (they are what .map faces and .bsp brushes store).
export const CONTENTS = {
  SOLID: 1,
  WINDOW: 2,
  PLAYERCLIP: 0x10000,
  MONSTERCLIP: 0x20000,
} as const;

/** Seconds to whole ticks, rounding to the nearest tick (spec/README.md, Conversion rules). */
export const secondsToTicks = (seconds: number, tickRate = TICK_RATE): number => Math.floor(seconds * tickRate + 0.5);
