// Sweeping a box through the world's brushes. See docs/MOVEMENT.md, "Box trace".
// Adapted from Quake 2 qcommon/cmodel.c CM_ClipBoxToBrush, CM_TestBoxInBrush,
// and CM_BoxTrace (id Software, GPLv2 or later).

import { addScaled, dot, equals, sub, vec3, ZERO, type Vec3 } from "../math/vec3";
import type { Plane } from "./plane";

/** Anything with planes, contents, and bounds can be collided with: .map brushes now, .bsp brushes later. */
export interface CollisionBrush {
  readonly planes: readonly Plane[];
  readonly contents: number;
  readonly mins: Vec3;
  readonly maxs: Vec3;
}

export interface CollisionWorld {
  readonly brushes: readonly CollisionBrush[];
}

export interface TraceResult {
  /** How far along the move the box got, 0 to 1. */
  readonly fraction: number;
  readonly endpos: Vec3;
  /** Normal of the plane that stopped the box, or ZERO if nothing was hit. */
  readonly normal: Vec3;
  readonly startSolid: boolean;
  readonly allSolid: boolean;
}

/** Keeps traces from ending exactly on a surface, so the next move doesn't start touching it. */
export const DIST_EPSILON = 1 / 32;

interface TraceWork {
  fraction: number;
  normal: Vec3;
  startSolid: boolean;
  allSolid: boolean;
}

/** The box corner that leads into a plane: its distance offset when the plane is pushed out by the box. */
function boxOffset(normal: Vec3, mins: Vec3, maxs: Vec3): number {
  return (
    (normal.x < 0 ? maxs.x : mins.x) * normal.x +
    (normal.y < 0 ? maxs.y : mins.y) * normal.y +
    (normal.z < 0 ? maxs.z : mins.z) * normal.z
  );
}

function clipBoxToBrush(brush: CollisionBrush, start: Vec3, end: Vec3, mins: Vec3, maxs: Vec3, work: TraceWork): void {
  let enter = -1;
  let leave = 1;
  let hit: Plane | null = null;
  let startOut = false;
  let endOut = false;

  for (const plane of brush.planes) {
    const dist = plane.dist - boxOffset(plane.normal, mins, maxs);
    const d1 = dot(start, plane.normal) - dist;
    const d2 = dot(end, plane.normal) - dist;
    if (d2 > 0) endOut = true;
    if (d1 > 0) startOut = true;
    if (d1 > 0 && d2 >= d1) return; // outside this face and not moving toward it
    if (d1 <= 0 && d2 <= 0) continue; // behind this face the whole way
    if (d1 > d2) {
      const f = (d1 - DIST_EPSILON) / (d1 - d2);
      if (f > enter) {
        enter = f;
        hit = plane;
      }
    } else {
      const f = (d1 + DIST_EPSILON) / (d1 - d2);
      if (f < leave) leave = f;
    }
  }

  if (!startOut) {
    work.startSolid = true;
    if (!endOut) work.allSolid = true;
    return;
  }
  if (enter < leave && enter > -1 && enter < work.fraction && hit) {
    work.fraction = Math.max(enter, 0);
    work.normal = hit.normal;
  }
}

function boxInBrush(brush: CollisionBrush, point: Vec3, mins: Vec3, maxs: Vec3): boolean {
  for (const plane of brush.planes) {
    if (dot(point, plane.normal) - (plane.dist - boxOffset(plane.normal, mins, maxs)) > 0) return false;
  }
  return true;
}

/** True if the swept box's bounds (plus a unit of margin) can touch the brush's bounds. */
function mayTouch(brush: CollisionBrush, lo: Vec3, hi: Vec3): boolean {
  return (
    lo.x <= brush.maxs.x + 1 && hi.x >= brush.mins.x - 1 &&
    lo.y <= brush.maxs.y + 1 && hi.y >= brush.mins.y - 1 &&
    lo.z <= brush.maxs.z + 1 && hi.z >= brush.mins.z - 1
  );
}

/**
 * Sweeps a box (mins/maxs relative to its origin) from start to end, against
 * every brush whose contents match the mask. If start equals end, tests
 * whether the box is inside a brush.
 */
export function trace(world: CollisionWorld, start: Vec3, end: Vec3, mins: Vec3, maxs: Vec3, mask: number): TraceResult {
  const work: TraceWork = { fraction: 1, normal: ZERO, startSolid: false, allSolid: false };
  const lo = vec3(Math.min(start.x, end.x) + mins.x, Math.min(start.y, end.y) + mins.y, Math.min(start.z, end.z) + mins.z);
  const hi = vec3(Math.max(start.x, end.x) + maxs.x, Math.max(start.y, end.y) + maxs.y, Math.max(start.z, end.z) + maxs.z);

  if (equals(start, end)) {
    for (const brush of world.brushes) {
      if ((brush.contents & mask) === 0 || !mayTouch(brush, lo, hi)) continue;
      if (boxInBrush(brush, start, mins, maxs)) return { fraction: 0, endpos: start, normal: ZERO, startSolid: true, allSolid: true };
    }
    return { fraction: 1, endpos: start, normal: ZERO, startSolid: false, allSolid: false };
  }

  for (const brush of world.brushes) {
    if ((brush.contents & mask) === 0 || !mayTouch(brush, lo, hi)) continue;
    clipBoxToBrush(brush, start, end, mins, maxs, work);
  }
  const endpos = work.fraction === 1 ? end : addScaled(start, sub(end, start), work.fraction);
  return { fraction: work.fraction, endpos, normal: work.normal, startSolid: work.startSolid, allSolid: work.allSolid };
}
