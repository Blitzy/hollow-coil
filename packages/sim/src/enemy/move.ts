// How enemies get around, adapted from Quake's sv_move.c (id Software, GPLv2
// or later): SV_movestep, SV_CheckBottom, SV_StepDirection, SV_NewChaseDir,
// SV_CloseEnough, and SV_MoveToGoal, plus PF_changeyaw for turning. Angles
// are in angle units (65536 per turn; 45 degrees is 8192). See docs/ENEMIES.md,
// "Chasing".

import { trace, type CollisionWorld } from "../collision/trace.ts";
import type { Hull } from "../data.ts";
import { angleToRadians, ANGLE_UNITS_PER_TURN, wrapYaw } from "../input.ts";
import { add, vec3, ZERO, type Vec3 } from "../math/vec3.ts";

/** The highest step an enemy climbs, and the deepest it steps down (Quake's STEPSIZE). */
export const STEP_SIZE = 18;
/** Eighth turns: the directions enemies choose between. */
const EIGHTH = ANGLE_UNITS_PER_TURN / 8;
const HALF_TURN = ANGLE_UNITS_PER_TURN / 2;

/** b - a, the short way round: in (-32768, 32768]. */
export function yawDelta(a: number, b: number): number {
  const d = wrapYaw(b - a);
  return d > HALF_TURN ? d - ANGLE_UNITS_PER_TURN : d;
}

/** Turns yaw toward ideal by at most speed (Quake's PF_changeyaw). */
export function changeYaw(yaw: number, ideal: number, speed: number): number {
  const delta = yawDelta(yaw, ideal);
  return wrapYaw(yaw + Math.max(-speed, Math.min(speed, delta)));
}

/**
 * True if an enemy at origin stands on ground under its whole box: the point
 * below its center finds a floor within two steps, and so does each corner,
 * none more than a step below the center's (Quake's SV_CheckBottom). Checked
 * against the world only.
 */
export function checkBottom(world: CollisionWorld, origin: Vec3, hull: Hull, mask: number): boolean {
  const mins = add(origin, hull.mins);
  const maxs = add(origin, hull.maxs);
  const down = (x: number, y: number) => trace(world, vec3(x, y, mins.z), vec3(x, y, mins.z - 2 * STEP_SIZE), ZERO, ZERO, mask);
  const center = down((mins.x + maxs.x) / 2, (mins.y + maxs.y) / 2);
  if (center.fraction === 1) return false;
  const mid = center.endpos.z;
  for (const x of [mins.x, maxs.x]) {
    for (const y of [mins.y, maxs.y]) {
      const corner = down(x, y);
      if (corner.fraction === 1 || mid - corner.endpos.z > STEP_SIZE) return false;
    }
  }
  return true;
}

/**
 * Where an enemy at origin ends up stepping by move (horizontal), or null if
 * it can't (Quake's SV_movestep). The box is dropped onto the destination from
 * a step above, so it climbs steps and walks down them, but it won't step
 * where its box doesn't fit, where there's no floor within a step below, or
 * where its box would hang over a drop. Only the destination is tested, so a
 * single step must be shorter than the thinnest wall.
 */
export function moveStep(blockers: CollisionWorld, world: CollisionWorld, origin: Vec3, move: Vec3, hull: Hull, mask: number): Vec3 | null {
  const dest = add(origin, move);
  const above = vec3(dest.x, dest.y, dest.z + STEP_SIZE);
  const below = vec3(dest.x, dest.y, dest.z - STEP_SIZE);
  let drop = trace(blockers, above, below, hull.mins, hull.maxs, mask);
  if (drop.allSolid) return null;
  if (drop.startSolid) {
    // No room a step up (a low ceiling): try from the same height.
    drop = trace(blockers, dest, below, hull.mins, hull.maxs, mask);
    if (drop.allSolid || drop.startSolid) return null;
  }
  if (drop.fraction === 1) return null; // walked off an edge
  return checkBottom(world, drop.endpos, hull, mask) ? drop.endpos : null;
}

/** A horizontal move of dist in the direction of yaw. */
export function moveToward(yaw: number, dist: number): Vec3 {
  const radians = angleToRadians(yaw);
  return vec3(Math.cos(radians) * dist, Math.sin(radians) * dist, 0);
}

/** True if two boxes, each grown by 1 unit as Quake's absmin and absmax are, come within dist of each other on every axis (SV_CloseEnough). */
export function closeEnough(aMins: Vec3, aMaxs: Vec3, bMins: Vec3, bMaxs: Vec3, dist: number): boolean {
  const reach = dist + 2;
  return (
    bMins.x <= aMaxs.x + reach && bMaxs.x >= aMins.x - reach &&
    bMins.y <= aMaxs.y + reach && bMaxs.y >= aMins.y - reach &&
    bMins.z <= aMaxs.z + reach && bMaxs.z >= aMins.z - reach
  );
}

/** Choosing a direction to chase in: whether a step that way works, and random values from the sim's RNG. */
export interface ChaseChooser {
  canStep(yaw: number): boolean;
  random(): number;
}

const NO_DIR = -1;

/**
 * Picks a direction toward the goal, in eighth turns, or null if every
 * direction is blocked (Quake's SV_NewChaseDir). Tries the diagonal toward
 * the goal, then each axis toward it, then the direction it was heading, then
 * every direction (the search order chosen at random), and only last turning
 * all the way around. Quake's "215" for the south-west diagonal is a known
 * typo for 225; we use 225.
 */
export function newChaseDir(idealYaw: number, delta: { readonly x: number; readonly y: number }, chooser: ChaseChooser): number | null {
  const olddir = wrapYaw(Math.floor(idealYaw / EIGHTH) * EIGHTH);
  const turnaround = wrapYaw(olddir - HALF_TURN);
  const tries = (dir: number): boolean => dir !== NO_DIR && dir !== turnaround && chooser.canStep(dir);

  let dx = delta.x > 10 ? 0 : delta.x < -10 ? 4 * EIGHTH : NO_DIR;
  let dy = delta.y < -10 ? 6 * EIGHTH : delta.y > 10 ? 2 * EIGHTH : NO_DIR;
  // The direct route: the diagonal toward the goal.
  if (dx !== NO_DIR && dy !== NO_DIR) {
    const diagonal = dx === 0 ? (dy === 2 * EIGHTH ? EIGHTH : 7 * EIGHTH) : dy === 2 * EIGHTH ? 3 * EIGHTH : 5 * EIGHTH;
    if (tries(diagonal)) return diagonal;
  }
  // Then each axis toward it, the longer one first (or either, at random).
  if (chooser.random() < 0.5 || Math.abs(delta.y) > Math.abs(delta.x)) [dx, dy] = [dy, dx];
  if (tries(dx)) return dx;
  if (tries(dy)) return dy;
  // No direct path: keep going the way it was, then search every direction.
  if (chooser.canStep(olddir)) return olddir;
  const order = Array.from({ length: 8 }, (_, i) => i * EIGHTH);
  if (chooser.random() >= 0.5) order.reverse();
  for (const dir of order) if (dir !== turnaround && chooser.canStep(dir)) return dir;
  if (chooser.canStep(turnaround)) return turnaround;
  return null;
}
