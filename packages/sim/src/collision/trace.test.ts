import { describe, expect, it } from "vitest";
import { CONTENTS } from "../constants";
import { vec3, ZERO } from "../math/vec3";
import { box, rampX, world } from "../testing/worlds";
import { DIST_EPSILON, trace } from "./trace";

const PLAYER_MINS = vec3(-16, -16, -24);
const PLAYER_MAXS = vec3(16, 16, 32);
const ALL = CONTENTS.SOLID | CONTENTS.WINDOW | CONTENTS.PLAYERCLIP | CONTENTS.MONSTERCLIP;

describe("trace against a box", () => {
  const cube = world(box([0, 0, 0], [64, 64, 64]));

  it("stops a point short of the face by DIST_EPSILON, with the face's normal", () => {
    const t = trace(cube, vec3(-100, 32, 32), vec3(100, 32, 32), ZERO, ZERO, ALL);
    expect(t.endpos.x).toBeCloseTo(-DIST_EPSILON, 10);
    expect(t.normal).toEqual(vec3(-1, 0, 0));
    expect(t.startSolid).toBe(false);
  });

  it("stops a box by its extents", () => {
    const t = trace(cube, vec3(-100, 32, 32), vec3(100, 32, 32), PLAYER_MINS, PLAYER_MAXS, ALL);
    expect(t.endpos.x).toBeCloseTo(-16 - DIST_EPSILON, 10);
    expect(t.fraction).toBeCloseTo((100 - 16 - DIST_EPSILON) / 200, 10);
  });

  it("reaches the end when nothing is in the way", () => {
    const t = trace(cube, vec3(-100, 32, 200), vec3(100, 32, 200), PLAYER_MINS, PLAYER_MAXS, ALL);
    expect(t.fraction).toBe(1);
    expect(t.endpos).toEqual(vec3(100, 32, 200));
    expect(t.normal).toEqual(ZERO);
  });

  it("reports starting inside, and being inside the whole way", () => {
    const leaving = trace(cube, vec3(32, 32, 32), vec3(200, 32, 32), ZERO, ZERO, ALL);
    expect(leaving.startSolid).toBe(true);
    expect(leaving.allSolid).toBe(false);
    const stuck = trace(cube, vec3(30, 32, 32), vec3(34, 32, 32), ZERO, ZERO, ALL);
    expect(stuck.allSolid).toBe(true);
  });

  it("tests position when start equals end", () => {
    expect(trace(cube, vec3(70, 32, 32), vec3(70, 32, 32), PLAYER_MINS, PLAYER_MAXS, ALL).allSolid).toBe(true);
    expect(trace(cube, vec3(90, 32, 32), vec3(90, 32, 32), PLAYER_MINS, PLAYER_MAXS, ALL)).toMatchObject({ fraction: 1, allSolid: false });
  });

  it("only collides with brushes whose contents match the mask", () => {
    const clip = world(box([0, 0, 0], [64, 64, 64], CONTENTS.PLAYERCLIP));
    const start = vec3(-100, 32, 32);
    const end = vec3(100, 32, 32);
    expect(trace(clip, start, end, ZERO, ZERO, CONTENTS.SOLID | CONTENTS.PLAYERCLIP).fraction).toBeLessThan(1);
    expect(trace(clip, start, end, ZERO, ZERO, CONTENTS.SOLID | CONTENTS.MONSTERCLIP).fraction).toBe(1);
  });
});

describe("trace against a slope", () => {
  // Rises from 0 at x = 0 to 32 at x = 64.
  const ramp = rampX(0, 64, 0, 64, -16, 0, 32);
  const slope = world(ramp);
  const n = { x: -32 / Math.hypot(32, 64), z: 64 / Math.hypot(32, 64) };

  it("lands a dropped point on the surface with the slope's normal", () => {
    const t = trace(slope, vec3(32, 32, 100), vec3(32, 32, -100), ZERO, ZERO, ALL);
    expect(t.normal.x).toBeCloseTo(n.x, 10);
    expect(t.normal.z).toBeCloseTo(n.z, 10);
    // The surface is at z = 16 here; the stand-off is along the normal, so slightly more than 1/32 vertically.
    expect(t.endpos.z).toBeCloseTo(16 + DIST_EPSILON / n.z, 6);
  });

  it("doesn't snag a box just above the high edge (needs the +z bevel)", () => {
    // The box's bottom is at 36, above the ramp's top at 32: clearly not touching.
    const p = vec3(72, 32, 60);
    expect(trace(slope, p, p, PLAYER_MINS, PLAYER_MAXS, ALL).allSolid).toBe(false);
    // Without the bevel, the pushed-out slope plane reaches up to z = 72 there and wrongly contains the box.
    // (Bounds are widened so the trace's bounding-box broad phase doesn't hide the planes' mistake.)
    const noBevel = world({
      ...ramp,
      planes: ramp.planes.filter((pl) => pl.normal.z !== 1),
      maxs: vec3(ramp.maxs.x, ramp.maxs.y, 1000),
    });
    expect(trace(noBevel, p, p, PLAYER_MINS, PLAYER_MAXS, ALL).allSolid).toBe(true);
  });
});
