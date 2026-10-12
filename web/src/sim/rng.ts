// The sim's seeded random number generator. Its whole state is one unsigned
// 32-bit integer stored in the sim state, so snapshots capture it exactly.
//
// Algorithm: mulberry32 (public domain). Every operation is 32-bit integer math,
// so other engines can reproduce it bit for bit; the values in rng.test.ts are
// the reference sequence.

export interface RandomResult {
  /** Uniform in [0, 1). */
  readonly value: number;
  readonly state: number;
}

export const seedRandom = (seed: number): number => seed >>> 0;

export function nextRandom(state: number): RandomResult {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: next };
}
