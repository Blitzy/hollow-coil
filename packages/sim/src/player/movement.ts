// Quake-style player movement. Follows docs/MOVEMENT.md, "Player movement".
// Adapted from QuakeWorld QW/client/pmove.c (id Software, GPLv2 or later), with
// edge friction from Quake WinQuake/sv_user.c SV_UserFriction and the slide
// move's same-plane nudge from Quake 3 code/game/bg_slidemove.c (both GPLv2 or later).

import { CONTENTS, TICK_RATE } from "../constants.ts";
import { add, addScaled, cross, dot, length, scale, sub, vec3, ZERO, type Vec3 } from "../math/vec3.ts";
import { trace, type CollisionWorld, type TraceResult } from "../collision/trace.ts";
import type { Hull, PlayerData } from "../data.ts";
import { angleToRadians, BUTTON_JUMP, type InputCommand } from "../input.ts";

export const PLAYER_MASK = CONTENTS.SOLID | CONTENTS.WINDOW | CONTENTS.PLAYERCLIP;

// Fixed parts of the algorithm (docs/MOVEMENT.md, "Constants"). Tunable values come from data.
export const STOP_EPSILON = 0.1;
export const GROUND_NORMAL_Z = 0.7;
const BUMP_COUNT = 4;
const MAX_CLIP_PLANES = 5;
const SAME_PLANE_DOT = 0.99;
const AIRBORNE_SPEED = 180;
const GROUND_PROBE = 1;
const EDGE_PROBE_AHEAD = 16;
const EDGE_PROBE_DOWN = 34;

export interface PlayerBody {
  readonly origin: Vec3;
  readonly velocity: Vec3;
  readonly onGround: boolean;
  /** Jump was held last tick; a new jump needs a release first. */
  readonly jumpHeld: boolean;
}

export interface MovementContext {
  readonly world: CollisionWorld;
  readonly hull: Hull;
  readonly movement: PlayerData["movement"];
}

/** The working copy one tick of movement updates in place. */
interface Mover {
  origin: Vec3;
  velocity: Vec3;
  onGround: boolean;
  jumpHeld: boolean;
  /** Normal of a surface too steep to stand on that the player is resting against, found by categorizePosition. */
  steepNormal?: Vec3 | null;
}

const dt = 1 / TICK_RATE;

function traceHull(ctx: MovementContext, start: Vec3, end: Vec3): TraceResult {
  return trace(ctx.world, start, end, ctx.hull.mins, ctx.hull.maxs, PLAYER_MASK);
}

/** Runs one tick of player movement and returns the new body. */
export function playerMove(body: PlayerBody, cmd: InputCommand, ctx: MovementContext): PlayerBody {
  const m: Mover = { ...body };
  categorizePosition(m, ctx);
  if (cmd.buttons & BUTTON_JUMP) jump(m, ctx);
  else m.jumpHeld = false;
  friction(m, ctx);
  airMove(m, cmd, ctx);
  categorizePosition(m, ctx);
  return { origin: m.origin, velocity: m.velocity, onGround: m.onGround, jumpHeld: m.jumpHeld };
}

export function categorizePosition(m: Mover, ctx: MovementContext): void {
  m.steepNormal = null;
  if (m.velocity.z > AIRBORNE_SPEED) {
    m.onGround = false;
    return;
  }
  const t = traceHull(ctx, m.origin, sub(m.origin, vec3(0, 0, GROUND_PROBE)));
  m.onGround = t.normal.z >= GROUND_NORMAL_Z; // a miss has a zero normal, so it isn't ground
  if (m.onGround && !t.startSolid && !t.allSolid) m.origin = t.endpos;
  if (t.normal.z > 0 && t.normal.z < GROUND_NORMAL_Z) m.steepNormal = t.normal;
}

function jump(m: Mover, ctx: MovementContext): void {
  if (!m.onGround) return;
  if (m.jumpHeld) return; // no pogo-sticking: release before jumping again
  m.onGround = false;
  m.velocity = vec3(m.velocity.x, m.velocity.y, m.velocity.z + ctx.movement.jump_velocity);
  m.jumpHeld = true;
}

export function friction(m: Mover, ctx: MovementContext): void {
  const v = m.velocity;
  const speed = length(v);
  if (speed < 1) {
    m.velocity = vec3(0, 0, v.z);
    return;
  }
  if (!m.onGround) return;

  let f = ctx.movement.friction;
  // Edge friction: stop faster when the leading edge is over a drop-off.
  const horizontal = Math.hypot(v.x, v.y);
  if (horizontal > 0) {
    const start = vec3(
      m.origin.x + (v.x / horizontal) * EDGE_PROBE_AHEAD,
      m.origin.y + (v.y / horizontal) * EDGE_PROBE_AHEAD,
      m.origin.z + ctx.hull.mins.z,
    );
    const down = trace(ctx.world, start, sub(start, vec3(0, 0, EDGE_PROBE_DOWN)), ZERO, ZERO, PLAYER_MASK);
    if (down.fraction === 1) f *= ctx.movement.edge_friction;
  }

  const control = Math.max(speed, ctx.movement.stop_speed);
  const newSpeed = Math.max(speed - control * f * dt, 0);
  m.velocity = scale(v, newSpeed / speed);
}

