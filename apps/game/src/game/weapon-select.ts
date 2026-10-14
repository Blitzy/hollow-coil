// Turning the mouse wheel into weapon switches. The wheel steps through the
// player's weapons in slot order, wrapping around; wheel up is the next weapon,
// as in Quake 3's default bindings.

/** Wheel movement, in pixels, that counts as one step. A mouse wheel notch is at least this. */
export const WHEEL_STEP = 50;
/** Pixels per line or page, for wheel events that report those units. */
const LINE_PIXELS = 40;
const PAGE_PIXELS = 800;

/**
 * Counts wheel steps from wheel events. A mouse wheel notch is one step,
 * however many pixels it reports; a trackpad's small movements add up to one.
 */
export class WheelSteps {
  private pending = 0;
  private small = 0;

  /** deltaY and deltaMode from a WheelEvent (0 pixels, 1 lines, 2 pages). */
  add(deltaY: number, deltaMode = 0): void {
    const pixels = deltaY * (deltaMode === 1 ? LINE_PIXELS : deltaMode === 2 ? PAGE_PIXELS : 1);
    if (Math.abs(pixels) >= WHEEL_STEP) {
      this.pending -= Math.sign(pixels); // wheel up (negative deltaY) is the next weapon
      this.small = 0;
      return;
    }
    this.small += pixels;
    if (Math.abs(this.small) >= WHEEL_STEP) {
      this.pending -= Math.sign(this.small);
      this.small = 0;
    }
  }

  /** Steps since the last call: positive for next weapons, negative for previous. */
  take(): number {
    const steps = this.pending;
    this.pending = 0;
    return steps;
  }
}

/**
 * The slot steps away from fromSlot among the player's slots (sorted), wrapping
 * around. 0 if the player has no weapons. A fromSlot the player doesn't have
 * counts as sitting before the first slot.
 */
export function cycleSlot(slots: readonly number[], fromSlot: number, steps: number): number {
  if (slots.length === 0) return 0;
  const index = slots.indexOf(fromSlot);
  const from = index < 0 ? (steps > 0 ? -1 : 0) : index;
  const n = slots.length;
  return slots[(((from + steps) % n) + n) % n]!;
}
