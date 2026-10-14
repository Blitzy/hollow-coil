import { describe, expect, it } from "vitest";
import { nextRandom, seedRandom } from "@mandreljs/sim/rng";

function sequence(seed: number, count: number): number[] {
  let state = seedRandom(seed);
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const r = nextRandom(state);
    values.push(r.value);
    state = r.state;
  }
  return values;
}

describe("seeded RNG", () => {
  it("produces values in [0, 1)", () => {
    for (const v of sequence(12345, 1000)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is reproducible from the seed and differs between seeds", () => {
    expect(sequence(7, 10)).toEqual(sequence(7, 10));
    expect(sequence(7, 10)).not.toEqual(sequence(8, 10));
  });

  it("matches the reference sequence (other engines must produce these exact values)", () => {
    // value * 2^32 gives the raw 32-bit outputs, which are easier to compare across languages.
    // Seed 0 starts 0.26642920868471265, the published first mulberry32 value for that seed.
    expect(sequence(0, 5).map((v) => v * 2 ** 32)).toEqual([1144304738, 1416247, 958946056, 627933444, 2007157716]);
    expect(sequence(1, 5).map((v) => v * 2 ** 32)).toEqual([2693262067, 11749833, 2265367787, 4213581821, 4159151403]);
  });
});
