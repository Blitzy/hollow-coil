// Enemy AI: decisions only on think ticks (every think_interval, offset per
// enemy), and noticing the player by sight. See docs/ENEMIES.md. Sight follows
// Quake's FindTarget, range, infront, and visible in ai.qc (id Software, GPLv2
// or later), with Quake 2's rule that sight passes through windows.

import { CONTENTS } from "../constants.ts";
import { eyePosition } from "../combat/hitscan.ts";
import { trace, type CollisionWorld } from "../collision/trace.ts";
import { angleToRadians } from "../input.ts";
import { dot, length, sub, vec3, ZERO, type Vec3 } from "../math/vec3.ts";
import { alive, type EnemyState, type EnemyType } from "./enemy.ts";

/** What blocks sight: solid brushes. Windows don't. */
export const SIGHT_MASK = CONTENTS.SOLID;

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

/** What an enemy's think needs to know about the player. */
export interface ThinkPlayer {
  readonly id: number;
  /** The player's eye: where enemies look for them. */
  readonly eye: Vec3;
}

export type EnemyEvent = { readonly type: "sighted"; readonly entity: number; readonly target: number };

export interface EnemyUpdate {
  readonly enemy: EnemyState;
  readonly events: readonly EnemyEvent[];
}

/** One AI decision. */
function think(enemy: EnemyState, tick: number, type: EnemyType, world: CollisionWorld, player: ThinkPlayer): EnemyUpdate {
  if (enemy.mode === "pain") {
    // Stunned until the stun ends; then back to hunting its target, or to waiting if it has none.
    return { enemy: tick < enemy.painUntil ? enemy : { ...enemy, mode: enemy.target !== 0 ? "chase" : "idle" }, events: [] };
  }
  if (enemy.mode === "idle" && canSee(enemy, type, world, player.eye)) {
    // Quake's HuntTarget: chase at once, but hold the first attack for the reaction delay.
    return {
      enemy: { ...enemy, mode: "chase", target: player.id, attackReadyAt: tick + type.reactionTicks },
      events: [{ type: "sighted", entity: enemy.id, target: player.id }],
    };
  }
  return { enemy, events: [] };
}

/** Advances an enemy to the given tick (the one being simulated). It decides only on its think ticks; the dead don't. */
export function updateEnemy(enemy: EnemyState, tick: number, type: EnemyType, world: CollisionWorld, player: ThinkPlayer): EnemyUpdate {
  if (!alive(enemy) || tick < enemy.nextThink) return { enemy, events: [] };
  const { enemy: thought, events } = think(enemy, tick, type, world, player);
  return { enemy: { ...thought, nextThink: enemy.nextThink + type.thinkTicks }, events };
}
