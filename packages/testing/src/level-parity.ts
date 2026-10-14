// Comparing a level loaded from a .map with the same level loaded from its
// compiled .bsp. qbsp reorders brushes and stores planes as 32-bit floats, so
// brushes are matched by shape, and planes and sweep results to within float
// precision.

import type { Plane } from "@hollow-coil/sim/collision/plane";
import { trace, type CollisionBrush } from "@hollow-coil/sim/collision/trace";
import type { Level } from "@hollow-coil/sim/level";
import { vec3, ZERO, type Vec3 } from "@hollow-coil/sim/math/vec3";
import { nextRandom, seedRandom } from "@hollow-coil/sim/rng";

export const NORMAL_TOLERANCE = 1e-5;
export const DIST_TOLERANCE = 1e-3;

export const near = (a: Vec3, b: Vec3, tolerance: number): boolean =>
  Math.abs(a.x - b.x) < tolerance && Math.abs(a.y - b.y) < tolerance && Math.abs(a.z - b.z) < tolerance;

const samePlane = (a: Plane, b: Plane): boolean => near(a.normal, b.normal, NORMAL_TOLERANCE) && Math.abs(a.dist - b.dist) < DIST_TOLERANCE;

/** Same contents, bounds, and planes (in any order), to within float precision. */
export const sameBrush = (a: CollisionBrush, b: CollisionBrush): boolean =>
  a.contents === b.contents &&
  a.planes.length === b.planes.length &&
  a.planes.every((p) => b.planes.some((q) => samePlane(p, q))) &&
  near(a.mins, b.mins, DIST_TOLERANCE) &&
  near(a.maxs, b.maxs, DIST_TOLERANCE);

const show = (v: Vec3): string => `(${v.x}, ${v.y}, ${v.z})`;

/** Problems pairing the .map level's brushes one to one with the .bsp level's; empty when they match. */
export function brushMismatches(map: Level, bsp: Level): string[] {
  const problems: string[] = [];
  if (map.world.brushes.length !== bsp.world.brushes.length) {
    problems.push(`${map.world.brushes.length} brushes in the .map, ${bsp.world.brushes.length} in the .bsp`);
  }
  map.world.brushes.forEach((brush, i) => {
    const matches = bsp.world.brushes.filter((b) => sameBrush(brush, b)).length;
    if (matches !== 1) problems.push(`.map brush ${i} at ${show(brush.mins)}-${show(brush.maxs)} matches ${matches} .bsp brushes`);
  });
  return problems;
}

export interface SweepOptions {
  /** The box to sweep; sweeps alternate between it and a point. */
  readonly hull: { readonly mins: Vec3; readonly maxs: Vec3 };
  /** Where sweeps start. */
  readonly region: { readonly mins: Vec3; readonly maxs: Vec3 };
  /** The longest move along each axis. */
  readonly reach: number;
  readonly mask: number;
  readonly count: number;
  readonly seed: number;
}

export interface SweepComparison {
  /** Sweeps that started clear and hit something, so the comparison means something. */
  readonly hits: number;
  /** One line per sweep whose results differ; empty when they all agree. */
  readonly differences: readonly string[];
}

/** Sweeps seeded random moves through both levels and compares where they stop, the normal hit, and solidity. */
export function compareSweeps(a: Level, b: Level, options: SweepOptions): SweepComparison {
  let rng = seedRandom(options.seed);
  const random = (lo: number, hi: number): number => {
    const r = nextRandom(rng);
    rng = r.state;
    return lo + r.value * (hi - lo);
  };
  const { region, reach } = options;
  let hits = 0;
  const differences: string[] = [];
  for (let i = 0; i < options.count; i++) {
    const start = vec3(random(region.mins.x, region.maxs.x), random(region.mins.y, region.maxs.y), random(region.mins.z, region.maxs.z));
    const end = vec3(start.x + random(-reach, reach), start.y + random(-reach, reach), start.z + random(-reach, reach));
    const { mins, maxs } = i % 2 === 0 ? options.hull : { mins: ZERO, maxs: ZERO };
    const ra = trace(a.world, start, end, mins, maxs, options.mask);
    const rb = trace(b.world, start, end, mins, maxs, options.mask);
    if (ra.fraction < 1 && !ra.startSolid) hits++;
    const agree =
      ra.startSolid === rb.startSolid &&
      ra.allSolid === rb.allSolid &&
      near(ra.endpos, rb.endpos, DIST_TOLERANCE) &&
      near(ra.normal, rb.normal, NORMAL_TOLERANCE);
    if (!agree) {
      differences.push(
        `sweep ${i} ${show(start)} -> ${show(end)}: ` +
          `stopped at ${show(ra.endpos)} normal ${show(ra.normal)} solid ${ra.startSolid}/${ra.allSolid} vs ` +
          `${show(rb.endpos)} normal ${show(rb.normal)} solid ${rb.startSolid}/${rb.allSolid}`,
      );
    }
  }
  return { hits, differences };
}

/** The bounds of a level's brushes, for choosing where sweeps start. */
export function brushBounds(level: Level): { mins: Vec3; maxs: Vec3 } {
  const brushes = level.world.brushes;
  return {
    mins: vec3(Math.min(...brushes.map((b) => b.mins.x)), Math.min(...brushes.map((b) => b.mins.y)), Math.min(...brushes.map((b) => b.mins.z))),
    maxs: vec3(Math.max(...brushes.map((b) => b.maxs.x)), Math.max(...brushes.map((b) => b.maxs.y)), Math.max(...brushes.map((b) => b.maxs.z))),
  };
}
