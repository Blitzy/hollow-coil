// The simulation: plain, serializable state advanced one fixed tick at a time by
// input commands. It reads nothing else: no clock, devices, or renderer.

import { eyePosition, fireHitscan, type HitTarget, type PelletHit } from "./combat/hitscan.ts";
import { entityBox, withBrushes } from "./collision/box.ts";
import { CONTENTS } from "./constants.ts";
import type { EnemiesData, PlayerData, WeaponsData } from "./data.ts";
import { hullFromData } from "./data.ts";
import type { InputCommand } from "./input.ts";
import type { Level } from "./level.ts";
import { add, vec3, ZERO, type Vec3 } from "./math/vec3.ts";
import { playerMove, type MovementContext } from "./player/movement.ts";
import { startingWeapon, weaponContext, weaponFrame, type WeaponContext, type WeaponState } from "./player/weapons.ts";
import { seedRandom } from "./rng.ts";
import { SPAWN_RAISE } from "./constants.ts";
import { updateEnemy, type EnemyEvent, type Quarry } from "./enemy/ai.ts";
import { damageEnemy, type DamageEvent } from "./enemy/damage.ts";
import { alive, createEnemy, enemyBrush, enemyContext, type EnemyContext, type EnemySpawn, type EnemyState } from "./enemy/enemy.ts";

export const PLAYER_ID = 1;

export interface PlayerState {
  readonly id: number;
  readonly origin: Vec3;
  readonly velocity: Vec3;
  readonly onGround: boolean;
  readonly jumpHeld: boolean;
  /** View angles from the latest command, in angle units. */
  readonly yaw: number;
  readonly pitch: number;
  readonly health: number;
  readonly weapon: WeaponState;
}

export interface SimState {
  /** Ticks simulated so far. */
  readonly tick: number;
  readonly rng: number;
  /** Next id to hand out; ids are never reused. */
  readonly nextEntityId: number;
  readonly player: PlayerState;
  /** Every enemy, in spawn order, dead ones included. */
  readonly enemies: readonly EnemyState[];
}

/** Something that happened during a tick, for presentation (audio, effects) and tests. entity is who acted. */
export type SimEvent =
  | { readonly type: "fired"; readonly entity: number; readonly weapon: string }
  /** A pellet hit the world, stopping just short of the surface. */
  | { readonly type: "hitWall"; readonly entity: number; readonly point: Vec3; readonly normal: Vec3 }
  | { readonly type: "hitEntity"; readonly entity: number; readonly target: number; readonly point: Vec3; readonly damage: number }
  | EnemyEvent
  | DamageEvent;

export interface StepResult {
  readonly state: SimState;
  readonly events: readonly SimEvent[];
}

export interface SimConfig {
  readonly player: PlayerData;
  readonly weapons: WeaponsData;
  readonly enemies: EnemiesData;
}

export interface Spawn {
  readonly origin: Vec3;
  /** Facing in angle units. */
  readonly yaw: number;
  readonly pitch?: number;
}

/** A new sim: the player at spawn, and enemies (see enemySpawns) with ids after the player's. */
export function createSim(config: SimConfig, spawn: Spawn, seed = 0, enemies: readonly EnemySpawn[] = []): SimState {
  const types = enemyContext(config.enemies).types;
  return {
    tick: 0,
    rng: seedRandom(seed),
    nextEntityId: PLAYER_ID + 1 + enemies.length,
    player: {
      id: PLAYER_ID,
      origin: add(spawn.origin, vec3(0, 0, SPAWN_RAISE)),
      velocity: ZERO,
      onGround: false,
      jumpHeld: false,
      yaw: spawn.yaw,
      pitch: spawn.pitch ?? 0,
      health: config.player.health,
      weapon: startingWeapon(config.player.starting_weapon),
    },
    enemies: enemies.map((e, i) => createEnemy(PLAYER_ID + 1 + i, e, types.get(e.type)!, i)),
  };
}

/** Everything step needs that isn't sim state: the level and the data, prepared once. */
export interface SimContext {
  readonly movement: MovementContext;
  readonly weapons: WeaponContext;
  readonly enemies: EnemyContext;
  /** How far above the player's origin shots start. */
  readonly eyeHeight: number;
}

