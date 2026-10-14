// Enemy AI: decisions only on think ticks (every think_interval, offset per
// enemy), and movement every tick. See docs/ENEMIES.md. Sight follows Quake's
// FindTarget, range, infront, and visible in ai.qc (id Software, GPLv2 or
// later), with Quake 2's rule that sight passes through windows. Chasing
// follows Quake's movetogoal (see move.ts); attacking follows the grunt's
// SoldierCheckAttack, attack frames, and army_fire in soldier.qc.

import { CONTENTS } from "../constants.ts";
import { aimAngles, eyePosition, rayBoxFraction, SHOT_MASK, type HitTarget } from "../combat/hitscan.ts";
import { trace, type CollisionWorld } from "../collision/trace.ts";
import { angleToRadians, wrapYaw } from "../input.ts";
import { add, addScaled, dot, length, sub, vec3, ZERO, type Vec3 } from "../math/vec3.ts";
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

/** An entity an enemy can hunt: its id, where it is and how it's moving, its eye, and its box. */
export interface Quarry {
  readonly id: number;
  readonly origin: Vec3;
  readonly velocity: Vec3;
  readonly eye: Vec3;
  readonly mins: Vec3;
  readonly maxs: Vec3;
}

/** What an enemy's update needs from the rest of the sim this tick. */
export interface Surroundings {
  /** The level's brushes: what sight, shots, and the floor check use. */
  readonly world: CollisionWorld;
  /** The level's brushes plus the box of every other living entity: what blocks its steps. */
  readonly blockers: CollisionWorld;
  /** The player, or null once dead (enemies only ever notice the player by sight). */
  readonly player: Quarry | null;
  /** A living entity it might hunt, by id, or null if there's none (dead or gone). */
  quarry(id: number): Quarry | null;
  /** Every other living entity's box, for checking a shot is clear. */
  readonly targets: readonly HitTarget[];
}

export type EnemyEvent = { readonly type: "sighted"; readonly entity: number; readonly target: number };

/** A shot an enemy fires this tick: from its eye, at these angles (angle units). */
export interface EnemyShot {
  readonly eye: Vec3;
  readonly yaw: number;
  readonly pitch: number;
}

export interface EnemyUpdate {
  readonly enemy: EnemyState;
  readonly rng: number;
  readonly events: readonly EnemyEvent[];
  /** The shot it fires this tick, if any; the sim traces it and applies the damage. */
  readonly shot?: EnemyShot;
}

/**
 * True if nothing but the quarry is in the way of a shot from the enemy's eye
 * to the quarry's eye, within range: no wall that stops shots, and no other
 * entity's box first (Quake's SoldierCheckAttack: trace_ent must be the target).
 */
export function clearShot(enemy: EnemyState, type: EnemyType, s: Surroundings, quarry: Quarry): boolean {
  const eye = eyePosition(enemy.origin, type.data.eye_height);
  const delta = sub(quarry.eye, eye);
  if (length(delta) > type.data.attack.hitscan.range) return false;
  const wall = trace(s.world, eye, quarry.eye, ZERO, ZERO, SHOT_MASK).fraction;
  let nearest: { id: number; fraction: number } | null = null;
  for (const target of s.targets) {
    const fraction = rayBoxFraction(eye, delta, target.mins, target.maxs);
    if (fraction !== null && (!nearest || fraction < nearest.fraction)) nearest = { id: target.id, fraction };
  }
  return nearest !== null && nearest.id === quarry.id && nearest.fraction < wall;
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

/** Quake's HuntTarget: go after a quarry at once, holding the first attack for the reaction delay. */
const hunt = (enemy: EnemyState, quarry: number, tick: number, type: EnemyType): EnemyState => ({
  ...enemy,
  mode: "chase",
  target: quarry,
  attackReadyAt: tick + type.reactionTicks,
});

/** One AI decision. */
function think(enemy: EnemyState, tick: number, type: EnemyType, s: Surroundings, rng: number): EnemyUpdate {
  if (enemy.mode === "pain") {
    // Stunned until the stun ends; then back to hunting its target, or to waiting if it has none.
    return { enemy: tick < enemy.painUntil ? enemy : { ...enemy, mode: enemy.target !== 0 ? "chase" : "idle" }, rng, events: [] };
  }

  if (enemy.mode === "idle") {
    if (!s.player || !canSee(enemy, type, s.world, s.player.eye)) return { enemy, rng, events: [] };
    const chased = chooseHeading(hunt(enemy, s.player.id, tick, type), type, s, s.player, rng);
    return { ...chased, events: [{ type: "sighted", entity: enemy.id, target: s.player.id }] };
  }

  // Its target is gone: go back to the one it remembered (Quake's oldenemy), or stand.
  let hunter = enemy;
  let quarry = s.quarry(enemy.target);
  if (!quarry) {
    quarry = s.quarry(enemy.oldTarget);
    if (!quarry) return { enemy: { ...enemy, mode: "idle", target: 0, oldTarget: 0, moving: false }, rng, events: [] };
    hunter = { ...hunt(enemy, quarry.id, tick, type), oldTarget: 0 };
  }

  if (hunter.mode === "attack") {
    if (tick < hunter.fireAt) return { enemy: hunter, rng, events: [] };
    // Fire where the quarry was aim_lag seconds ago (Quake's army_fire), then cool down.
    const eye = eyePosition(hunter.origin, type.data.eye_height);
    const aimed = addScaled(quarry.origin, quarry.velocity, 0 - type.data.attack.aim_lag);
    const { yaw, pitch } = aimAngles(eye, aimed);
    const done: EnemyState = { ...hunter, mode: "chase", attackReadyAt: tick + type.cooldownTicks };
    return { enemy: done, rng, events: [], shot: { eye, yaw, pitch } };
  }

  // Chasing: attack if it can, else keep after the quarry.
  if (tick >= hunter.attackReadyAt && clearShot(hunter, type, s, quarry)) {
    return { enemy: { ...hunter, mode: "attack", fireAt: tick + type.windupTicks, moving: false }, rng, events: [] };
  }
  return { ...chooseHeading(hunter, type, s, quarry, rng), events: [] };
}

/**
 * One tick of movement. Chasing: turn toward the heading, then step that way
 * if facing close enough to it (Quake's SV_StepDirection). Attacking: stand
 * and turn to face the quarry (Quake's ai_face).
 */
function walk(enemy: EnemyState, type: EnemyType, s: Surroundings): EnemyState {
  if (enemy.mode === "attack") {
    const quarry = s.quarry(enemy.target);
    if (!quarry) return enemy;
    const facing = aimAngles(enemy.origin, quarry.origin).yaw;
    return { ...enemy, idealYaw: facing, yaw: changeYaw(enemy.yaw, facing, type.turnStep) };
  }
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
