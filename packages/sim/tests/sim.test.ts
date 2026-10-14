import { describe, expect, it } from "vitest";
import { loadSimConfig, readRepoFile } from "@hollow-coil/testing";
import { DIST_EPSILON } from "@hollow-coil/sim/collision/trace";
import { BUTTON_ATTACK, BUTTON_JUMP, NEUTRAL_COMMAND, type InputCommand } from "@hollow-coil/sim/input";
import { levelFromMap } from "@hollow-coil/sim/level";
import { vec3 } from "@hollow-coil/sim/math/vec3";
import { createSim, PLAYER_ID, simContext, SPAWN_RAISE, step, type SimState } from "@hollow-coil/sim/sim";
import { hashState, restore, snapshot } from "@hollow-coil/sim/snapshot";

const config = loadSimConfig();
const level = levelFromMap(readRepoFile("maps/test_movement.map"));
const ctx = simContext(level, config);

// Inputs that exercise running, turning, strafing, jumping, firing, and switching weapons.
const script = (tick: number): InputCommand => ({
  ...NEUTRAL_COMMAND,
  yaw: (tick * 97) % 65536,
  forward: 127,
  side: tick % 120 < 60 ? 64 : -64,
  buttons: (tick % 90 < 3 ? BUTTON_JUMP : 0) | (tick % 50 < 30 ? BUTTON_ATTACK : 0),
  weapon: tick % 200 === 100 ? 2 : tick % 200 === 0 ? 1 : 0,
});

function simulate(start: SimState, fromTick: number, toTick: number): { state: SimState; hashes: string[] } {
  let state = start;
  const hashes: string[] = [];
  for (let t = fromTick; t < toTick; t++) {
    state = step(state, script(t), ctx).state;
    hashes.push(hashState(state));
  }
  return { state, hashes };
}

const spawnAtCourseStart = () => createSim(config, { origin: level.markers.get("course_start")!, yaw: 0 }, 42);

describe("spawning", () => {
  it("raises the spawn origin and settles onto the floor on the first tick", () => {
    const sim = spawnAtCourseStart();
    expect(sim.player).toMatchObject({ id: PLAYER_ID, onGround: false, health: config.player.health });
    expect(sim.player.origin).toEqual(vec3(-64, -208, 24 + SPAWN_RAISE));
    const after = step(sim, NEUTRAL_COMMAND, ctx).state;
    expect(after.player.onGround).toBe(true);
    expect(after.player.origin.z).toBeCloseTo(24 + DIST_EPSILON, 10);
    expect(after.tick).toBe(1);
  });

  it("keeps the latest command's view angles", () => {
    const after = step(spawnAtCourseStart(), { ...NEUTRAL_COMMAND, yaw: 16384, pitch: -2000 }, ctx).state;
    expect([after.player.yaw, after.player.pitch]).toEqual([16384, -2000]);
  });
});

describe("weapons", () => {
  it("spawns holding the starting weapon, ready", () => {
    expect(spawnAtCourseStart().player.weapon).toEqual({ current: "pistol", desired: "pistol", phase: "ready", time: 0 });
  });

  it("reports each shot as a fired event, then what its pellet hit", () => {
    const cmd = { ...NEUTRAL_COMMAND, buttons: BUTTON_ATTACK };
    const first = step(spawnAtCourseStart(), cmd, ctx);
    expect(first.events[0]).toEqual({ type: "fired", entity: PLAYER_ID, weapon: "pistol" });
    expect(first.events.slice(1)).toEqual([expect.objectContaining({ type: "hitWall", entity: PLAYER_ID })]);
    expect(first.state.player.weapon).toMatchObject({ phase: "firing", time: 21 });
    expect(step(first.state, cmd, ctx).events).toEqual([]); // cooling down
  });

  it("shoots from the eye where the player is after this tick's move", () => {
    // Running east at full speed, firing straight down: the shot lands under the moved player, not the old position.
    const sim = spawnAtCourseStart();
    const running = { ...sim, player: { ...sim.player, origin: vec3(-64, -208, 24 + DIST_EPSILON), velocity: vec3(320, 0, 0), onGround: true } };
    const { state, events } = step(running, { ...NEUTRAL_COMMAND, forward: 127, pitch: -16384, buttons: BUTTON_ATTACK }, ctx);
    const hit = events.find((e) => e.type === "hitWall");
    if (hit?.type !== "hitWall") throw new Error("expected the shot to hit the floor");
    expect(state.player.origin.x - running.player.origin.x).toBeGreaterThan(4);
    expect(Math.abs(hit.point.x - state.player.origin.x)).toBeLessThan(1); // within the pistol's 1 degree of spread
    expect(hit.point.z).toBeCloseTo(DIST_EPSILON, 10);
  });

  it("draws spread from the sim's RNG only when firing", () => {
    const sim = spawnAtCourseStart();
    expect(step(sim, NEUTRAL_COMMAND, ctx).state.rng).toBe(sim.rng);
    expect(step(sim, { ...NEUTRAL_COMMAND, buttons: BUTTON_ATTACK }, ctx).state.rng).not.toBe(sim.rng);
  });
});

describe("determinism, snapshots, and hashes", () => {
  it("produces the same hash every tick when run twice", () => {
    expect(simulate(spawnAtCourseStart(), 0, 600).hashes).toEqual(simulate(spawnAtCourseStart(), 0, 600).hashes);
  });

  it("re-simulating from a restored snapshot reproduces the same hashes", () => {
    const full = simulate(spawnAtCourseStart(), 0, 600);
    const midway = simulate(spawnAtCourseStart(), 0, 250).state;
    const restored = restore(snapshot(midway));
    expect(hashState(restored)).toBe(hashState(midway));
    const resumed = simulate(restored, 250, 600);
    expect(resumed.hashes).toEqual(full.hashes.slice(250));
    expect(resumed.state).toEqual(full.state);
  });

  it("changes the hash when any value changes", () => {
    const sim = spawnAtCourseStart();
    const base = hashState(sim);
    expect(hashState({ ...sim, tick: 1 })).not.toBe(base);
    expect(hashState({ ...sim, rng: sim.rng + 1 })).not.toBe(base);
    expect(hashState({ ...sim, player: { ...sim.player, origin: vec3(-64, -208, 25.000001) } })).not.toBe(base);
    expect(hashState({ ...sim, player: { ...sim.player, onGround: true } })).not.toBe(base);
  });

  it("doesn't depend on key order, and treats -0 like 0", () => {
    const sim = spawnAtCourseStart();
    const reordered = { player: sim.player, nextEntityId: sim.nextEntityId, rng: sim.rng, tick: sim.tick };
    expect(hashState(reordered)).toBe(hashState(sim));
    expect(hashState({ ...sim, player: { ...sim.player, velocity: vec3(-0, 0, -0) } })).toBe(hashState(sim));
  });
});
