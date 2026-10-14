// Enemies: their state, what the AI needs from the data, and spawning them
// from a level's monster entities. The AI itself is in ai.ts. See docs/ENEMIES.md.

import { CONTENTS, secondsToTicks, SPAWN_RAISE } from "../constants.ts";
import { trace } from "../collision/trace.ts";
import { hullFromData, type EnemiesData, type EnemyData, type Hull } from "../data.ts";
import { degreesToUnits, wrapYaw } from "../input.ts";
import { entityOrigin, type Level } from "../level.ts";
import { add, sub, vec3, type Vec3 } from "../math/vec3.ts";

/** What blocks an enemy's movement: solid and window brushes, and monster clip. */
export const ENEMY_MASK = CONTENTS.SOLID | CONTENTS.WINDOW | CONTENTS.MONSTERCLIP;

/**
 * idle: waiting; looks for the player on each think.
 * chase: has seen the player and hunts them.
 */
export type EnemyMode = "idle" | "chase";

export interface EnemyState {
  readonly id: number;
  /** A key of enemies.json's enemies. */
  readonly type: string;
  readonly origin: Vec3;
  /** Facing, in angle units. */
  readonly yaw: number;
  readonly health: number;
  readonly mode: EnemyMode;
  /** The tick of the next AI decision. */
  readonly nextThink: number;
  /** The entity being hunted, or 0 for none. */
  readonly target: number;
  /** The first tick an attack is allowed (the reaction delay after first sighting). */
  readonly attackReadyAt: number;
}

/** One enemy type's data, with durations in ticks. */
export interface EnemyType {
  readonly data: EnemyData;
  readonly hull: Hull;
  readonly thinkTicks: number;
  readonly reactionTicks: number;
  /** Cosine of half the field of view: the player is in view when cos(angle off facing) is at least this. */
  readonly viewCos: number;
}

export interface EnemyContext {
  readonly types: ReadonlyMap<string, EnemyType>;
  /** Enemy type by map classname. */
  readonly byClassname: ReadonlyMap<string, string>;
}

export function enemyContext(data: EnemiesData): EnemyContext {
  const types = new Map<string, EnemyType>();
  const byClassname = new Map<string, string>();
  for (const [id, enemy] of Object.entries(data.enemies)) {
    types.set(id, {
      data: enemy,
      hull: hullFromData(enemy.hull),
      thinkTicks: Math.max(1, secondsToTicks(enemy.think_interval)),
      reactionTicks: secondsToTicks(enemy.reaction_delay),
      viewCos: Math.cos((enemy.field_of_view * Math.PI) / 360),
    });
    byClassname.set(enemy.classname, id);
  }
  return { types, byClassname };
}

export interface EnemySpawn {
  readonly type: string;
  readonly origin: Vec3;
  /** Facing, in angle units. */
  readonly yaw: number;
}

/** How far below its map origin a spawning enemy looks for the floor (Quake's droptofloor). */
export const DROP_TO_FLOOR = 256;

/**
 * Every monster entity in the level whose classname an enemy type spawns from,
 * in entity order, dropped onto the floor below it (Quake's droptofloor). Like
 * the player's spawn, the drop starts 1 unit above the placed origin, since an
 * enemy placed standing on the floor is touching it, and a trace that starts
 * touching a brush starts inside it. One with no floor within reach, or stuck
 * in a brush, stays where it was placed.
 */
export function enemySpawns(level: Level, ctx: EnemyContext): EnemySpawn[] {
  const spawns: EnemySpawn[] = [];
  for (const entity of level.entities) {
    const type = ctx.byClassname.get(entity.classname ?? "");
    if (type === undefined) continue;
    const { hull } = ctx.types.get(type)!;
    const placed = entityOrigin(entity);
    const start = add(placed, vec3(0, 0, SPAWN_RAISE));
    const drop = trace(level.world, start, sub(start, vec3(0, 0, DROP_TO_FLOOR)), hull.mins, hull.maxs, ENEMY_MASK);
    const origin = drop.fraction < 1 && !drop.startSolid ? drop.endpos : placed;
    spawns.push({ type, origin, yaw: wrapYaw(degreesToUnits(Number(entity.angle ?? 0))) });
  }
  return spawns;
}

/** A new enemy, idle. index is its place among the level's enemies, which offsets its think ticks. */
export function createEnemy(id: number, spawn: EnemySpawn, type: EnemyType, index: number): EnemyState {
  return {
    id,
    type: spawn.type,
    origin: spawn.origin,
    yaw: spawn.yaw,
    health: type.data.health,
    mode: "idle",
    nextThink: 1 + (index % type.thinkTicks),
    target: 0,
    attackReadyAt: 0,
  };
}
