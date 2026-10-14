import { describe, expect, it } from "vitest";
import { cycleSlot, WheelSteps, WHEEL_STEP } from "../../src/game/weapon-select.ts";

describe("WheelSteps", () => {
  const steps = (...events: [number, number?][]): number => {
    const wheel = new WheelSteps();
    for (const [deltaY, mode] of events) wheel.add(deltaY, mode);
    return wheel.take();
  };

  it("counts each mouse wheel notch as one step, however many pixels it reports", () => {
    expect(steps([-100])).toBe(1);
    expect(steps([-120], [-150])).toBe(2);
    expect(steps([100], [100], [100])).toBe(-3);
  });

  it("makes wheel up the next weapon and wheel down the previous", () => {
    expect(steps([-100])).toBe(1);
    expect(steps([100])).toBe(-1);
  });

  it("counts line and page units", () => {
    expect(steps([-3, 1])).toBe(1);
    expect(steps([1, 2])).toBe(-1);
  });

  it("adds small trackpad movements up to a step", () => {
    const small = WHEEL_STEP / 5;
    expect(steps(...Array.from({ length: 4 }, (): [number] => [-small]))).toBe(0);
    expect(steps(...Array.from({ length: 5 }, (): [number] => [-small]))).toBe(1);
  });

  it("empties on take", () => {
    const wheel = new WheelSteps();
    wheel.add(-100);
    expect(wheel.take()).toBe(1);
    expect(wheel.take()).toBe(0);
  });
});

describe("cycleSlot", () => {
  it("steps through the slots in order, wrapping around both ways", () => {
    expect(cycleSlot([1, 2], 1, 1)).toBe(2);
    expect(cycleSlot([1, 2], 2, 1)).toBe(1);
    expect(cycleSlot([1, 2], 1, -1)).toBe(2);
    expect(cycleSlot([1, 3, 7], 3, 5)).toBe(1);
    expect(cycleSlot([1, 3, 7], 3, -4)).toBe(1);
  });

  it("starts from the ends for a slot the player doesn't have, and gives 0 with no weapons", () => {
    expect(cycleSlot([2, 4], 9, 1)).toBe(2);
    expect(cycleSlot([2, 4], 9, -1)).toBe(4);
    expect(cycleSlot([], 1, 1)).toBe(0);
  });
});
