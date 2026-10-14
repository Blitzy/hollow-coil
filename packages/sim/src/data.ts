// Shapes of the shared gameplay data in /data, as the sim uses them. The caller
// loads and parses the JSON (validated by tools/src/validate.ts) and passes it in;
// the sim never reads files itself.

import { vec3, type Vec3 } from "./math/vec3.ts";

export interface HullData {
  readonly mins: readonly number[];
  readonly maxs: readonly number[];
}

export interface PlayerData {
  readonly health: number;
  readonly hull: HullData;
  readonly eye_height: number;
  readonly weapons: readonly string[];
  readonly starting_weapon: string;
  readonly movement: {
    readonly max_ground_speed: number;
    readonly ground_accelerate: number;
    readonly friction: number;
    readonly edge_friction: number;
    readonly stop_speed: number;
    readonly air_accelerate: number;
    readonly air_wish_speed_cap: number;
    readonly gravity: number;
    readonly jump_velocity: number;
    readonly step_height: number;
  };
}

export interface Hull {
  readonly mins: Vec3;
  readonly maxs: Vec3;
}

export function hullFromData(data: HullData): Hull {
  const [x0, y0, z0] = data.mins;
  const [x1, y1, z1] = data.maxs;
  return { mins: vec3(x0!, y0!, z0!), maxs: vec3(x1!, y1!, z1!) };
}
