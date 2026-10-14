import { describe, expect, it } from "vitest";
import { loadWeaponsData, readRepoFile } from "@hollow-coil/testing";
import { aimVectors, eyePosition, fireHitscan, rayBoxFraction, type HitTarget, type PelletHit } from "@hollow-coil/sim/combat/hitscan";
import { DIST_EPSILON } from "@hollow-coil/sim/collision/trace";
import { CONTENTS } from "@hollow-coil/sim/constants";
import type { HitscanData } from "@hollow-coil/sim/data";
import { degreesToUnits } from "@hollow-coil/sim/input";
import { levelFromMap } from "@hollow-coil/sim/level";
import { dot, vec3, type Vec3 } from "@hollow-coil/sim/math/vec3";
import { nextRandom } from "@hollow-coil/sim/rng";
import { box, world } from "@hollow-coil/sim/testing/worlds";

const weapons = loadWeaponsData().weapons;
const straight = (range = 1000): HitscanData => ({ pellets: 1, damage: 10, spread: { horizontal: 0, vertical: 0 }, range });
const near = (a: Vec3, b: Vec3, tolerance = 1e-9): boolean =>
  Math.abs(a.x - b.x) < tolerance && Math.abs(a.y - b.y) < tolerance && Math.abs(a.z - b.z) < tolerance;

/** Checks a pellet hit the world at point (to within rounding) with the given normal. */
function expectWallHit(hit: PelletHit | null | undefined, point: Vec3, normal: Vec3): void {
  expect(hit?.kind).toBe("world");
  if (hit?.kind !== "world") return;
  expect(near(hit.point, point), `hit at ${JSON.stringify(hit.point)}, expected ${JSON.stringify(point)}`).toBe(true);
  expect(hit.normal).toEqual(normal);
}

// A wall facing west, its face at x = 256, and an eye at the origin looking east.
const WALL = world(box([256, -512, -512], [288, 512, 512]));
const EYE = vec3(0, 0, 0);
const target = (id: number, x0: number, x1: number): HitTarget => ({ id, mins: vec3(x0, -16, -24), maxs: vec3(x1, 16, 32) });

describe("aimVectors", () => {
  it("faces +x at yaw 0, +y at yaw 90, and up with positive pitch", () => {
    expect(near(aimVectors(0, 0).forward, vec3(1, 0, 0))).toBe(true);
    expect(near(aimVectors(degreesToUnits(90), 0).forward, vec3(0, 1, 0))).toBe(true);
    expect(near(aimVectors(0, degreesToUnits(90)).forward, vec3(0, 0, 1))).toBe(true);
  });

  it("gives right and up at right angles to forward, matching movement's right", () => {
    const { forward, right, up } = aimVectors(degreesToUnits(30), degreesToUnits(-20));
    expect(Math.abs(dot(forward, right))).toBeLessThan(1e-12);
    expect(Math.abs(dot(forward, up))).toBeLessThan(1e-12);
    expect(near(aimVectors(0, 0).right, vec3(0, -1, 0))).toBe(true);
    expect(near(aimVectors(0, 0).up, vec3(0, 0, 1))).toBe(true);
  });
});

describe("rayBoxFraction", () => {
  const mins = vec3(10, -1, -1);
  const maxs = vec3(20, 1, 1);
  it("gives where the ray enters the box", () => {
    expect(rayBoxFraction(vec3(0, 0, 0), vec3(100, 0, 0), mins, maxs)).toBeCloseTo(0.1, 12);
  });
  it("misses a box beside the ray, behind it, or past its end", () => {
    expect(rayBoxFraction(vec3(0, 5, 0), vec3(100, 0, 0), mins, maxs)).toBeNull();
    expect(rayBoxFraction(vec3(30, 0, 0), vec3(100, 0, 0), mins, maxs)).toBeNull();
    expect(rayBoxFraction(vec3(0, 0, 0), vec3(5, 0, 0), mins, maxs)).toBeNull();
  });
  it("hits at once from inside", () => {
    expect(rayBoxFraction(vec3(15, 0, 0), vec3(100, 0, 0), mins, maxs)).toBe(0);
  });
});

