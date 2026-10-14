import { describe, expect, it } from "vitest";
import { loadSimConfig, readRepoFile } from "@mandreljs/testing";
import { canSee, updateEnemy } from "@mandreljs/sim/enemy/ai";
import { createEnemy, enemyContext, enemySpawns, type EnemyState } from "@mandreljs/sim/enemy/enemy";
import { CONTENTS } from "@mandreljs/sim/constants";
import { degreesToUnits, NEUTRAL_COMMAND } from "@mandreljs/sim/input";
import { levelFromMap, type Level } from "@mandreljs/sim/level";
import { vec3, type Vec3 } from "@mandreljs/sim/math/vec3";
import { createSim, simContext, step, type SimState } from "@mandreljs/sim/sim";
import { box, surroundingsFor, world } from "@mandreljs/sim/testing/worlds";

const config = loadSimConfig();
const shotgunner = enemyContext(config.enemies).types.get("shotgunner")!;
const FLOOR = box([-2048, -2048, -64], [2048, 2048, 0]);
const OPEN = world(FLOOR);

/** A shotgunner standing at the origin, facing +x (its eye is at z = 46). */
const enemyAt = (index = 0): EnemyState => createEnemy(2, { type: "shotgunner", origin: vec3(0, 0, 24), yaw: 0 }, shotgunner, index);
const eyeAt = (x: number, y: number, z = 46): Vec3 => vec3(x, y, z);
/** Surroundings in the open world with the player's eye at eye. */
const around = (eye: Vec3) => surroundingsFor(OPEN, vec3(eye.x, eye.y, eye.z - 22));

describe("canSee", () => {
  it("sees a point ahead, in range, with nothing in between", () => {
    expect(canSee(enemyAt(), shotgunner, OPEN, eyeAt(500, 0))).toBe(true);
  });

  it("doesn't see beyond sight_range (1500)", () => {
    expect(canSee(enemyAt(), shotgunner, OPEN, eyeAt(1499, 0))).toBe(true);
    expect(canSee(enemyAt(), shotgunner, OPEN, eyeAt(1501, 0))).toBe(false);
  });

  it("sees within 60 degrees of its facing (a 120 degree view), and not beyond", () => {
    const at = (degrees: number): Vec3 => eyeAt(500 * Math.cos((degrees * Math.PI) / 180), 500 * Math.sin((degrees * Math.PI) / 180));
    expect(canSee(enemyAt(), shotgunner, OPEN, at(59))).toBe(true);
    expect(canSee(enemyAt(), shotgunner, OPEN, at(-59))).toBe(true);
    expect(canSee(enemyAt(), shotgunner, OPEN, at(61))).toBe(false);
    expect(canSee(enemyAt(), shotgunner, OPEN, at(180))).toBe(false);
  });

  it("doesn't see through solid walls, but does through windows", () => {
    expect(canSee(enemyAt(), shotgunner, world(FLOOR, box([200, -64, 0], [232, 64, 128])), eyeAt(500, 0))).toBe(false);
    expect(canSee(enemyAt(), shotgunner, world(FLOOR, box([200, -64, 0], [232, 64, 128], CONTENTS.WINDOW)), eyeAt(500, 0))).toBe(true);
  });
});