/** Builds the context once per level and config; pass it to step. */
export function simContext(level: Level, config: SimConfig): SimContext {
  return {
    movement: { world: level.world, hull: hullFromData(config.player.hull), movement: config.player.movement },
    weapons: weaponContext(config.weapons, config.player.weapons),
    enemies: enemyContext(config.enemies),
    eyeHeight: config.player.eye_height,
  };
}

/** The event for one pellet's hit. */
function hitEvent(shooter: number, hit: PelletHit, damage: number): SimEvent {
  return hit.kind === "world"
    ? { type: "hitWall", entity: shooter, point: hit.point, normal: hit.normal }
    : { type: "hitEntity", entity: shooter, target: hit.entity, point: hit.point, damage };
}

/** Each living enemy's box, for shots to hit. */
function enemyTargets(enemies: readonly EnemyState[], ctx: SimContext): HitTarget[] {
  return enemies.filter(alive).map((e) => {
    const brush = enemyBrush(e, ctx.enemies.types.get(e.type)!);
    return { id: e.id, mins: brush.mins, maxs: brush.maxs };
  });
}

/**
 * Advances the sim by one tick: the player moves (blocked by living enemies),
 * then uses their weapon (as in Quake), from where they ended up. A shot's
 * damage is applied after all its pellets are traced. Then each enemy thinks,
 * in spawn order.
 */
export function step(state: SimState, cmd: InputCommand, ctx: SimContext): StepResult {
  const tick = state.tick + 1;
  const p = state.player;
  const blockers = state.enemies.filter(alive).map((e) => enemyBrush(e, ctx.enemies.types.get(e.type)!));
  const moved = playerMove(p, cmd, { ...ctx.movement, world: withBrushes(ctx.movement.world, blockers) });
  const { weapon, fired } = weaponFrame(p.weapon, cmd, ctx.weapons);
  const events: SimEvent[] = [];
  let rng = state.rng;
  let enemies = state.enemies;
  if (fired) {
    events.push({ type: "fired", entity: p.id, weapon: weapon.current });
    const attack = ctx.weapons.attacks.get(weapon.current)!;
    const eye = eyePosition(moved.origin, ctx.eyeHeight);
    const shot = fireHitscan(ctx.movement.world, enemyTargets(enemies, ctx), eye, cmd.yaw, cmd.pitch, attack, rng);
    rng = shot.rng;
    // Add up each enemy's pellets, in the order each was first hit (Quake's multi-damage).
    const damage = new Map<number, number>();
    for (const hit of shot.pellets) {
      if (!hit) continue;
      events.push(hitEvent(p.id, hit, attack.damage));
      if (hit.kind === "entity") damage.set(hit.entity, (damage.get(hit.entity) ?? 0) + attack.damage);
    }
    for (const [id, amount] of damage) {
      enemies = enemies.map((enemy) => {
        if (enemy.id !== id) return enemy;
        const result = damageEnemy(enemy, amount, p.id, tick, ctx.enemies.types.get(enemy.type)!, rng);
        rng = result.rng;
        events.push(...result.events);
        return result.enemy;
      });
    }
  }
  // Each enemy in turn, seeing the others where they are by now. The player's box blocks enemies like an enemy's does.
  const playerBox = entityBox(moved.origin, ctx.movement.hull, CONTENTS.MONSTER);
  const player: Quarry = { id: p.id, origin: moved.origin, eye: eyePosition(moved.origin, ctx.eyeHeight), mins: playerBox.mins, maxs: playerBox.maxs };
  const updated = [...enemies];
  updated.forEach((enemy, i) => {
    const others = updated.filter((e, j) => j !== i && alive(e)).map((e) => enemyBrush(e, ctx.enemies.types.get(e.type)!));
    const surroundings = { world: ctx.movement.world, blockers: withBrushes(ctx.movement.world, [playerBox, ...others]), player };
    const update = updateEnemy(enemy, tick, ctx.enemies.types.get(enemy.type)!, surroundings, rng);
    rng = update.rng;
    events.push(...update.events);
    updated[i] = update.enemy;
  });
  enemies = updated;
  return {
    state: { ...state, tick, rng, player: { ...p, ...moved, yaw: cmd.yaw, pitch: cmd.pitch, weapon }, enemies },
    events,
  };
}
