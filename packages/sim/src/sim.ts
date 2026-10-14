// The simulation: plain, serializable state advanced one fixed tick at a time by
// input commands. It reads nothing else: no clock, devices, or renderer.

import { eyePosition, fireHitscan, type PelletHit } from "./combat/hitscan.ts";
import { entityBox, withBrushes } from "./collision/box.ts";
import type { CollisionBrush } from "./collision/trace.ts";
import { CONTENTS } from "./constants.ts";
import type { EnemiesData, HitscanData, PlayerData, WeaponsData } from "./data.ts";
import { hullFromData } from "./data.ts";
import type { InputCommand } from "./input.ts";
import type { Level } from "./level.ts";
import { add, vec3, ZERO, type Vec3 } from "./math/vec3.ts";
import { playerMove, type MovementContext } from "./player/movement.ts";
import { startingWeapon, weaponContext, weaponFrame, type WeaponContext, type WeaponState } from "./player/weapons.ts";
import { seedRandom } from "./rng.ts";
import { PLAYER_ID, SPAWN_RAISE } from "./constants.ts";
import { updateEnemy, type EnemyEvent, type Quarry, type Surroundings } from "./enemy/ai.ts";
import { damageEnemy, type Attacker, type DamageEvent } from "./enemy/damage.ts";
import { alive, createEnemy, enemyBrush, enemyContext, type EnemyContext, type EnemySpawn, type EnemyState } from "./enemy/enemy.ts";

export { PLAYER_ID };

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

/** What a tick changes as it runs: the player, the enemies, the RNG, and what happened. */
interface TickWork {
  readonly tick: number;
  player: PlayerState;
  enemies: EnemyState[];
  rng: number;
  readonly events: SimEvent[];
}

export const playerAlive = (player: PlayerState): boolean => player.health > 0;

const playerBox = (player: PlayerState, ctx: SimContext): CollisionBrush => entityBox(player.origin, ctx.movement.hull, CONTENTS.MONSTER);

/** Every living entity's box except one's own: what a shot can hit, and what blocks an enemy's steps. */
function otherBoxes(work: TickWork, ctx: SimContext, self: number): (CollisionBrush & { readonly id: number })[] {
  const boxes: (CollisionBrush & { readonly id: number })[] = [];
  if (work.player.id !== self && playerAlive(work.player)) boxes.push({ ...playerBox(work.player, ctx), id: work.player.id });
  for (const e of work.enemies) if (e.id !== self && alive(e)) boxes.push({ ...enemyBrush(e, ctx.enemies.types.get(e.type)!), id: e.id });
  return boxes;
}

/** The player loses health; at zero, they're dead. */
function damagePlayer(work: TickWork, amount: number, attacker: number): void {
  const before = work.player.health;
  const health = before - amount;
  work.player = { ...work.player, health };
  work.events.push({ type: "damaged", entity: work.player.id, attacker, amount, health });
  if (health <= 0 && before > 0) work.events.push({ type: "died", entity: work.player.id, attacker });
}

/**
 * Fires a hitscan attack and applies its damage: every pellet is traced
 * first, then each victim takes its pellets' total once, in the order each was
 * first hit (Quake's multi-damage).
 */
function shoot(work: TickWork, ctx: SimContext, shooter: Attacker, weapon: string, eye: Vec3, yaw: number, pitch: number, attack: HitscanData): void {
  work.events.push({ type: "fired", entity: shooter.id, weapon });
  const shot = fireHitscan(ctx.movement.world, otherBoxes(work, ctx, shooter.id), eye, yaw, pitch, attack, work.rng);
  work.rng = shot.rng;
  const damage = new Map<number, number>();
  for (const hit of shot.pellets) {
    if (!hit) continue;
    work.events.push(hitEvent(shooter.id, hit, attack.damage));
    if (hit.kind === "entity") damage.set(hit.entity, (damage.get(hit.entity) ?? 0) + attack.damage);
  }
  for (const [id, amount] of damage) {
    if (id === work.player.id) {
      damagePlayer(work, amount, shooter.id);
      continue;
    }
    const i = work.enemies.findIndex((e) => e.id === id);
    const victim = work.enemies[i]!;
    const result = damageEnemy(victim, amount, shooter, work.tick, ctx.enemies.types.get(victim.type)!, work.rng);
    work.rng = result.rng;
    work.events.push(...result.events);
    work.enemies[i] = result.enemy;
  }
}

