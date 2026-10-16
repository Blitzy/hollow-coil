// Instant-hit attacks: each pellet is a ray from the shooter's eye along the
// aim, spread at random (from the sim's seeded RNG), that stops at the first
// world brush or entity box it reaches. See docs/WEAPONS.md, "Hitscan". The
// spread follows Quake's FireBullets (crandom on each axis, scaled along the
// right and up vectors); id Software, GPLv2 or later.

import { atan2, cos, hypot, sin, tan } from "../math/trig.ts";
import { CONTENTS } from "../constants.ts";
import { trace, type CollisionWorld } from "../collision/trace.ts";
import type { HitscanData } from "../data.ts";
import { angleToRadians, wrapYaw } from "../input.ts";
import { addScaled, cross, normalize, sub, vec3, ZERO, type Vec3 } from "../math/vec3.ts";
import { nextRandom } from "../rng.ts";

/** What stops shots: solid and window brushes. Clip brushes (player or monster) don't. */
export const SHOT_MASK = CONTENTS.SOLID | CONTENTS.WINDOW;

/** An entity's box in world space, for shots to hit. */
export interface HitTarget {
  readonly id: number;
  readonly mins: Vec3;
  readonly maxs: Vec3;
}

export type PelletHit =
  | { readonly kind: "world"; readonly point: Vec3; readonly normal: Vec3 }
  | { readonly kind: "entity"; readonly entity: number; readonly point: Vec3 };

export interface Aim {
  readonly forward: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
}

/** The view's forward, right, and up vectors from yaw and pitch in angle units (Quake's AngleVectors, without roll). */
export function aimVectors(yaw: number, pitch: number): Aim {
  const y = angleToRadians(yaw);
  const p = angleToRadians(pitch);
  const forward = vec3(cos(p) * cos(y), cos(p) * sin(y), sin(p));
  const right = vec3(sin(y), 0 - cos(y), 0);
  return { forward, right, up: cross(right, forward) };
}

/**
 * Where a ray from start along delta (start + delta * f, f from 0 to 1) first
 * enters the box, or null if it misses. A ray starting inside hits at f = 0.
 */
export function rayBoxFraction(start: Vec3, delta: Vec3, mins: Vec3, maxs: Vec3): number | null {
  let enter = 0;
  let leave = 1;
  const axes: [number, number, number, number][] = [
    [start.x, delta.x, mins.x, maxs.x],
    [start.y, delta.y, mins.y, maxs.y],
    [start.z, delta.z, mins.z, maxs.z],
  ];
  for (const [s, d, lo, hi] of axes) {
    if (d === 0) {
      if (s < lo || s > hi) return null;
      continue;
    }
    const t0 = (lo - s) / d;
    const t1 = (hi - s) / d;
    enter = Math.max(enter, Math.min(t0, t1));
    leave = Math.min(leave, Math.max(t0, t1));
    if (enter > leave) return null;
  }
  return enter;
}

/** One pellet: the world trace, then any target box nearer than where it stopped. */
function firePellet(world: CollisionWorld, targets: readonly HitTarget[], eye: Vec3, dir: Vec3, range: number): PelletHit | null {
  const end = addScaled(eye, dir, range);
  const wall = trace(world, eye, end, ZERO, ZERO, SHOT_MASK);
  const delta = sub(end, eye);
  let nearest: { entity: number; fraction: number } | null = null;
  for (const target of targets) {
    const fraction = rayBoxFraction(eye, delta, target.mins, target.maxs);
    if (fraction !== null && fraction < wall.fraction && (!nearest || fraction < nearest.fraction)) nearest = { entity: target.id, fraction };
  }
  if (nearest) return { kind: "entity", entity: nearest.entity, point: addScaled(eye, delta, nearest.fraction) };
  if (wall.fraction < 1) return { kind: "world", point: wall.endpos, normal: wall.normal };
  return null;
}

export interface HitscanResult {
  /** What each pellet hit, in pellet order; null if it reached its range without hitting anything. */
  readonly pellets: readonly (PelletHit | null)[];
  /** The RNG state after drawing every pellet's spread. */
  readonly rng: number;
}

/**
 * Fires a hitscan attack from eye, aimed by yaw and pitch (angle units). Each
 * pellet draws two RNG values, horizontal then vertical, even with no spread.
 * Pass the targets that can be hit, without the shooter.
 */
export function fireHitscan(
  world: CollisionWorld,
  targets: readonly HitTarget[],
  eye: Vec3,
  yaw: number,
  pitch: number,
  attack: HitscanData,
  rng: number,
): HitscanResult {
  const { forward, right, up } = aimVectors(yaw, pitch);
  const spreadRight = tan((attack.spread.horizontal * Math.PI) / 180);
  const spreadUp = tan((attack.spread.vertical * Math.PI) / 180);
  const pellets: (PelletHit | null)[] = [];
  let state = rng;
  const crandom = (): number => {
    const r = nextRandom(state);
    state = r.state;
    return 2 * r.value - 1;
  };
  for (let i = 0; i < attack.pellets; i++) {
    const u = crandom();
    const v = crandom();
    const dir = normalize(addScaled(addScaled(forward, right, spreadRight * u), up, spreadUp * v));
    pellets.push(firePellet(world, targets, eye, dir, attack.range));
  }
  return { pellets, rng: state };
}

/** The yaw and pitch (angle units, not rounded) that aim from one point at another; level if they're the same point. */
export function aimAngles(from: Vec3, to: Vec3): { yaw: number; pitch: number } {
  const d = sub(to, from);
  const toUnits = (radians: number): number => (radians * 65536) / (2 * Math.PI);
  return { yaw: wrapYaw(toUnits(atan2(d.y, d.x))), pitch: toUnits(atan2(d.z, hypot(d.x, d.y))) };
}

/** The eye of a body standing at origin. */
export const eyePosition = (origin: Vec3, eyeHeight: number): Vec3 => vec3(origin.x, origin.y, origin.z + eyeHeight);
