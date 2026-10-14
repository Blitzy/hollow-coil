import { describe, expect, it } from "vitest";
import { loadSimConfig } from "@mandreljs/testing";
import { DIST_EPSILON } from "@mandreljs/sim/collision/trace";
import { updateEnemy } from "@mandreljs/sim/enemy/ai";
import { damageEnemy } from "@mandreljs/sim/enemy/damage";
import { createEnemy, enemyContext, type EnemyState, type EnemyType } from "@mandreljs/sim/enemy/enemy";
import { BUTTON_ATTACK, degreesToUnits, NEUTRAL_COMMAND, type InputCommand } from "@mandreljs/sim/input";
import type { Level } from "@mandreljs/sim/level";
import { vec3 } from "@mandreljs/sim/math/vec3";
import { nextRandom } from "@mandreljs/sim/rng";
import { createSim, simContext, step, type SimConfig, type SimEvent, type SimState } from "@mandreljs/sim/sim";
import { box, surroundingsFor, world } from "@mandreljs/sim/testing/worlds";

const config = loadSimConfig();
const shotgunner = enemyContext(config.enemies).types.get("shotgunner")!;
const withPain = (chance: number): EnemyType => ({ ...shotgunner, data: { ...shotgunner.data, pain: { ...shotgunner.data.pain, chance } } });
const NEVER = withPain(0);
const ALWAYS = withPain(1);
const PLAYER = 1;
const BY_PLAYER = { id: PLAYER, type: null };

const enemy = (overrides: Partial<EnemyState> = {}): EnemyState => ({
  ...createEnemy(2, { type: "shotgunner", origin: vec3(0, 0, 24), yaw: 0 }, shotgunner, 0),
  ...overrides,
});

describe("damageEnemy", () => {
  it("takes the damage off its health and reports it", () => {
    const result = damageEnemy(enemy({ mode: "chase", target: PLAYER }), 14, BY_PLAYER, 10, NEVER, 5);
    expect(result.enemy.health).toBe(26);
    expect(result.events).toEqual([{ type: "damaged", entity: 2, attacker: PLAYER, amount: 14, health: 26 }]);
  });

  it("dies at zero health or below, without rolling for pain", () => {
    for (const amount of [40, 48]) {
      const result = damageEnemy(enemy(), amount, BY_PLAYER, 10, ALWAYS, 5);
      expect(result.enemy).toMatchObject({ mode: "dead", health: 40 - amount });
      expect(result.events.at(-1)).toEqual({ type: "died", entity: 2, attacker: PLAYER });
      expect(result.rng).toBe(5);
    }
  });

  it("ignores damage once dead", () => {
    const dead = enemy({ mode: "dead", health: 0 });
    expect(damageEnemy(dead, 14, BY_PLAYER, 10, ALWAYS, 5)).toEqual({ enemy: dead, rng: 5, events: [] });
  });

  it("turns on whoever hurt it, holding its first attack for the reaction delay", () => {
    const result = damageEnemy(enemy(), 14, BY_PLAYER, 10, NEVER, 5);
    expect(result.enemy).toMatchObject({ mode: "chase", target: PLAYER, attackReadyAt: 10 + 36 });
    expect(result.events).toContainEqual({ type: "sighted", entity: 2, target: PLAYER });
  });

  it("keeps hunting the same attacker without resetting its reaction delay", () => {
    const hunting = enemy({ mode: "chase", target: PLAYER, attackReadyAt: 30 });
    const result = damageEnemy(hunting, 14, BY_PLAYER, 10, NEVER, 5);
    expect(result.enemy.attackReadyAt).toBe(30);
    expect(result.events.some((e) => e.type === "sighted")).toBe(false);
  });

  describe("infighting", () => {
    const huntingPlayer = enemy({ mode: "chase", target: PLAYER });
    const loner: EnemyType = { ...NEVER, data: { ...NEVER.data, fights_own_kind: false } };

    it("turns on an enemy that hurts it, remembering the player to go back to", () => {
      const result = damageEnemy(huntingPlayer, 4, { id: 3, type: "shotgunner" }, 10, NEVER, 5);
      expect(result.enemy).toMatchObject({ target: 3, oldTarget: PLAYER, mode: "chase", attackReadyAt: 10 + 36 });
      expect(result.events).toContainEqual({ type: "sighted", entity: 2, target: 3 });
    });

    it("ignores its own kind unless its type fights its own kind, but always turns on another type", () => {
      expect(damageEnemy(huntingPlayer, 4, { id: 3, type: "shotgunner" }, 10, loner, 5).enemy.target).toBe(PLAYER);
      expect(damageEnemy(huntingPlayer, 4, { id: 3, type: "imp" }, 10, loner, 5).enemy.target).toBe(3);
    });

    it("drops an attack in progress to turn on someone new", () => {
      const winding = enemy({ mode: "attack", target: PLAYER, fireAt: 20 });
      expect(damageEnemy(winding, 4, { id: 3, type: "shotgunner" }, 10, NEVER, 5).enemy.mode).toBe("chase");
    });

    it("turns back on the player who hurts it while it fights another enemy, still remembering the player", () => {
      const fighting = enemy({ mode: "chase", target: 3, oldTarget: PLAYER });
      expect(damageEnemy(fighting, 4, BY_PLAYER, 10, NEVER, 5).enemy).toMatchObject({ target: PLAYER, oldTarget: PLAYER });
    });
  });

  it("flinches when the pain roll comes in under the chance, stunned for the stun time", () => {
    const hurt = damageEnemy(enemy({ mode: "chase", target: PLAYER }), 14, BY_PLAYER, 10, ALWAYS, 5);
    expect(hurt.enemy).toMatchObject({ mode: "pain", painUntil: 10 + 18 });
    expect(hurt.events).toContainEqual({ type: "pain", entity: 2 });
    expect(hurt.rng).toBe(nextRandom(5).state);
    expect(damageEnemy(enemy({ mode: "chase", target: PLAYER }), 14, BY_PLAYER, 10, NEVER, 5).enemy.mode).toBe("chase");
  });

  it("rolls against the data's chance", () => {
    const flinches = Array.from({ length: 400 }, (_, seed) => damageEnemy(enemy({ mode: "chase", target: PLAYER }), 1, BY_PLAYER, 10, shotgunner, seed));
    const share = flinches.filter((r) => r.enemy.mode === "pain").length / flinches.length;
    expect(share).toBeGreaterThan(0.4); // the shotgunner's chance is 0.5
    expect(share).toBeLessThan(0.6);
  });

  it("can't flinch again until the stun ends, and doesn't roll meanwhile", () => {
    const flinching = enemy({ mode: "pain", target: PLAYER, painUntil: 28 });
    const result = damageEnemy(flinching, 1, BY_PLAYER, 20, ALWAYS, 5);
    expect(result.enemy.painUntil).toBe(28);
    expect(result.rng).toBe(5);
  });

  it("recovers on its first think once the stun is over", () => {
    const flinching = enemy({ mode: "pain", target: PLAYER, painUntil: 28, nextThink: 25 });
    const around = surroundingsFor(world(box([-2048, -2048, -64], [2048, 2048, 0])), vec3(-500, 0, 24));
    const at25 = updateEnemy(flinching, 25, shotgunner, around, 0).enemy;
    expect(at25.mode).toBe("pain");
    expect(updateEnemy(at25, 31, shotgunner, around, 0).enemy.mode).toBe("chase");
  });
});

