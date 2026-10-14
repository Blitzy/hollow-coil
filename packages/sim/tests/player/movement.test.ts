import { describe, expect, it } from "vitest";
import { loadPlayerData } from "@mandreljs/tools/testing";
import { TICK_RATE } from "@mandreljs/sim/constants";
import { hullFromData } from "@mandreljs/sim/data";
import { BUTTON_JUMP, NEUTRAL_COMMAND, type InputCommand } from "@mandreljs/sim/input";
import { length, vec3, ZERO, type Vec3 } from "@mandreljs/sim/math/vec3";
import { box, rampX, world } from "@mandreljs/sim/testing/worlds";
import { DIST_EPSILON, type CollisionWorld } from "@mandreljs/sim/collision/trace";
import {
  accelerate, airAccelerate, asWallIfSteep, categorizePosition, clipVelocity, friction, playerMove, withoutPushInto,
  type MovementContext, type Mover, type PlayerBody,
} from "@mandreljs/sim/player/movement";

const player = loadPlayerData();
const mv = player.movement;
const dt = 1 / TICK_RATE;
const X = vec3(1, 0, 0);
const Y = vec3(0, 1, 0);

const context = (w: CollisionWorld): MovementContext => ({ world: w, hull: hullFromData(player.hull), movement: mv });
const body = (origin: Vec3, velocity: Vec3 = ZERO): PlayerBody => ({ origin, velocity, onGround: false, jumpHeld: false });
const mover = (origin: Vec3, velocity: Vec3, onGround: boolean): Mover => ({ origin, velocity, onGround, jumpHeld: false });

const RUN_EAST: InputCommand = { ...NEUTRAL_COMMAND, forward: 127 };

function run(ctx: MovementContext, start: PlayerBody, seconds: number, cmd: (tick: number) => InputCommand = () => RUN_EAST): PlayerBody[] {
  const states = [start];
  for (let tick = 0; tick < Math.round(seconds * TICK_RATE); tick++) states.push(playerMove(states.at(-1)!, cmd(tick), ctx));
  return states;
}

// A big floor whose top is at z = 0. A standing player rests 1/32 above it (the trace stand-off),
// so their origin is at STAND_Z. A box exactly touching a surface counts as inside it.
const FLOOR = box([-1024, -1024, -16], [1024, 1024, 0]);
const STAND_Z = 24 + DIST_EPSILON;

describe("clipVelocity", () => {
  it("removes the part of the velocity going into a floor or wall", () => {
    expect(clipVelocity(vec3(100, 0, -50), vec3(0, 0, 1), 1)).toEqual(vec3(100, 0, 0));
    expect(clipVelocity(vec3(100, 50, 0), vec3(-1, 0, 0), 1)).toEqual(vec3(0, 50, 0));
  });

  it("snaps tiny components to zero", () => {
    expect(clipVelocity(vec3(100, 0.05, -10), vec3(0, 0, 1), 1)).toEqual(vec3(100, 0, 0));
  });
});

describe("accelerate", () => {
  it("adds accel * dt * wishSpeed per tick and never passes the wish speed", () => {
    let v = ZERO;
    v = accelerate(v, X, 320, 10);
    expect(v.x).toBeCloseTo(10 * dt * 320, 10);
    for (let i = 0; i < 20; i++) v = accelerate(v, X, 320, 10);
    expect(v.x).toBe(320);
  });

  it("does nothing when already faster than the wish speed in that direction", () => {
    expect(accelerate(vec3(400, 0, 0), X, 320, 10)).toEqual(vec3(400, 0, 0));
  });
});