/** Movement direction and speed the player is asking for, from the view's yaw. */
export function wish(cmd: InputCommand, maxSpeed: number): { dir: Vec3; speed: number } {
  const yaw = angleToRadians(cmd.yaw);
  const forward = vec3(Math.cos(yaw), Math.sin(yaw), 0);
  const right = vec3(Math.sin(yaw), -Math.cos(yaw), 0);
  const wishVel = addScaled(scale(forward, (cmd.forward / 127) * maxSpeed), right, (cmd.side / 127) * maxSpeed);
  const speed = length(wishVel);
  return { dir: speed > 0 ? scale(wishVel, 1 / speed) : ZERO, speed: Math.min(speed, maxSpeed) };
}

function airMove(m: Mover, cmd: InputCommand, ctx: MovementContext): void {
  const mv = ctx.movement;
  const { dir, speed } = wish(cmd, mv.max_ground_speed);
  if (m.onGround) {
    m.velocity = vec3(m.velocity.x, m.velocity.y, 0);
    m.velocity = accelerate(m.velocity, dir, speed, mv.ground_accelerate);
    // Cancelled straight away by groundMove; kept so the order matches QuakeWorld.
    m.velocity = vec3(m.velocity.x, m.velocity.y, m.velocity.z - mv.gravity * dt);
    groundMove(m, ctx);
  } else {
    const w = m.steepNormal ? withoutPushInto(dir, speed, m.steepNormal) : { dir, speed };
    m.velocity = airAccelerate(m.velocity, w.dir, w.speed, mv.air_accelerate, mv.air_wish_speed_cap);
    m.velocity = vec3(m.velocity.x, m.velocity.y, m.velocity.z - mv.gravity * dt);
    flyMove(m, ctx);
  }
}

/**
 * Removes the horizontal part of a wish that pushes into a steep surface.
 * Without this, air acceleration into a slope steeper than 45.6 degrees but
 * shallower than about 66 degrees outweighs gravity and the player slowly
 * climbs it. A deliberate departure from QuakeWorld; see docs/MOVEMENT.md.
 */
export function withoutPushInto(dir: Vec3, speed: number, surfaceNormal: Vec3): { dir: Vec3; speed: number } {
  const across = Math.hypot(surfaceNormal.x, surfaceNormal.y);
  if (across === 0 || speed === 0) return { dir, speed };
  const out = vec3(surfaceNormal.x / across, surfaceNormal.y / across, 0); // horizontal, pointing away from the surface
  const into = dot(dir, out);
  if (into >= 0) return { dir, speed };
  const kept = scale(addScaled(dir, out, -into), speed); // the wish with its into-surface part removed
  const keptSpeed = length(kept);
  return keptSpeed > 0 ? { dir: scale(kept, 1 / keptSpeed), speed: keptSpeed } : { dir: ZERO, speed: 0 };
}

export function accelerate(velocity: Vec3, wishDir: Vec3, wishSpeed: number, accel: number): Vec3 {
  const add = wishSpeed - dot(velocity, wishDir);
  if (add <= 0) return velocity;
  return addScaled(velocity, wishDir, Math.min(accel * dt * wishSpeed, add));
}

/**
 * The cap limits speed gained along the wish direction, but the rate uses the
 * uncapped wish speed. That mismatch is what makes air strafing work; keep it.
 */
export function airAccelerate(velocity: Vec3, wishDir: Vec3, wishSpeed: number, accel: number, cap: number): Vec3 {
  const add = Math.min(wishSpeed, cap) - dot(velocity, wishDir);
  if (add <= 0) return velocity;
  return addScaled(velocity, wishDir, Math.min(accel * wishSpeed * dt, add));
}

export function clipVelocity(v: Vec3, normal: Vec3, overbounce: number): Vec3 {
  const backoff = dot(v, normal) * overbounce;
  const snap = (c: number): number => (c > -STOP_EPSILON && c < STOP_EPSILON ? 0 : c);
  return vec3(snap(v.x - normal.x * backoff), snap(v.y - normal.y * backoff), snap(v.z - normal.z * backoff));
}