describe("updateEnemy", () => {
  // Enemy 1 (index 1) thinks on ticks 2, 8, 14, and so on.
  const run = (from: number, to: number, eye: (tick: number) => Vec3, enemy = enemyAt(1)) => {
    const changes: { tick: number; mode: string; events: number }[] = [];
    let state = enemy;
    for (let tick = from; tick <= to; tick++) {
      const update = updateEnemy(state, tick, shotgunner, around(eye(tick)), 0);
      if (update.enemy.mode !== state.mode || update.events.length > 0) changes.push({ tick, mode: update.enemy.mode, events: update.events.length });
      state = update.enemy;
    }
    return { changes, state };
  };

  it("thinks every think_interval, from its offset", () => {
    let enemy = enemyAt(1);
    const thinks: number[] = [];
    for (let tick = 1; tick <= 20; tick++) {
      const next = updateEnemy(enemy, tick, shotgunner, around(eyeAt(-500, 0)), 0).enemy; // behind it: never seen
      if (next.nextThink !== enemy.nextThink) thinks.push(tick);
      enemy = next;
    }
    expect(thinks).toEqual([2, 8, 14, 20]);
  });

  it("notices the player only on a think tick, then hunts them, holding its first attack for the reaction delay", () => {
    // The player steps into view on tick 3; the enemy's next think is tick 8.
    const { changes, state } = run(1, 20, (tick) => (tick < 3 ? eyeAt(-500, 0) : eyeAt(500, 0)));
    expect(changes).toEqual([{ tick: 8, mode: "chase", events: 1 }]);
    expect(state).toMatchObject({ mode: "chase", target: 1, attackReadyAt: 8 + 36 });
  });

  it("while chasing, picks its heading only on think ticks but moves every tick", () => {
    // The player is ahead and to the left, so it heads for the north-east diagonal. Its attack is held off, so it only chases.
    let enemy: EnemyState = { ...enemyAt(0), mode: "chase", target: 1, attackReadyAt: 1000 };
    const rows: { tick: number; heading: number; moving: boolean; x: number }[] = [];
    for (let tick = 1; tick <= 13; tick++) {
      enemy = updateEnemy(enemy, tick, shotgunner, around(eyeAt(600, 400)), 0).enemy;
      rows.push({ tick, heading: enemy.idealYaw, moving: enemy.moving, x: enemy.origin.x });
    }
    const changed = rows.filter((r, i) => i > 0 && (r.heading !== rows[i - 1]!.heading || r.moving !== rows[i - 1]!.moving)).map((r) => r.tick);
    expect(changed.every((t) => t % 6 === 1)).toBe(true); // index 0 thinks on ticks 1, 7, 13
    expect(rows[0]).toMatchObject({ heading: 8192, moving: true });
    const moved = rows.filter((r, i) => i > 0 && r.x !== rows[i - 1]!.x).length;
    expect(moved).toBeGreaterThanOrEqual(8); // turning toward 45 degrees first, then a step every tick
  });

  it("reports the sighting", () => {
    const update = updateEnemy(enemyAt(0), 1, shotgunner, around(eyeAt(500, 0)), 0);
    expect(update.events).toEqual([{ type: "sighted", entity: 2, target: 1 }]);
  });
});

