import { describe, expect, it } from "vitest";
import { loadEnemiesData, readRepoFile } from "@mandreljs/testing";
import { DIST_EPSILON } from "@mandreljs/sim/collision/trace";
import { createEnemy, enemyContext, enemySpawns } from "@mandreljs/sim/enemy/enemy";
import { levelFromMap, type Level } from "@mandreljs/sim/level";
import { vec3 } from "@mandreljs/sim/math/vec3";
import { box, world } from "@mandreljs/sim/testing/worlds";

const ctx = enemyContext(loadEnemiesData());
const shotgunner = ctx.types.get("shotgunner")!;

/** A level with a floor (top at z = 0) and the given entities after worldspawn. */
const levelWith = (...entities: Record<string, string>[]): Level => ({
  world: world(box([-512, -512, -64], [512, 512, 0])),
  entities: [{ classname: "worldspawn" }, ...entities],
  markers: new Map(),
  playerStart: null,
});

describe("enemyContext", () => {
  it("converts the data's times to ticks and the view cone to a cosine", () => {
    expect(shotgunner.thinkTicks).toBe(6); // 0.1 s
    expect(shotgunner.reactionTicks).toBe(36); // 0.6 s
    expect(shotgunner.viewCos).toBeCloseTo(0.5, 12); // 120 degrees wide: 60 either side
    expect(ctx.byClassname.get("monster_shotgunner")).toBe("shotgunner");
  });
});

describe("enemySpawns", () => {
  it("spawns each monster entity standing on the floor, facing its angle", () => {
    const spawns = enemySpawns(levelWith({ classname: "monster_shotgunner", origin: "64 32 24", angle: "90" }), ctx);
    expect(spawns).toEqual([{ type: "shotgunner", origin: vec3(64, 32, 24 + DIST_EPSILON), yaw: 16384 }]);
  });

  it("drops one placed in the air, and leaves one with no floor within reach", () => {
    const spawns = enemySpawns(
      levelWith({ classname: "monster_shotgunner", origin: "0 0 200" }, { classname: "monster_shotgunner", origin: "0 0 400" }),
      ctx,
    );
    expect(spawns.map((s) => s.origin)).toEqual([vec3(0, 0, 24 + DIST_EPSILON), vec3(0, 0, 400)]);
  });

  it("skips entities that aren't enemies", () => {
    expect(enemySpawns(levelWith({ classname: "light", origin: "0 0 64" }, { classname: "info_marker", name: "x" }), ctx)).toEqual([]);
  });

  it("spawns test_combat's two shotgunners, facing west", () => {
    const spawns = enemySpawns(levelFromMap(readRepoFile("example/maps/test_combat.map")), ctx);
    expect(spawns).toEqual([
      { type: "shotgunner", origin: vec3(512, 0, 24 + DIST_EPSILON), yaw: 32768 },
      { type: "shotgunner", origin: vec3(512, 640, 24 + DIST_EPSILON), yaw: 32768 },
    ]);
  });

  it("stands greybox_01's ledge shotgunner on the ledge it was placed on", () => {
    const spawns = enemySpawns(levelFromMap(readRepoFile("example/maps/greybox_01.map")), ctx);
    expect(spawns[1]!.origin).toEqual(vec3(1200, 128, 120 + DIST_EPSILON));
  });
});

describe("createEnemy", () => {
  const spawn = { type: "shotgunner", origin: vec3(0, 0, 24), yaw: 0 };

  it("starts idle at full health, hunting nothing", () => {
    expect(createEnemy(5, spawn, shotgunner, 0)).toEqual({
      id: 5, type: "shotgunner", origin: vec3(0, 0, 24), yaw: 0, idealYaw: 0, moving: false, health: 40, mode: "idle",
      nextThink: 1, target: 0, oldTarget: 0, attackReadyAt: 0, painUntil: 0, fireAt: 0,
    });
  });

  it("offsets each enemy's first think by its place in the level, wrapping at the think interval", () => {
    expect([0, 1, 2, 5, 6, 7].map((i) => createEnemy(2, spawn, shotgunner, i).nextThink)).toEqual([1, 2, 3, 6, 1, 2]);
  });
});
