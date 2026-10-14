import { describe, expect, it } from "vitest";
import { DIST_EPSILON } from "@hollow-coil/sim/collision/trace";
import { ENEMY_MASK } from "@hollow-coil/sim/enemy/enemy";
import { changeYaw, checkBottom, closeEnough, moveStep, moveToward, newChaseDir, yawDelta, type ChaseChooser } from "@hollow-coil/sim/enemy/move";
import { vec3, type Vec3 } from "@hollow-coil/sim/math/vec3";
import { box, world } from "@hollow-coil/sim/testing/worlds";

const HULL = { mins: vec3(-16, -16, -24), maxs: vec3(16, 16, 32) };
const FLOOR = box([-512, -512, -64], [512, 512, 0]);
const STANDING = 24 + DIST_EPSILON;
const deg = (d: number): number => Math.round((d * 65536) / 360);
const step = (w: ReturnType<typeof world>, origin: Vec3, move: Vec3) => moveStep(w, w, origin, move, HULL, ENEMY_MASK);

describe("turning", () => {
  it("measures the short way round", () => {
    expect(yawDelta(64000, 1000)).toBe(2536);
    expect(yawDelta(1000, 64000)).toBe(-2536);
  });

  it("turns toward the ideal by at most the turn speed, either way", () => {
    expect(changeYaw(0, deg(90), 600)).toBe(600);
    expect(changeYaw(0, deg(270), 600)).toBe(65536 - 600);
    expect(changeYaw(deg(90) - 100, deg(90), 600)).toBe(deg(90));
  });
});

describe("moveStep", () => {
  const flat = world(FLOOR);

  it("steps along flat ground, staying on it", () => {
    expect(step(flat, vec3(0, 0, STANDING), vec3(10, 0, 0))).toEqual(vec3(10, 0, STANDING));
  });

  it("climbs a step up to 18 high, and not one higher", () => {
    const up18 = world(FLOOR, box([20, -64, 0], [128, 64, 18]));
    expect(step(up18, vec3(0, 0, STANDING), vec3(10, 0, 0))?.z).toBeCloseTo(18 + STANDING, 9);
    const up20 = world(FLOOR, box([20, -64, 0], [128, 64, 20]));
    expect(step(up20, vec3(0, 0, STANDING), vec3(10, 0, 0))).toBeNull();
  });

  it("steps down off a low step", () => {
    const ledge = world(FLOOR, box([-512, -64, 0], [0, 64, 16]));
    expect(step(ledge, vec3(-16, 0, 16 + STANDING), vec3(40, 0, 0))?.z).toBeCloseTo(STANDING, 9);
  });

  it("won't walk off an edge with no floor within a step", () => {
    const platform = world(box([-512, -64, 0], [0, 64, 64]));
    expect(step(platform, vec3(-20, 0, 64 + STANDING), vec3(30, 0, 0))).toBeNull();
  });

  it("won't let any corner hang over a drop deeper than two steps, but will over a shallow one", () => {
    // A platform ending at x = 0. Standing at x = -20 its box reaches x = -4; one more 10-unit step puts its front corners past the edge.
    const high = world(FLOOR, box([-512, -64, 0], [0, 64, 64]));
    expect(step(high, vec3(-30, 0, 64 + STANDING), vec3(10, 0, 0))).not.toBeNull();
    expect(step(high, vec3(-20, 0, 64 + STANDING), vec3(10, 0, 0))).toBeNull();
    const low = world(FLOOR, box([-512, -64, 0], [0, 64, 16]));
    expect(step(low, vec3(-20, 0, 16 + STANDING), vec3(10, 0, 0))).not.toBeNull();
  });

  it("won't step into a wall", () => {
    const wall = world(FLOOR, box([20, -64, 0], [52, 64, 128]));
    expect(step(wall, vec3(0, 0, STANDING), vec3(10, 0, 0))).toBeNull();
  });

  it("steps from the same height under a low ceiling", () => {
    // Room to stand, but not to rise a step first.
    const low = world(FLOOR, box([-512, -512, 56 + DIST_EPSILON + 4], [512, 512, 128]));
    expect(step(low, vec3(0, 0, STANDING), vec3(10, 0, 0))).toEqual(vec3(10, 0, STANDING));
  });
});

describe("checkBottom", () => {
  it("is true on flat ground and false with corners over a drop", () => {
    const platform = world(box([-512, -64, -64], [0, 64, 0]));
    expect(checkBottom(platform, vec3(-100, 0, STANDING), HULL, ENEMY_MASK)).toBe(true);
    expect(checkBottom(platform, vec3(10, 0, STANDING), HULL, ENEMY_MASK)).toBe(false);
  });
});

describe("closeEnough", () => {
  const a = { mins: vec3(0, 0, 0), maxs: vec3(32, 32, 56) };
  it("is true when the boxes come within the distance (plus Quake's 1-unit growth each)", () => {
    expect(closeEnough(a.mins, a.maxs, vec3(44, 0, 0), vec3(76, 32, 56), 10)).toBe(true); // 12 apart: 10 + 2
    expect(closeEnough(a.mins, a.maxs, vec3(45, 0, 0), vec3(77, 32, 56), 10)).toBe(false);
  });
});

describe("newChaseDir", () => {
  /** A chooser where only the given directions (in degrees) can be stepped in, with fixed random values. */
  const chooser = (open: number[], randoms: number[] = [0.9, 0.9]): ChaseChooser & { tried: number[] } => {
    const tried: number[] = [];
    return {
      tried,
      canStep: (yaw) => {
        tried.push(Math.round((yaw * 360) / 65536));
        return open.includes(Math.round((yaw * 360) / 65536));
      },
      random: () => randoms.shift() ?? 0.9,
    };
  };

  it("goes straight for the diagonal toward the goal", () => {
    expect(newChaseDir(0, { x: 100, y: 100 }, chooser([45]))).toBe(deg(45));
    expect(newChaseDir(0, { x: -100, y: -100 }, chooser([225]))).toBe(deg(225)); // Quake's typo said 215
  });

  it("tries the longer axis first when the diagonal is blocked", () => {
    const c = chooser([0, 90]);
    expect(newChaseDir(0, { x: 50, y: 200 }, c)).toBe(deg(90));
    expect(c.tried).toEqual([45, 90]);
  });

  it("keeps its old heading when there's no direct way, then searches, turning around last", () => {
    expect(newChaseDir(deg(90), { x: 100, y: 0 }, chooser([90]))).toBe(deg(90));
    const c = chooser([270]); // only back the way it came (heading 90)
    expect(newChaseDir(deg(90), { x: -100, y: 0 }, c)).toBe(deg(270));
    expect(c.tried.at(-1)).toBe(270);
  });

  it("gives up when every direction is blocked", () => {
    expect(newChaseDir(0, { x: 100, y: 0 }, chooser([]))).toBeNull();
  });
});

describe("moveToward", () => {
  it("moves dist along the yaw, flat", () => {
    const m = moveToward(deg(90), 10);
    expect(m.x).toBeCloseTo(0, 12);
    expect(m.y).toBeCloseTo(10, 12);
    expect(m.z).toBe(0);
  });
});
