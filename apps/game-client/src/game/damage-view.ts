// What getting hurt looks like, as in Quake's view.c: the screen flashes red,
// more for bigger hits, and the view kicks toward where the shot came from,
// both fading out over a fraction of a second.

import { dot, normalize, sub, vec3, type Vec3 } from "@mandreljs/sim/math/vec3";

/** Quake's damage color shift: up to 150 (of 255), fading 150 a second (V_ParseDamage, V_UpdatePalette). */
const MAX_SHIFT = 150;
const SHIFT_FADE = 150;
/** A hit counts half its damage, at least 10, and adds 3 times that to the shift (V_ParseDamage). */
const MIN_COUNT = 10;
const SHIFT_PER_COUNT = 3;
/** Quake's v_kickpitch, v_kickroll (degrees per count), and v_kicktime (seconds). */
const KICK_PITCH = 0.6;
const KICK_ROLL = 0.6;
const KICK_TIME = 0.5;

const DEGREES = Math.PI / 180;

export class DamageView {
  private shift = 0;
  private kickLeft = 0;
  private kickPitch = 0;
  private kickRoll = 0;

  /**
   * The player took amount damage at origin, facing yaw (radians), from an attacker at from (null when there's none
   * to point at, which only flashes).
   */
  hurt(amount: number, origin: Vec3, yaw: number, from: Vec3 | null): void {
    const count = Math.max(MIN_COUNT, amount * 0.5);
    this.shift = Math.min(MAX_SHIFT, this.shift + SHIFT_PER_COUNT * count);
    if (from === null) return;
    const toward = normalize(sub(from, origin));
    const forward = vec3(Math.cos(yaw), Math.sin(yaw), 0);
    const right = vec3(Math.sin(yaw), -Math.cos(yaw), 0);
    this.kickRoll = count * dot(toward, right) * KICK_ROLL;
    this.kickPitch = count * dot(toward, forward) * KICK_PITCH;
    this.kickLeft = KICK_TIME;
  }

  /** Fades the flash and the kick. Call once a frame with the seconds since the last. */
  update(seconds: number): void {
    this.shift = Math.max(0, this.shift - SHIFT_FADE * seconds);
    this.kickLeft = Math.max(0, this.kickLeft - seconds);
  }

  reset(): void {
    this.shift = 0;
    this.kickLeft = 0;
  }

  /** The red flash's opacity, 0 to about 0.6. */
  get flash(): number {
    return this.shift / 255;
  }

  /** The kick's pitch, in radians, positive looking up. A shot from in front dips the view, as in Quake. */
  get pitch(): number {
    return -(this.kickLeft / KICK_TIME) * this.kickPitch * DEGREES;
  }

  /** The kick's roll, in radians, right side down. A shot from the right tilts the view toward it, as in Quake. */
  get roll(): number {
    return (this.kickLeft / KICK_TIME) * this.kickRoll * DEGREES;
  }
}
