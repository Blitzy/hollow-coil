// The sim's only input: one command per tick. Matches spec/schemas/input_command.schema.json.

export interface InputCommand {
  /** Absolute yaw, 65536 units per turn; 0 faces +x, increasing counterclockwise. */
  readonly yaw: number;
  /** Absolute pitch, 65536 units per turn; positive looks up. */
  readonly pitch: number;
  /** -127 to 127; positive is forward. */
  readonly forward: number;
  /** -127 to 127; positive is right. */
  readonly side: number;
  readonly buttons: number;
  /** Weapon slot to switch to, or 0 for no change. */
  readonly weapon: number;
}

export const BUTTON_ATTACK = 1;
export const BUTTON_JUMP = 2;

export const ANGLE_UNITS_PER_TURN = 65536;

export const angleToRadians = (units: number): number => (units * 2 * Math.PI) / ANGLE_UNITS_PER_TURN;

export const NEUTRAL_COMMAND: InputCommand = { yaw: 0, pitch: 0, forward: 0, side: 0, buttons: 0, weapon: 0 };