describe("attacking", () => {
  const PLAYER_AT = vec3(300, 0, 24);
  /** A chasing shotgunner at the origin (index 0: thinks on ticks 1, 7, 13, ...), hunting the player. */
  const hunter = (overrides: Partial<EnemyState> = {}): EnemyState => ({ ...enemyAt(0), mode: "chase", target: 1, ...overrides });
  /** Runs ticks 1..count; returns the enemy after each tick and the ticks it fired on. */
  function run(enemy: EnemyState, count: number, s = surroundingsFor(OPEN, PLAYER_AT)) {
    const states: EnemyState[] = [];
    const shots: { tick: number; yaw: number; pitch: number }[] = [];
    let state = enemy;
    for (let tick = 1; tick <= count; tick++) {
      const update = updateEnemy(state, tick, shotgunner, s, 0);
      state = update.enemy;
      states.push(state);
      if (update.shot) shots.push({ tick, yaw: update.shot.yaw, pitch: update.shot.pitch });
    }
    return { states, shots };
  }

  it("starts an attack on a think once it may, stands through the 0.4 s wind-up, fires, then cools down for 1.5 s", () => {
    const { states, shots } = run(hunter(), 200);
    expect(states[0]).toMatchObject({ mode: "attack", fireAt: 1 + 24, moving: false });
    expect(states.slice(0, 24).every((e) => e.mode === "attack" && e.origin.x === 0)).toBe(true);
    // Fires on tick 25, then may attack again from tick 25 + 90 = 115: its next think is 115, so the next shot is on 139.
    expect(shots.map((s) => s.tick)).toEqual([25, 139]);
    expect(states[24]).toMatchObject({ mode: "chase", attackReadyAt: 25 + 90 });
  });

  it("holds its first attack until its reaction delay is up", () => {
    const { shots, states } = run(hunter({ attackReadyAt: 37 }), 80);
    expect(states.findIndex((e) => e.mode === "attack") + 1).toBe(37);
    expect(shots[0]!.tick).toBe(37 + 24);
  });

  it("aims where the target was aim_lag (0.2 s) ago, from its eye", () => {
    // Moving at 100 units/s along +y, the player was 20 units back along y 0.2 s ago.
    const moving = surroundingsFor(OPEN, PLAYER_AT, vec3(0, 100, 0));
    const shot = run(hunter(), 30, moving).shots[0]!;
    const radians = (units: number): number => (units * 2 * Math.PI) / 65536;
    expect(radians(shot.yaw - 65536)).toBeCloseTo(Math.atan2(-20, 300), 9);
    expect(radians(shot.pitch)).toBeCloseTo(Math.atan2(24 - 46, Math.hypot(300, 20)), 9);
  });

  it("doesn't attack without a clear shot: through a wall, a window, or another entity", () => {
    const wall = world(FLOOR, box([150, -64, 0], [182, 64, 128]));
    expect(run(hunter(), 60, surroundingsFor(wall, PLAYER_AT)).shots).toEqual([]);
    const window = world(FLOOR, box([150, -64, 0], [182, 64, 128], CONTENTS.WINDOW));
    expect(run(hunter(), 60, surroundingsFor(window, PLAYER_AT)).shots).toEqual([]);
    const crowded = surroundingsFor(OPEN, PLAYER_AT);
    const between = { ...crowded, targets: [...crowded.targets, { id: 3, mins: vec3(134, -16, 0), maxs: vec3(166, 16, 56) }] };
    expect(run(hunter(), 60, between).shots).toEqual([]);
  });

  it("turns to face its target while winding up", () => {
    const behind = hunter({ yaw: degreesToUnits(90) }); // facing +y, the player is along +x
    const { states } = run(behind, 24);
    // Turning at 607 units a tick: a quarter turn (16384) takes 27 ticks, so the wind-up ends before it's all the way round.
    expect(states.map((e) => e.yaw)).toEqual(Array.from({ length: 24 }, (_, i) => degreesToUnits(90) - 607 * (i + 1)));
  });

  it("goes back to the target it remembered when its target is gone, or stands if there's none", () => {
    // Hunting entity 3, which no longer exists; remembers the player (1).
    const back = run(hunter({ target: 3, oldTarget: 1, attackReadyAt: 1000 }), 1).states[0]!;
    expect(back).toMatchObject({ mode: "chase", target: 1, oldTarget: 0, attackReadyAt: 1 + 36 });
    const alone = run(hunter({ target: 3, oldTarget: 0 }), 1).states[0]!;
    expect(alone).toMatchObject({ mode: "idle", target: 0 });
  });
});

describe("enemies in the sim", () => {
  const openLevel: Level = { world: OPEN, entities: [{ classname: "worldspawn" }], markers: new Map(), playerStart: null };

  /** The tick each enemy first started chasing, by enemy index. */
  function chaseTicks(level: Level, sim: SimState, ticks: number): (number | null)[] {
    const ctx = simContext(level, config);
    const started: (number | null)[] = sim.enemies.map(() => null);
    let state = sim;
    for (let t = 0; t < ticks; t++) {
      state = step(state, NEUTRAL_COMMAND, ctx).state;
      state.enemies.forEach((e, i) => {
        if (e.mode === "chase" && started[i] === null) started[i] = state.tick;
      });
    }
    return started;
  }

  it("gives enemies with different offsets different think ticks", () => {
    const west = degreesToUnits(180);
    const spawns = [0, 1, 2].map((i) => ({ type: "shotgunner", origin: vec3(400, i * 64, 24), yaw: west }));
    const sim = createSim(config, { origin: vec3(0, 0, 24), yaw: 0 }, 0, spawns);
    expect(sim.enemies.map((e) => e.id)).toEqual([2, 3, 4]);
    expect(sim.nextEntityId).toBe(5);
    expect(chaseTicks(openLevel, sim, 12)).toEqual([1, 2, 3]);
  });

  describe("test_combat", () => {
    const level = levelFromMap(readRepoFile("example/maps/test_combat.map"));
    const spawns = enemySpawns(level, enemyContext(config.enemies));
    const at = (marker: string): SimState => createSim(config, { origin: level.markers.get(marker)!, yaw: 0 }, 0, spawns);

    it("the east shotgunner doesn't see the player at west through the center wall", () => {
      expect(chaseTicks(level, at("west"), 120)[0]).toBeNull();
    });

    it("the north_east shotgunner sees the player at north_west across the open floor", () => {
      expect(chaseTicks(level, at("north_west"), 12)[1]).toBe(2);
    });
  });
});
