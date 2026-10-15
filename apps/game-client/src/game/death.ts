// Dying and starting over, as in Quake: the view drops to the floor and rolls,
// and once the death has played out, a press of attack or jump restarts the level.

import { secondsToTicks } from "@mandreljs/sim/constants";
import { BUTTON_ATTACK, BUTTON_JUMP } from "@mandreljs/sim/input";

/** A dead player's eye height above their origin: Quake's view_ofs from PlayerDie (player.qc). */
export const DEAD_EYE_HEIGHT = -8;
/** A dead player's view roll, in radians, right side down: Quake's dead view angle (view.c, V_CalcRefdef). */
export const DEAD_ROLL = (80 * Math.PI) / 180;
/** Seconds after dying before a press restarts: about as long as Quake's player death animations. */
export const RESPAWN_DELAY = 1;

/**
 * Decides when a dead player starts over, following Quake's PlayerDeathThink
 * (client.qc): after the delay, every button must be let go, and then a press of
 * attack or jump restarts. Holding fire through a death never restarts by accident.
 */
export class RespawnWait {
  private readonly delayTicks: number;
  private diedAt: number | null = null;
  private released = false;

  constructor(delaySeconds = RESPAWN_DELAY) {
    this.delayTicks = secondsToTicks(delaySeconds);
  }

  /** True once a press will restart: the delay has passed and the buttons were let go. */
  get ready(): boolean {
    return this.released;
  }

  /** Call once a tick with the sim's tick, whether the player is alive, and the command's buttons. Returns true to restart. */
  update(tick: number, alive: boolean, buttons: number): boolean {
    if (alive) {
      this.diedAt = null;
      this.released = false;
      return false;
    }
    this.diedAt ??= tick;
    if (tick - this.diedAt < this.delayTicks) return false;
    const pressed = (buttons & (BUTTON_ATTACK | BUTTON_JUMP)) !== 0;
    if (!this.released) {
      this.released = !pressed;
      return false;
    }
    return pressed;
  }
}