describe("airAccelerate", () => {
  it("caps the speed gained along the wish direction", () => {
    const v = airAccelerate(ZERO, X, 320, mv.air_accelerate, mv.air_wish_speed_cap);
    expect(v.x).toBe(30);
    expect(airAccelerate(v, X, 320, mv.air_accelerate, mv.air_wish_speed_cap)).toEqual(v);
  });

  it("uses the uncapped wish speed for the rate, so strafing sideways gains speed", () => {
    // Moving east at full speed, wishing north: the north component can grow by up to 30.
    const v = airAccelerate(vec3(320, 0, 0), Y, 320, mv.air_accelerate, mv.air_wish_speed_cap);
    expect(v.y).toBe(30); // rate 10 * 320 / 60 = 53.3 per tick, limited by the cap of 30
    expect(length(v)).toBeGreaterThan(320);
    // With a small wish speed, the rate (10 * 60 / 60 = 10) is what limits it.
    expect(airAccelerate(ZERO, Y, 60, mv.air_accelerate, mv.air_wish_speed_cap).y).toBeCloseTo(10, 10);
  });
});

describe("friction", () => {
  const ctx = context(world(FLOOR));

  it("slows by speed * friction * dt above the stop speed", () => {
    const m = mover(vec3(0, 0, STAND_Z), vec3(300, 0, 0), true);
    friction(m, ctx);
    expect(m.velocity.x).toBeCloseTo(300 - 300 * mv.friction * dt, 10);
  });

  it("uses the stop speed as a floor for the slowdown", () => {
    const m = mover(vec3(0, 0, STAND_Z), vec3(50, 0, 0), true);
    friction(m, ctx);
    expect(m.velocity.x).toBeCloseTo(50 - mv.stop_speed * mv.friction * dt, 10);
  });

  it("stops horizontal movement below 1 unit per second", () => {
    const m = mover(vec3(0, 0, STAND_Z), vec3(0.5, 0.5, 0), true);
    friction(m, ctx);
    expect(m.velocity).toEqual(ZERO);
  });

  it("doesn't apply in the air", () => {
    const m = mover(vec3(0, 0, 200), vec3(300, 0, 0), false);
    friction(m, ctx);
    expect(m.velocity.x).toBe(300);
  });

  it("doubles near a drop-off and not on open floor", () => {
    const ledge = context(world(box([-512, -512, -16], [0, 512, 0]))); // floor ends at x = 0
    const nearEdge = mover(vec3(-10, 0, STAND_Z), vec3(300, 0, 0), true); // probe at x = 6 is over the drop
    const awayFromEdge = mover(vec3(-40, 0, STAND_Z), vec3(300, 0, 0), true); // probe at x = -24 is over floor
    friction(nearEdge, ledge);
    friction(awayFromEdge, ledge);
    expect(nearEdge.velocity.x).toBeCloseTo(300 - 300 * mv.friction * mv.edge_friction * dt, 10);
    expect(awayFromEdge.velocity.x).toBeCloseTo(300 - 300 * mv.friction * dt, 10);
  });
});

describe("ground", () => {
  it("counts a walkable surface and settles onto it", () => {
    const m = mover(vec3(0, 0, 24.5), ZERO, false);
    categorizePosition(m, context(world(FLOOR)));
    expect(m.onGround).toBe(true);
    expect(m.origin.z).toBeCloseTo(STAND_Z, 10);
  });

  it("treats a box exactly touching the floor as stuck in it", () => {
    const m = mover(vec3(0, 0, 24), ZERO, false);
    categorizePosition(m, context(world(FLOOR)));
    expect(m.onGround).toBe(false); // the ground trace starts solid; spawning raises the origin to avoid this
  });

  it("is never on ground while rising faster than 180", () => {
    const m = mover(vec3(0, 0, 24.5), vec3(0, 0, 200), true);
    categorizePosition(m, context(world(FLOOR)));
    expect(m.onGround).toBe(false);
  });

  it("stands on a slope with normal z above 0.7 but not on a steeper one", () => {
    // Wide ramps with nothing below: 64 over 72 (normal z 0.747) and 64 over 60 (0.684).
    const gentle = context(world(rampX(-36, 36, -256, 256, -512, -32, 32)));
    const steep = context(world(rampX(-30, 30, -256, 256, -512, -32, 32)));
    const onGentle = run(gentle, body(vec3(0, 0, 100)), 1, () => NEUTRAL_COMMAND).at(-1)!;
    const onSteep = run(steep, body(vec3(0, 0, 100)), 0.5, () => NEUTRAL_COMMAND).at(-1)!;
    expect(onGentle.onGround).toBe(true);
    expect(onGentle.velocity).toEqual(ZERO);
    expect(onSteep.onGround).toBe(false);
  });
});