describe("fireHitscan", () => {
  it("stops a pellet just short of a wall, with the wall's normal", () => {
    const { pellets } = fireHitscan(WALL, [], EYE, 0, 0, straight(), 0);
    expect(pellets).toHaveLength(1);
    expectWallHit(pellets[0], vec3(256 - DIST_EPSILON, 0, 0), vec3(-1, 0, 0));
  });

  it("misses when the wall is out of range", () => {
    expect(fireHitscan(WALL, [], EYE, 0, 0, straight(200), 0).pellets).toEqual([null]);
  });

  it("isn't stopped by clip brushes", () => {
    const clipped = world(box([100, -512, -512], [120, 512, 512], CONTENTS.PLAYERCLIP), box([256, -512, -512], [288, 512, 512]));
    expectWallHit(fireHitscan(clipped, [], EYE, 0, 0, straight(), 0).pellets[0], vec3(256 - DIST_EPSILON, 0, 0), vec3(-1, 0, 0));
  });

  it("hits the nearest entity in front of the wall, where the ray enters its box", () => {
    const { pellets } = fireHitscan(WALL, [target(7, 200, 232), target(5, 100, 132)], EYE, 0, 0, straight(), 0);
    expect(pellets).toEqual([{ kind: "entity", entity: 5, point: vec3(100, 0, 0) }]);
  });

  it("doesn't hit an entity behind the wall", () => {
    expect(fireHitscan(WALL, [target(5, 300, 332)], EYE, 0, 0, straight(), 0).pellets[0]).toMatchObject({ kind: "world" });
  });

  it("fires one pellet per pellets, drawing two random values for each", () => {
    const shotgun = weapons.shotgun!.hitscan;
    const { pellets, rng } = fireHitscan(WALL, [], EYE, 0, 0, shotgun, 99);
    expect(pellets).toHaveLength(8);
    let expected = 99;
    for (let i = 0; i < 2 * 8; i++) expected = nextRandom(expected).state;
    expect(rng).toBe(expected);
    expect(fireHitscan(WALL, [], EYE, 0, 0, straight(), 5).rng).toBe(nextRandom(nextRandom(5).state).state); // no spread still draws two
  });

  it("spreads the same way for the same seed, and differently for another", () => {
    const shotgun = weapons.shotgun!.hitscan;
    const points = (seed: number) => fireHitscan(WALL, [], EYE, 0, 0, shotgun, seed).pellets.map((p) => p!.kind === "world" && p!.point);
    expect(points(1234)).toEqual(points(1234));
    expect(points(1234)).not.toEqual(points(1235));
  });

  // The wall's face is 256 units away, so a pellet's offset there is 256 * tan(angle off aim) on each axis.
  it("keeps each pellet within the spread on each axis, and uses most of it", () => {
    const shotgun = weapons.shotgun!.hitscan; // 6 degrees horizontal, 4 vertical
    let rng = 42;
    let maxH = 0;
    let maxV = 0;
    for (let shot = 0; shot < 100; shot++) {
      const result = fireHitscan(WALL, [], EYE, 0, 0, shotgun, rng);
      rng = result.rng;
      for (const p of result.pellets as PelletHit[]) {
        const d = p.point.x;
        maxH = Math.max(maxH, (Math.atan(Math.abs(p.point.y) / d) * 180) / Math.PI);
        maxV = Math.max(maxV, (Math.atan(Math.abs(p.point.z) / d) * 180) / Math.PI);
      }
    }
    expect(maxH).toBeLessThanOrEqual(6);
    expect(maxV).toBeLessThanOrEqual(4);
    expect(maxH).toBeGreaterThan(5.5);
    expect(maxV).toBeGreaterThan(3.6);
  });

  it("stops at the arena's east wall when fired down test_combat's range", () => {
    const level = levelFromMap(readRepoFile("maps/test_combat.map"));
    const eye = eyePosition(level.markers.get("range_origin")!, 22);
    const { pellets } = fireHitscan(level.world, [], eye, 0, 0, straight(4096), 0);
    expectWallHit(pellets[0], vec3(768 - DIST_EPSILON, -704, 46), vec3(-1, 0, 0));
  });
});
