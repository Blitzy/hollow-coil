// The simulation: plain, serializable state advanced one fixed tick at a time by
// input commands. It reads nothing else: no clock, devices, or renderer.

import type { PlayerData, WeaponsData } from "./data.ts";
import { hullFromData } from "./data.ts";
import type { InputCommand } from "./input.ts";
import type { Level } from "./level.ts";
import { add, vec3, ZERO, type Vec3 } from "./math/vec3.ts";
import { playerMove, type MovementContext } from "./player/movement.ts";
import { startingWeapon, weaponContext, weaponFrame, type WeaponContext, type WeaponState } from "./player/weapons.ts";
import { seedRandom } from "./rng.ts";

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
}

/** Something that happened during a tick, for presentation (audio, effects) and tests. */
export type SimEvent = { readonly type: "fired"; readonly entity: number; readonly weapon: string };

export interface StepResult {
  readonly state: SimState;
  readonly events: readonly SimEvent[];
}

export interface SimConfig {
  readonly player: PlayerData;
  readonly weapons: WeaponsData;
}

export interface Spawn {
  readonly origin: Vec3;
  /** Facing in angle units. */
  readonly yaw: number;
  readonly pitch?: number;
}

/** Spawn origins are raised 1 unit so the player doesn't start touching the floor (docs/MOVEMENT.md, Spawning). */
export const SPAWN_RAISE = 1;

export function createSim(config: SimConfig, spawn: Spawn, seed = 0): SimState {
  return {
    tick: 0,
    rng: seedRandom(seed),
    nextEntityId: PLAYER_ID + 1,
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
  };
}

/** Everything step needs that isn't sim state: the level and the data, prepared once. */
export interface SimContext {
  readonly movement: MovementContext;
  readonly weapons: WeaponContext;
}

/** Builds the context once per level and config; pass it to step. */
export function simContext(level: Level, config: SimConfig): SimContext {
  return {
    movement: { world: level.world, hull: hullFromData(config.player.hull), movement: config.player.movement },
    weapons: weaponContext(config.weapons, config.player.weapons),
  };
}

/** Advances the sim by one tick: the player moves, then uses their weapon (as in Quake), from where they ended up. */
export function step(state: SimState, cmd: InputCommand, ctx: SimContext): StepResult {
  const p = state.player;
  const moved = playerMove(p, cmd, ctx.movement);
  const { weapon, fired } = weaponFrame(p.weapon, cmd, ctx.weapons);
  const events: SimEvent[] = fired ? [{ type: "fired", entity: p.id, weapon: weapon.current }] : [];
  return {
    state: { ...state, tick: state.tick + 1, player: { ...p, ...moved, yaw: cmd.yaw, pitch: cmd.pitch, weapon } },
    events,
  };
}