describe("walking and steps", () => {
  const stepWorld = (height: number) => context(world(FLOOR, box([256, -512, 0], [1024, 512, height])));
  const start = { ...body(vec3(64, 0, STAND_Z)), onGround: true };

  it("reaches max ground speed and holds it", () => {
    const states = run(context(world(FLOOR)), start, 1);
    expect(states.at(-1)!.velocity.x).toBeCloseTo(mv.max_ground_speed, 6);
    expect(states.at(-1)!.origin.z).toBeCloseTo(STAND_Z, 6);
  });

  it("walks up an 18-unit step", () => {
    const end = run(stepWorld(18), start, 1.5).at(-1)!;
    expect(end.origin.x).toBeGreaterThan(256 + 16);
    expect(end.origin.z).toBeCloseTo(18 + 24, 1);
    expect(end.onGround).toBe(true);
  });

  it("is blocked by a 20-unit step", () => {
    const end = run(stepWorld(20), start, 1.5).at(-1)!;
    expect(end.origin.x).toBeCloseTo(256 - 16 - DIST_EPSILON, 6);
    expect(end.origin.z).toBeCloseTo(STAND_Z, 6);
    expect(end.velocity.x).toBe(0);
  });

  it("slides smoothly down a slope too steep to stand on, without stopping", () => {
    // Rises 128 over 64 (63 degrees). Sliding along it used to stop dead every so often,
    // when rounding made the slide hit the same plane twice (fixed with Quake 3's nudge).
    const steep = context(world(FLOOR, rampX(256, 320, -512, 512, -16, 0, 128), box([320, -512, 0], [640, 512, 128])));
    const states = run(steep, body(vec3(290, 0, 150)), 1, () => NEUTRAL_COMMAND);
    const firstContact = states.findIndex((s) => s.velocity.x < 0);
    const landed = states.findIndex((s) => s.onGround);
    expect(firstContact).toBeGreaterThan(0);
    expect(landed).toBeGreaterThan(firstContact);
    for (let i = firstContact + 1; i < landed; i++) {
      expect(states[i]!.origin.z, `tick ${i}`).toBeLessThan(states[i - 1]!.origin.z);
      expect(length(states[i]!.velocity), `tick ${i}`).toBeGreaterThan(length(states[i - 1]!.velocity) - 1e-9);
    }
  });

  describe("steep slopes (a deliberate departure from QuakeWorld)", () => {
    // 63 degrees: in QuakeWorld, holding forward into it slowly climbs it.
    const steep = () => context(world(FLOOR, rampX(256, 320, -512, 512, -16, 0, 128), box([320, -512, 0], [640, 512, 128])));
    const holdForward = (start: PlayerBody, seconds: number, side = 0) =>
      run(steep(), start, seconds, () => ({ ...RUN_EAST, side }));

    it("can't be climbed by holding forward from the floor; the player stays put like at a wall", () => {
      const states = holdForward({ ...body(vec3(200, 0, STAND_Z)), onGround: true }, 4);
      expect(Math.max(...states.map((s) => s.origin.z))).toBeCloseTo(STAND_Z, 6);
      expect(states.slice(60).every((s) => s.onGround)).toBe(true); // no hopping at the foot
      // Pressed against the slope's foot (x = 256), minus the hull's 16, give or take the sloped stand-off.
      expect(states.at(-1)!.origin.x).toBeCloseTo(240, 1);
    });

    it("can't be climbed by holding forward on it; the player slides down", () => {
      const states = holdForward(body(vec3(290, 0, 150)), 3);
      expect(states.at(-1)!.origin.z).toBeCloseTo(STAND_Z, 6);
      expect(states.slice(-60).every((s) => s.onGround)).toBe(true);
    });

    it("still allows moving sideways along it", () => {
      const end = holdForward(body(vec3(290, 0, 150)), 2, 127).at(-1)!;
      expect(end.origin.y).toBeLessThan(-200); // strafed right (toward -y) while sliding down
    });

    it("withoutPushInto removes only the horizontal push into the surface", () => {
      const slope = vec3(-0.894, 0, 0.447); // faces -x and up
      const into = withoutPushInto(X, 320, slope);
      expect(into.speed).toBe(0);
      const diagonal = withoutPushInto(vec3(Math.SQRT1_2, Math.SQRT1_2, 0), 320, slope);
      expect(diagonal.dir.x).toBeCloseTo(0, 10);
      expect(diagonal.dir.y).toBeCloseTo(1, 10);
      expect(diagonal.speed).toBeCloseTo(320 * Math.SQRT1_2, 10);
      expect(withoutPushInto(vec3(-1, 0, 0), 320, slope)).toEqual({ dir: vec3(-1, 0, 0), speed: 320 }); // moving away is untouched
    });

    it("asWallIfSteep flattens only too-steep upward surfaces", () => {
      expect(asWallIfSteep(vec3(-0.894, 0, 0.447))).toEqual(vec3(-1, 0, 0));
      const walkable = vec3(-0.447, 0, 0.894);
      expect(asWallIfSteep(walkable)).toBe(walkable);
      const ceiling = vec3(0, 0, -1);
      expect(asWallIfSteep(ceiling)).toBe(ceiling);
    });
  });

  it("refuses to step onto a surface too steep to stand on", () => {
    // Rises 128 over 64 (63 degrees) from x = 256, then a 128-high block.
    const steep = context(world(FLOOR, rampX(256, 320, -512, 512, -16, 0, 128), box([320, -512, 0], [640, 512, 128])));
    const states = run(steep, start, 2);
    expect(Math.max(...states.map((s) => s.origin.z))).toBeLessThan(128);
    expect(states.at(-1)!.origin.x).toBeLessThan(320);
  });
});

