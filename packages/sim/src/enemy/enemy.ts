// Enemies: their state, what the AI needs from the data, and spawning them
// from a level's monster entities. The AI is in ai.ts, and taking damage in
// damage.ts. See docs/ENEMIES.md.

import { CONTENTS, secondsToTicks, SPAWN_RAISE, TICK_RATE } from "../constants.ts";
import { entityBox } from "../collision/box.ts";
import { trace, type CollisionBrush } from "../collision/trace.ts";
import { hullFromData, type EnemiesData, type EnemyData, type Hull } from "../data.ts";
import { ANGLE_UNITS_PER_TURN, degreesToUnits, wrapYaw } from "../input.ts";
import { entityOrigin, type Level } from "../level.ts";
import { add, sub, vec3, type Vec3 } from "../math/vec3.ts";

/** What blocks an enemy's movement: solid and window brushes, monster clip, and other enemies. */
export const ENEMY_MASK = CONTENTS.SOLID | CONTENTS.WINDOW | CONTENTS.MONSTERCLIP | CONTENTS.MONSTER;

/**
 * idle: waiting; looks for the player on each think.
 * chase: has seen the player and hunts them.
 * pain: flinching from damage; does nothing until the stun ends.
 * dead: does nothing, and can't be hit or bumped into.
 */
export type EnemyMode = "idle" | "chase" | "pain" | "dead";

export interface EnemyState {
  readonly id: number;
  /** A key of enemies.json's enemies. */
  readonly type: string;
  readonly origin: Vec3;
  /** Facing, in angle units. */
  readonly yaw: number;
  /** The direction it's heading, which it turns toward (Quake's ideal_yaw). */
  readonly idealYaw: number;
  /** True while it has a direction to step in; a blocked step clears it until the next think. */
  readonly moving: boolean;
  readonly health: number;
  readonly mode: EnemyMode;
  /** The tick of the next AI decision. */
  readonly nextThink: number;
  /** The entity being hunted, or 0 for none. */
  readonly target: number;
  /** The first tick an attack is allowed (the reaction delay after first sighting). */
  readonly attackReadyAt: number;
  /** The tick a pain stun ends; the enemy can't flinch again before it. */
  readonly painUntil: number;
}

/** One enemy type's data, with durations in ticks. */
export interface EnemyType {
  readonly data: EnemyData;
  readonly hull: Hull;
  readonly thinkTicks: number;
  readonly reactionTicks: number;
  readonly painTicks: number;
  /** How far it moves each tick while chasing. */
  readonly runStep: number;
  /** How far it moves in one think interval: the step it tests when choosing a direction. */
  readonly thinkStep: number;
  /** How much it can turn each tick, in angle units. */
  readonly turnStep: number;
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
      painTicks: secondsToTicks(enemy.pain.stun),
      runStep: enemy.run_speed / TICK_RATE,
      thinkStep: (enemy.run_speed * Math.max(1, secondsToTicks(enemy.think_interval))) / TICK_RATE,
      turnStep: Math.round((enemy.turn_speed * ANGLE_UNITS_PER_TURN) / 360 / TICK_RATE),
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
    if (type !== undefined) spawns.push(spawnEnemy(level, ctx, type, entityOrigin(entity), Number(entity.angle ?? 0)));
  }
  return spawns;
}

/** One enemy of a type placed at a point, facing angle degrees, dropped onto the floor as enemySpawns describes. */
export function spawnEnemy(level: Level, ctx: EnemyContext, type: string, placed: Vec3, angle: number): EnemySpawn {
  const { hull } = ctx.types.get(type)!;
  const start = add(placed, vec3(0, 0, SPAWN_RAISE));
  const drop = trace(level.world, start, sub(start, vec3(0, 0, DROP_TO_FLOOR)), hull.mins, hull.maxs, ENEMY_MASK);
  const origin = drop.fraction < 1 && !drop.startSolid ? drop.endpos : placed;
  return { type, origin, yaw: wrapYaw(degreesToUnits(angle)) };
}

/** A new enemy, idle. index is its place among the level's enemies, which offsets its think ticks. */
export function createEnemy(id: number, spawn: EnemySpawn, type: EnemyType, index: number): EnemyState {
  return {
    id,
    type: spawn.type,
    origin: spawn.origin,
    yaw: spawn.yaw,
    idealYaw: spawn.yaw,
    moving: false,
    health: type.data.health,
    mode: "idle",
    nextThink: 1 + (index % type.thinkTicks),
    target: 0,
    attackReadyAt: 0,
    painUntil: 0,
  };
}

/** True for an enemy that can act, be hit, and block movement. */
export const alive = (enemy: EnemyState): boolean => enemy.mode !== "dead";

/** A living enemy's box, for movement traces. */
export const enemyBrush = (enemy: EnemyState, type: EnemyType): CollisionBrush => entityBox(enemy.origin, type.hull, CONTENTS.MONSTER);
