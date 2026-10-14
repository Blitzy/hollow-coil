// Enemy AI: decisions only on think ticks (every think_interval, offset per
// enemy), and movement every tick. See docs/ENEMIES.md. Sight follows Quake's
// FindTarget, range, infront, and visible in ai.qc (id Software, GPLv2 or
// later), with Quake 2's rule that sight passes through windows. Chasing
// follows Quake's movetogoal (see move.ts).

import { CONTENTS } from "../constants.ts";
import { eyePosition } from "../combat/hitscan.ts";
import { trace, type CollisionWorld } from "../collision/trace.ts";
import { angleToRadians, wrapYaw } from "../input.ts";
import { add, dot, length, sub, vec3, ZERO, type Vec3 } from "../math/vec3.ts";
import { nextRandom } from "../rng.ts";
import { alive, ENEMY_MASK, type EnemyState, type EnemyType } from "./enemy.ts";
import { changeYaw, closeEnough, moveStep, moveToward, newChaseDir, yawDelta } from "./move.ts";

/** What blocks sight: solid brushes. Windows don't. */
export const SIGHT_MASK = CONTENTS.SOLID;
/** An enemy turned further than this from where it's heading turns before it steps (Quake's 45 degrees). */
const STEP_TURN_LIMIT = 8192;

/** True if nothing that blocks sight lies between two points. */
export const lineOfSight = (world: CollisionWorld, from: Vec3, to: Vec3): boolean => trace(world, from, to, ZERO, ZERO, SIGHT_MASK).fraction === 1;

/** True if the enemy can see a point: within sight range, inside its view cone, and in line of sight from its eye. */
export function canSee(enemy: EnemyState, type: EnemyType, world: CollisionWorld, point: Vec3): boolean {
  const eye = eyePosition(enemy.origin, type.data.eye_height);
  const toPoint = sub(point, eye);
  const distance = length(toPoint);
  if (distance > type.data.sight_range) return false;
  const yaw = angleToRadians(enemy.yaw);
  const facing = vec3(Math.cos(yaw), Math.sin(yaw), 0);
  if (distance > 0 && dot(facing, toPoint) / distance < type.viewCos) return false;
  return lineOfSight(world, eye, point);
}

/** An entity an enemy can hunt: its id, where it is, its eye, and its box. */
export interface Quarry {
  readonly id: number;
  readonly origin: Vec3;
  readonly eye: Vec3;
  readonly mins: Vec3;
  readonly maxs: Vec3;
}

/** What an enemy's update needs from the rest of the sim this tick. */
export interface Surroundings {
  /** The level's brushes: what sight and the floor check use. */
  readonly world: CollisionWorld;
  /** The level's brushes plus the box of every other living entity: what blocks its steps. */
  readonly blockers: CollisionWorld;
  readonly player: Quarry;
}

export type EnemyEvent = { readonly type: "sighted"; readonly entity: number; readonly target: number };

export interface EnemyUpdate {
  readonly enemy: EnemyState;
  readonly rng: number;
  readonly events: readonly EnemyEvent[];
}

/**
 * Chooses which way to go after the quarry, on a think (Quake's movetogoal):
 * stop if one more think's worth of movement would reach it; otherwise keep
 * heading the same way if that still works (but one think in four, rethink
 * anyway), else find a new direction. Draws from the RNG as Quake does.
 */
function chooseHeading(enemy: EnemyState, type: EnemyType, s: Surroundings, quarry: Quarry, rng: number): { enemy: EnemyState; rng: number } {
  const mins = add(enemy.origin, type.hull.mins);
  const maxs = add(enemy.origin, type.hull.maxs);
  if (closeEnough(mins, maxs, quarry.mins, quarry.maxs, type.thinkStep)) return { enemy: { ...enemy, moving: false }, rng };

  let state = rng;
  const random = (): number => {
    const r = nextRandom(state);
    state = r.state;
    return r.value;
  };
  const canStep = (yaw: number): boolean => moveStep(s.blockers, s.world, enemy.origin, moveToward(yaw, type.thinkStep), type.hull, ENEMY_MASK) !== null;
  if (Math.floor(random() * 4) !== 1 && canStep(enemy.idealYaw)) return { enemy: { ...enemy, moving: true }, rng: state };

  const delta = sub(quarry.origin, enemy.origin);
  const dir = newChaseDir(enemy.idealYaw, delta, { canStep, random });
  // Blocked every way: keep the eighth turn it was heading in, and wait.
  const heading = dir ?? wrapYaw(Math.floor(enemy.idealYaw / 8192) * 8192);
  return { enemy: { ...enemy, idealYaw: heading, moving: dir !== null }, rng: state };
}

/** One AI decision. */
function think(enemy: EnemyState, tick: number, type: EnemyType, s: Surroundings, rng: number): EnemyUpdate {
  if (enemy.mode === "pain") {
    // Stunned until the stun ends; then back to hunting its target, or to waiting if it has none.
    return { enemy: tick < enemy.painUntil ? enemy : { ...enemy, mode: enemy.target !== 0 ? "chase" : "idle" }, rng, events: [] };
  }
  if (enemy.mode === "idle") {
    if (!canSee(enemy, type, s.world, s.player.eye)) return { enemy, rng, events: [] };
    // Quake's HuntTarget: chase at once, but hold the first attack for the reaction delay.
    const hunting: EnemyState = { ...enemy, mode: "chase", target: s.player.id, attackReadyAt: tick + type.reactionTicks };
    const chased = chooseHeading(hunting, type, s, s.player, rng);
    return { ...chased, events: [{ type: "sighted", entity: enemy.id, target: s.player.id }] };
  }
  // Chasing: the only quarry so far is the player.
  return { ...chooseHeading(enemy, type, s, s.player, rng), events: [] };
}

/** One tick of movement: turn toward the heading, then step that way if facing close enough to it (Quake's SV_StepDirection). */
function walk(enemy: EnemyState, type: EnemyType, s: Surroundings): EnemyState {
  if (enemy.mode !== "chase" || !enemy.moving) return enemy;
  const yaw = changeYaw(enemy.yaw, enemy.idealYaw, type.turnStep);
  if (Math.abs(yawDelta(yaw, enemy.idealYaw)) > STEP_TURN_LIMIT) return { ...enemy, yaw };
  const stepped = moveStep(s.blockers, s.world, enemy.origin, moveToward(enemy.idealYaw, type.runStep), type.hull, ENEMY_MASK);
  return stepped ? { ...enemy, yaw, origin: stepped } : { ...enemy, yaw, moving: false };
}

/**
 * Advances an enemy to the given tick (the one being simulated): a decision
 * if it's one of its think ticks, then movement. The dead do nothing.
 */
export function updateEnemy(enemy: EnemyState, tick: number, type: EnemyType, s: Surroundings, rng: number): EnemyUpdate {
  if (!alive(enemy)) return { enemy, rng, events: [] };
  let update: EnemyUpdate = { enemy, rng, events: [] };
  if (tick >= enemy.nextThink) {
    update = think(enemy, tick, type, s, rng);
    update = { ...update, enemy: { ...update.enemy, nextThink: enemy.nextThink + type.thinkTicks } };
  }
  return { ...update, enemy: walk(update.enemy, type, s) };
}