/** What enemies need to know about a living entity they might hunt. */
function quarryOf(work: TickWork, ctx: SimContext, id: number): Quarry | null {
  if (id === work.player.id) {
    const p = work.player;
    if (!playerAlive(p)) return null;
    const box = playerBox(p, ctx);
    return { id, origin: p.origin, velocity: p.velocity, eye: eyePosition(p.origin, ctx.eyeHeight), mins: box.mins, maxs: box.maxs };
  }
  const e = work.enemies.find((x) => x.id === id);
  if (!e || !alive(e)) return null;
  const type = ctx.enemies.types.get(e.type)!;
  const box = enemyBrush(e, type);
  return { id, origin: e.origin, velocity: ZERO, eye: eyePosition(e.origin, type.data.eye_height), mins: box.mins, maxs: box.maxs };
}

/**
 * Advances the sim by one tick. The player moves (blocked by living enemies),
 * then uses their weapon (as in Quake), from where they ended up; a dead
 * player does neither. Then each enemy, in spawn order, thinks (on its think
 * ticks), fires if it's time, and moves, seeing everyone where they are by
 * then. Shots' damage lands as each shot is fired.
 */
export function step(state: SimState, cmd: InputCommand, ctx: SimContext): StepResult {
  const work: TickWork = { tick: state.tick + 1, player: state.player, enemies: [...state.enemies], rng: state.rng, events: [] };
  const p = state.player;

  if (playerAlive(p)) {
    const blockers = otherBoxes(work, ctx, p.id);
    const moved = playerMove(p, cmd, { ...ctx.movement, world: withBrushes(ctx.movement.world, blockers) });
    const { weapon, fired } = weaponFrame(p.weapon, cmd, ctx.weapons);
    work.player = { ...p, ...moved, yaw: cmd.yaw, pitch: cmd.pitch, weapon };
    if (fired) {
      const eye = eyePosition(moved.origin, ctx.eyeHeight);
      shoot(work, ctx, { id: p.id, type: null }, weapon.current, eye, cmd.yaw, cmd.pitch, ctx.weapons.attacks.get(weapon.current)!);
    }
  } else {
    work.player = { ...p, velocity: ZERO, yaw: cmd.yaw, pitch: cmd.pitch }; // the dead can still look around
  }

  for (let i = 0; i < work.enemies.length; i++) {
    const enemy = work.enemies[i]!;
    const type = ctx.enemies.types.get(enemy.type)!;
    const others = otherBoxes(work, ctx, enemy.id);
    const surroundings: Surroundings = {
      world: ctx.movement.world,
      blockers: withBrushes(ctx.movement.world, others),
      player: quarryOf(work, ctx, work.player.id),
      quarry: (id) => quarryOf(work, ctx, id),
      targets: others,
    };
    const update = updateEnemy(enemy, work.tick, type, surroundings, work.rng);
    work.rng = update.rng;
    work.events.push(...update.events);
    work.enemies[i] = update.enemy;
    if (update.shot) {
      const { eye, yaw, pitch } = update.shot;
      shoot(work, ctx, { id: enemy.id, type: enemy.type }, enemy.type, eye, yaw, pitch, type.data.attack.hitscan);
    }
  }

  return { state: { ...state, tick: work.tick, rng: work.rng, player: work.player, enemies: work.enemies }, events: work.events };
}