/**
 * While walking, a surface too steep to stand on is treated as a vertical wall,
 * so walking into it can't turn into upward motion (which made the player hop
 * at the foot of steep slopes). A deliberate departure from QuakeWorld; see
 * docs/MOVEMENT.md, Steep slopes.
 */
export function asWallIfSteep(normal: Vec3): Vec3 {
  if (normal.z <= 0 || normal.z >= GROUND_NORMAL_Z) return normal;
  const across = Math.hypot(normal.x, normal.y);
  return vec3(normal.x / across, normal.y / across, 0);
}

/** Moves along the velocity for one tick, sliding along anything hit. Walking slides treat steep surfaces as walls. */
export function flyMove(m: Mover, ctx: MovementContext, walking = false): void {
  const original = m.velocity;
  const primal = m.velocity;
  let planes: Vec3[] = [];
  let timeLeft = dt;

  for (let bump = 0; bump < BUMP_COUNT; bump++) {
    const t = traceHull(ctx, m.origin, addScaled(m.origin, m.velocity, timeLeft));
    if (t.startSolid || t.allSolid) {
      m.velocity = ZERO; // trapped
      return;
    }
    if (t.fraction > 0) {
      m.origin = t.endpos;
      planes = [];
    }
    if (t.fraction === 1) return;

    timeLeft -= timeLeft * t.fraction;
    if (planes.length >= MAX_CLIP_PLANES) {
      m.velocity = ZERO;
      return;
    }
    // Hitting a plane already hit during this move is a rounding artifact of
    // sliding along a sloped surface; nudge out along it instead of clipping
    // again, which would stop the player dead. From Quake 3 code/game/
    // bg_slidemove.c PM_SlideMove (id Software, GPLv2 or later).
    const normal = walking ? asWallIfSteep(t.normal) : t.normal;
    if (planes.some((p) => dot(normal, p) > SAME_PLANE_DOT)) {
      m.velocity = add(m.velocity, normal);
      continue;
    }
    planes.push(normal);

    // Find a plane whose clipped velocity doesn't push into any of the others.
    let found = false;
    for (let i = 0; i < planes.length && !found; i++) {
      m.velocity = clipVelocity(original, planes[i]!, 1);
      found = planes.every((p, j) => j === i || dot(m.velocity, p) >= 0);
    }
    if (!found) {
      if (planes.length !== 2) {
        m.velocity = ZERO;
        return;
      }
      const crease = cross(planes[0]!, planes[1]!); // slide along the crease
      m.velocity = scale(crease, dot(crease, m.velocity));
    }
    if (dot(m.velocity, primal) <= 0) {
      m.velocity = ZERO; // turned back on itself: stop dead to avoid jitter in corners
      return;
    }
  }
}

/** Walking: slides along the floor or steps up, whichever gets farther. */
export function groundMove(m: Mover, ctx: MovementContext): void {
  m.velocity = vec3(m.velocity.x, m.velocity.y, 0);
  if (m.velocity.x === 0 && m.velocity.y === 0) return;

  const dest = vec3(m.origin.x + m.velocity.x * dt, m.origin.y + m.velocity.y * dt, m.origin.z);
  const direct = traceHull(ctx, m.origin, dest);
  if (direct.fraction === 1) {
    m.origin = direct.endpos;
    return;
  }

  const startOrigin = m.origin;
  const startVelocity = m.velocity;
  const step = ctx.movement.step_height;

  flyMove(m, ctx, true);
  const downOrigin = m.origin;
  const downVelocity = m.velocity;

  m.origin = startOrigin;
  m.velocity = startVelocity;
  const up = traceHull(ctx, m.origin, addScaled(m.origin, vec3(0, 0, 1), step));
  if (!up.startSolid && !up.allSolid) m.origin = up.endpos;
  flyMove(m, ctx, true);
  const down = traceHull(ctx, m.origin, addScaled(m.origin, vec3(0, 0, -1), step));
  if (down.normal.z < GROUND_NORMAL_Z) {
    // Stepped onto something too steep, or onto nothing: use the plain slide.
    m.origin = downOrigin;
    m.velocity = downVelocity;
    return;
  }
  if (!down.startSolid && !down.allSolid) m.origin = down.endpos;
  const upOrigin = m.origin;

  const downDist = (downOrigin.x - startOrigin.x) ** 2 + (downOrigin.y - startOrigin.y) ** 2;
  const upDist = (upOrigin.x - startOrigin.x) ** 2 + (upOrigin.y - startOrigin.y) ** 2;
  if (downDist > upDist) {
    m.origin = downOrigin;
    m.velocity = downVelocity;
  } else {
    m.velocity = vec3(m.velocity.x, m.velocity.y, downVelocity.z);
  }
}

export type { Mover };
