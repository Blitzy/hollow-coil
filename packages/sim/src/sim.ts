// The simulation: plain, serializable state advanced one fixed tick at a time by
// input commands. It reads nothing else: no clock, devices, or renderer.

import { eyePosition, fireHitscan, type PelletHit } from "./combat/hitscan.ts";
import type { EnemiesData, PlayerData, WeaponsData } from "./data.ts";
import { hullFromData } from "./data.ts";
import type { InputCommand } from "./input.ts";
import type { Level } from "./level.ts";
import { add, vec3, ZERO, type Vec3 } from "./math/vec3.ts";
import { playerMove, type MovementContext } from "./player/movement.ts";
import { startingWeapon, weaponContext, weaponFrame, type WeaponContext, type WeaponState } from "./player/weapons.ts";
import { seedRandom } from "./rng.ts";
import { SPAWN_RAISE } from "./constants.ts";
import { updateEnemy, type EnemyEvent } from "./enemy/ai.ts";
import { createEnemy, enemyContext, type EnemyContext, type EnemySpawn, type EnemyState } from "./enemy/enemy.ts";

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
  | EnemyEvent;

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

/**
 * Advances the sim by one tick: the player moves, then uses their weapon (as in
 * Quake), from where they ended up; then each enemy, in spawn order.
 */
export function step(state: SimState, cmd: InputCommand, ctx: SimContext): StepResult {
  const p = state.player;
  const moved = playerMove(p, cmd, ctx.movement);
  const { weapon, fired } = weaponFrame(p.weapon, cmd, ctx.weapons);
  const events: SimEvent[] = [];
  let rng = state.rng;
  if (fired) {
    events.push({ type: "fired", entity: p.id, weapon: weapon.current });
    const attack = ctx.weapons.attacks.get(weapon.current)!;
    // No entities to hit until enemies arrive (M4).
    const shot = fireHitscan(ctx.movement.world, [], eyePosition(moved.origin, ctx.eyeHeight), cmd.yaw, cmd.pitch, attack, rng);
    rng = shot.rng;
    for (const hit of shot.pellets) if (hit) events.push(hitEvent(p.id, hit, attack.damage));
  }
  const tick = state.tick + 1;
  const player = { id: p.id, eye: eyePosition(moved.origin, ctx.eyeHeight) };
  const enemies = state.enemies.map((enemy) => {
    const update = updateEnemy(enemy, tick, ctx.enemies.types.get(enemy.type)!, ctx.movement.world, player);
    events.push(...update.events);
    return update.enemy;
  });
  return {
    state: { ...state, tick, rng, player: { ...p, ...moved, yaw: cmd.yaw, pitch: cmd.pitch, weapon }, enemies },
    events,
  };
}
