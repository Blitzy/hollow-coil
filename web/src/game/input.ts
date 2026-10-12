// Keyboard and mouse input in the browser. Mouse look needs pointer lock, which
// starts on a click on the canvas.

import type { HeldInput } from "./command";
import { MAX_PITCH } from "./command";

const KEYS = {
  forward: ["KeyW", "ArrowUp"],
  back: ["KeyS", "ArrowDown"],
  left: ["KeyA"],
  right: ["KeyD"],
  jump: ["Space"],
} as const;

/** One mouse event moving farther than this, in pixels, is logged as a likely browser glitch. */
const SUSPICIOUS_MOVEMENT = 300;

/**
 * Locks the pointer to an element, asking for raw (unadjusted) mouse input where
 * the browser supports it. Raw input skips the OS's pointer acceleration, like
 * Quake's m_rawinput, and avoids a Chromium bug on Windows where accelerated
 * pointer-lock movement now and then reports one huge jump that spins the view.
 * Falls back to ordinary pointer lock where raw input isn't supported, or when
 * raw is false. Resolves to whether raw input is in use.
 */
export async function lockPointer(element: Pick<Element, "requestPointerLock">, raw = true): Promise<boolean> {
  if (!raw) {
    await element.requestPointerLock();
    return false;
  }
  try {
    await element.requestPointerLock({ unadjustedMovement: true });
    return true;
  } catch {
    await element.requestPointerLock();
    return false;
  }
}

export class BrowserInput {
  /** Radians of turn per pixel of mouse movement. */
  sensitivity = 0.0033;
  yaw = 0;
  pitch = 0;
  private readonly held = new Set<string>();
  private attack = false;
  private pendingWeapon = 0;

  /** Whether the current pointer lock uses raw mouse input. */
  rawInput = false;

  /** preferRawInput: ask for raw mouse input when locking (see lockPointer). */
  constructor(
    private readonly element: HTMLElement,
    preferRawInput = true,
  ) {
    element.addEventListener("click", () => {
      if (this.locked) return;
      lockPointer(element, preferRawInput).then(
        (raw) => (this.rawInput = raw),
        (error: unknown) => console.warn("pointer lock failed:", error),
      );
    });
    window.addEventListener("keydown", (e) => {
      this.held.add(e.code);
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit) this.pendingWeapon = Number(digit[1]);
      if (Object.values(KEYS).some((codes) => (codes as readonly string[]).includes(e.code))) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.held.delete(e.code));
    window.addEventListener("blur", () => this.held.clear());
    element.addEventListener("mousedown", (e) => {
      if (this.locked && e.button === 0) this.attack = true;
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.attack = false;
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      if (Math.abs(e.movementX) > SUSPICIOUS_MOVEMENT || Math.abs(e.movementY) > SUSPICIOUS_MOVEMENT) {
        console.warn(`large mouse movement in one event: ${e.movementX}, ${e.movementY} (raw input: ${this.rawInput})`);
      }
      this.yaw -= e.movementX * this.sensitivity; // moving right turns clockwise, toward lower yaw
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - e.movementY * this.sensitivity));
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.element;
  }

  private isHeld(codes: readonly string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }

  /** The input to build this tick's command from. A weapon press is consumed by the first tick that reads it. */
  read(): HeldInput {
    const weapon = this.pendingWeapon;
    this.pendingWeapon = 0;
    return {
      yaw: this.yaw,
      pitch: this.pitch,
      forward: this.isHeld(KEYS.forward),
      back: this.isHeld(KEYS.back),
      left: this.isHeld(KEYS.left),
      right: this.isHeld(KEYS.right),
      jump: this.isHeld(KEYS.jump),
      attack: this.attack,
      weapon,
    };
  }
}