describe("jumping", () => {
  const ctx = context(world(FLOOR));
  const standing = { ...body(vec3(0, 0, STAND_Z)), onGround: true };
  const jumpStarts = (states: PlayerBody[]) =>
    states.filter((s, i) => i > 0 && s.velocity.z > 0 && states[i - 1]!.velocity.z <= 0).length;

  it("starts with jump_velocity, minus one tick of gravity", () => {
    const [, first] = run(ctx, standing, dt, () => ({ ...NEUTRAL_COMMAND, buttons: BUTTON_JUMP }));
    expect(first!.velocity.z).toBeCloseTo(mv.jump_velocity - mv.gravity * dt, 10);
    expect(first!.onGround).toBe(false);
  });

  it("doesn't jump again while jump stays held", () => {
    const states = run(ctx, standing, 2, () => ({ ...NEUTRAL_COMMAND, buttons: BUTTON_JUMP }));
    expect(jumpStarts(states)).toBe(1);
  });

  it("jumps again after releasing and pressing", () => {
    // Held for the first second, released for one tick, then held again.
    const states = run(ctx, standing, 2, (t) => ({ ...NEUTRAL_COMMAND, buttons: t === TICK_RATE ? 0 : BUTTON_JUMP }));
    expect(jumpStarts(states)).toBe(2);
  });

  it("skips friction on the tick a jump starts", () => {
    const moving = { ...standing, velocity: vec3(300, 0, 0) };
    const [, jumped] = run(ctx, moving, dt, () => ({ ...NEUTRAL_COMMAND, buttons: BUTTON_JUMP }));
    const [, walked] = run(ctx, moving, dt, () => NEUTRAL_COMMAND);
    expect(jumped!.velocity.x).toBe(300);
    expect(walked!.velocity.x).toBeCloseTo(300 - 300 * mv.friction * dt, 10);
  });

  it("clears about 45 units at the peak of a jump", () => {
    const states = run(ctx, standing, 1, (t) => ({ ...NEUTRAL_COMMAND, buttons: t === 0 ? BUTTON_JUMP : 0 }));
    const peak = Math.max(...states.map((s) => s.origin.z)) - STAND_Z;
    // v^2 / 2g = 270^2 / 1600 = 45.6, a little less with discrete ticks.
    expect(peak).toBeGreaterThan(43);
    expect(peak).toBeLessThan(46);
  });
});
