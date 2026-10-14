// Turns the player's held keys and mouse-look angles into the sim's quantized input command.

import { ANGLE_UNITS_PER_TURN, BUTTON_ATTACK, BUTTON_JUMP, wrapYaw, type InputCommand } from "@hollow-coil/sim/input";

export interface HeldInput {
  /** View yaw in radians, accumulated from the mouse at full precision. */
  readonly yaw: number;
  readonly pitch: number;
  readonly forward: boolean;
  readonly back: boolean;
  readonly left: boolean;
  readonly right: boolean;
  readonly jump: boolean;
  readonly attack: boolean;
  /** Weapon slot pressed since the last command, or 0. */
  readonly weapon: number;
}

/** Pitch is kept just short of straight up or down. */
export const MAX_PITCH = (89 * Math.PI) / 180;

const toUnits = (radians: number): number => Math.round((radians * ANGLE_UNITS_PER_TURN) / (2 * Math.PI));

export function buildCommand(input: HeldInput): InputCommand {
  const pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, input.pitch));
  return {
    yaw: wrapYaw(toUnits(input.yaw)),
    pitch: toUnits(pitch),
    forward: (input.forward ? 127 : 0) - (input.back ? 127 : 0),
    side: (input.right ? 127 : 0) - (input.left ? 127 : 0),
    buttons: (input.jump ? BUTTON_JUMP : 0) | (input.attack ? BUTTON_ATTACK : 0),
    weapon: input.weapon,
  };
}