describe("shooting enemies in the sim", () => {
  const level: Level = { world: world(box([-2048, -2048, -64], [2048, 2048, 0]), box([600, -512, 0], [632, 512, 256])), entities: [{ classname: "worldspawn" }], markers: new Map(), playerStart: null };
  const ctx = simContext(level, config);
  const ATTACK: InputCommand = { ...NEUTRAL_COMMAND, buttons: BUTTON_ATTACK };
  const STANDING = 24 + DIST_EPSILON;

  /** The player at the origin facing +x, and one shotgunner at x facing it. */
  const scene = (x: number, cfg: SimConfig = config): SimState =>
    createSim(cfg, { origin: vec3(0, 0, 24), yaw: 0 }, 3, [{ type: "shotgunner", origin: vec3(x, 0, STANDING), yaw: degreesToUnits(180) }]);
  const run = (sim: SimState, cmds: InputCommand[]): { state: SimState; events: SimEvent[] } => {
    let state = sim;
    const events: SimEvent[] = [];
    for (const cmd of cmds) {
      const result = step(state, cmd, ctx);
      state = result.state;
      events.push(...result.events);
    }
    return { state, events };
  };

  it("a pistol shot hits the enemy for the pistol's damage", () => {
    const { state, events } = run(scene(300), [ATTACK]);
    expect(events.filter((e) => e.type === "hitEntity")).toHaveLength(1);
    expect(events).toContainEqual({ type: "damaged", entity: 2, attacker: 1, amount: 14, health: 26 });
    expect(state.enemies[0]!.health).toBe(26);
  });

  it("a shotgun blast adds its pellets into one hit; eight at point blank kill a shotgunner", () => {
    const shotgunFirst = { ...config, player: { ...config.player, starting_weapon: "shotgun" } };
    const { state, events } = run(scene(64, shotgunFirst), [ATTACK]);
    expect(events.filter((e) => e.type === "hitEntity")).toHaveLength(8);
    expect(events.filter((e) => e.type === "damaged")).toEqual([{ type: "damaged", entity: 2, attacker: 1, amount: 48, health: -8 }]);
    expect(events).toContainEqual({ type: "died", entity: 2, attacker: 1 });
    expect(state.enemies[0]!.mode).toBe("dead");
  });

  it("the dead stop acting, and shots and the player pass through them", () => {
    const dead = { ...scene(300), enemies: [{ ...scene(300).enemies[0]!, mode: "dead" as const, health: 0 }] };
    const { state, events } = run(dead, [ATTACK, ...Array(89).fill({ ...NEUTRAL_COMMAND, forward: 127 })]);
    expect(events.filter((e) => e.type === "hitEntity")).toHaveLength(0);
    expect(events.some((e) => e.type === "hitWall")).toBe(true); // the wall behind, at x = 600
    expect(state.enemies[0]).toEqual(dead.enemies[0]); // no thinking, nothing changed
    expect(state.player.origin.x).toBeGreaterThan(300); // walked through the corpse
  });

  it("a living enemy blocks the player", () => {
    // Facing away, so it never sees the player and stays put.
    const facingAway = { ...scene(300), enemies: [{ ...scene(300).enemies[0]!, yaw: 0 }] };
    const { state } = run(facingAway, Array(120).fill({ ...NEUTRAL_COMMAND, forward: 127 }));
    // The player's box (16 wide each way) stops against the enemy's (from x = 284), 1/32 short.
    expect(state.player.origin.x).toBeCloseTo(284 - 16 - DIST_EPSILON, 6);
  });

  it("an idle enemy shot from behind turns to hunt the player", () => {
    const facingAway = { ...scene(300), enemies: [{ ...scene(300).enemies[0]!, yaw: 0 }] };
    const { state, events } = run(facingAway, [ATTACK]);
    expect(events).toContainEqual({ type: "sighted", entity: 2, target: 1 });
    expect(state.enemies[0]).toMatchObject({ target: 1 });
    expect(["chase", "pain"]).toContain(state.enemies[0]!.mode);
  });

  const STILL = (n: number): InputCommand[] => Array(n).fill(NEUTRAL_COMMAND);

  it("an enemy that sees the player shoots them once its reaction delay and wind-up are over", () => {
    // It sees the player on tick 1, may attack from tick 37 (its think), and fires 24 ticks later.
    const { state, events } = run(scene(300), STILL(70));
    const fired = events.filter((e) => e.type === "fired");
    expect(fired).toEqual([{ type: "fired", entity: 2, weapon: "shotgunner" }]);
    const hurt = events.filter((e) => e.type === "damaged" && e.entity === 1);
    const total = hurt.reduce((sum, e) => sum + (e.type === "damaged" ? e.amount : 0), 0);
    expect(hurt).toHaveLength(1); // one blast, one hit
    expect(total % 4).toBe(0); // 4 per pellet
    expect(state.player.health).toBe(100 - total);
  });

  it("the player dies at zero health, then can't move or shoot, and enemies stop hunting them", () => {
    const fragile = { ...scene(300), player: { ...scene(300).player, health: 1 } };
    const before = run(fragile, STILL(70));
    expect(before.events).toContainEqual(expect.objectContaining({ type: "died", entity: 1, attacker: 2 }));
    expect(before.state.player.health).toBeLessThanOrEqual(0);

    const after = run(before.state, Array(30).fill({ ...NEUTRAL_COMMAND, forward: 127, buttons: BUTTON_ATTACK }));
    expect(after.state.player.origin).toEqual(before.state.player.origin);
    expect(after.events.filter((e) => e.entity === 1)).toEqual([]);
    expect(after.state.enemies[0]).toMatchObject({ mode: "idle", target: 0 });
  });

  it("an enemy hit by another's stray pellet turns on it, remembering the player", () => {
    // Enemy 2 shoots the player past enemy 3, standing beside its line of fire. With seed 3, one pellet strays into enemy 3.
    const west = degreesToUnits(180);
    const sim = createSim(config, { origin: vec3(0, 0, 24), yaw: 0 }, 3, [
      { type: "shotgunner", origin: vec3(300, 0, STANDING), yaw: west },
      { type: "shotgunner", origin: vec3(200, 20, STANDING), yaw: west },
    ]);
    const { state, events } = run(sim, STILL(62));
    expect(events).toContainEqual(expect.objectContaining({ type: "damaged", entity: 3, attacker: 2 }));
    expect(state.enemies[1]).toMatchObject({ target: 2, oldTarget: 1, mode: "chase" }); // its own attack at the player dropped
    expect(events.filter((e) => e.type === "fired").map((e) => e.entity)).toEqual([2]);
  });
});
