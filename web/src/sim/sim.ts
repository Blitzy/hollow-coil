// The simulation: plain, serializable state advanced one fixed tick at a time by
// input commands. It reads nothing else: no clock, devices, or renderer.

import type { PlayerData } from "./data";
import { hullFromData } from "./data";
import type { InputCommand } from "./input";
import type { Level } from "./level";
import { add, vec3, ZERO, type Vec3 } from "./math/vec3";
import { playerMove, type MovementContext } from "./player/movement";
import { seedRandom } from "./rng";

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
}

export interface SimState {
  /** Ticks simulated so far. */
  readonly tick: number;
  readonly rng: number;
  /** Next id to hand out; ids are never reused. */
  readonly nextEntityId: number;
  readonly player: PlayerState;
}

/** Things that happened during a tick, for presentation (audio, effects). None yet in M1. */
export type SimEvent = never;

export interface StepResult {
  readonly state: SimState;
  readonly events: readonly SimEvent[];
}

export interface SimConfig {
  readonly player: PlayerData;
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
    },
  };
}

/** Builds the movement context once per level and config; pass it to step. */
export function movementContext(level: Level, config: SimConfig): MovementContext {
  return { world: level.world, hull: hullFromData(config.player.hull), movement: config.player.movement };
}

/** Advances the sim by one tick. */
export function step(state: SimState, cmd: InputCommand, ctx: MovementContext): StepResult {
  const p = state.player;
  const moved = playerMove(p, cmd, ctx);
  return {
    state: { ...state, tick: state.tick + 1, player: { ...p, ...moved, yaw: cmd.yaw, pitch: cmd.pitch } },
    events: [],
  };
}
