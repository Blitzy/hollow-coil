import { describe, expect, it } from "vitest";
import { BUTTON_ATTACK, BUTTON_JUMP } from "@mandreljs/sim/input";
import { buildCommand, MAX_PITCH, type HeldInput } from "../../src/game/command.ts";
import { FixedStep } from "../../src/game/fixed-step.ts";
import { lockPointer } from "../../src/game/input.ts";

describe("lockPointer", () => {
  /** A stand-in element that records each pointer lock request, rejecting raw input if unsupported. */
  const fakeElement = (rawSupported: boolean) => {
    const calls: (PointerLockOptions | undefined)[] = [];
    return {
      calls,
      requestPointerLock: (options?: PointerLockOptions): Promise<void> => {
        calls.push(options);
        return options?.unadjustedMovement && !rawSupported ? Promise.reject(new DOMException("no raw input", "NotSupportedError")) : Promise.resolve();
      },
    };
  };

  it("asks for raw mouse input", async () => {
    const element = fakeElement(true);
    expect(await lockPointer(element)).toBe(true);
    expect(element.calls).toEqual([{ unadjustedMovement: true }]);
  });

  it("uses ordinary pointer lock when raw input isn't wanted", async () => {
    const element = fakeElement(true);
    expect(await lockPointer(element, false)).toBe(false);
    expect(element.calls).toEqual([undefined]);
  });

  it("falls back to ordinary pointer lock where raw input isn't supported", async () => {
    const element = fakeElement(false);
    expect(await lockPointer(element)).toBe(false);
    expect(element.calls).toEqual([{ unadjustedMovement: true }, undefined]);
  });
});

const idle: HeldInput = { yaw: 0, pitch: 0, forward: false, back: false, left: false, right: false, jump: false, attack: false, weapon: 0 };

describe("buildCommand", () => {
  it("quantizes view angles to 65536 units per turn", () => {
    expect(buildCommand({ ...idle, yaw: Math.PI / 2 }).yaw).toBe(16384);
    expect(buildCommand({ ...idle, yaw: -Math.PI / 2 }).yaw).toBe(49152); // wrapped into 0..65535
    expect(buildCommand({ ...idle, yaw: 4 * Math.PI }).yaw).toBe(0);
    expect(buildCommand({ ...idle, pitch: Math.PI / 4 }).pitch).toBe(8192);
  });

  it("clamps pitch short of straight up and down", () => {
    expect(buildCommand({ ...idle, pitch: 3 }).pitch).toBe(Math.round((MAX_PITCH * 65536) / (2 * Math.PI)));
  });

  it("maps keys to movement, with opposite keys cancelling", () => {
    expect(buildCommand({ ...idle, forward: true, right: true })).toMatchObject({ forward: 127, side: 127 });
    expect(buildCommand({ ...idle, back: true, left: true })).toMatchObject({ forward: -127, side: -127 });
    expect(buildCommand({ ...idle, forward: true, back: true }).forward).toBe(0);
  });

  it("sets buttons and passes the weapon slot through", () => {
    expect(buildCommand({ ...idle, jump: true, attack: true, weapon: 2 })).toMatchObject({ buttons: BUTTON_JUMP | BUTTON_ATTACK, weapon: 2 });
  });
});

describe("FixedStep", () => {
  it("runs one tick per 1/rate seconds and carries the remainder", () => {
    const step = new FixedStep(60);
    expect(step.advance(1 / 120)).toBe(0);
    expect(step.alpha).toBeCloseTo(0.5, 10);
    expect(step.advance(1 / 120)).toBe(1);
    expect(step.advance(0.1)).toBe(6);
  });

  it("averages to the tick rate at any frame rate", () => {
    for (const fps of [30, 59.94, 144, 240]) {
      const step = new FixedStep(60);
      let ticks = 0;
      for (let i = 0; i < fps * 10; i++) ticks += step.advance(1 / fps);
      expect(Math.abs(ticks - 600)).toBeLessThanOrEqual(1);
    }
  });

  it("limits catch-up after a long stall", () => {
    const step = new FixedStep(60, 0.25);
    expect(step.advance(5)).toBe(15);
  });

  it("runs time at a speed, capping the real time before scaling it", () => {
    const step = new FixedStep(60, 0.25);
    expect(step.advance(0.1, 4)).toBe(24);
    expect(step.elapsed).toBeCloseTo(0.4, 10);
    expect(step.advance(0.2, 4)).toBe(48); // a slow frame still plays at 4x
    expect(step.advance(5, 4)).toBe(60); // a stall catches up 0.25 real seconds' worth
    expect(step.advance(1, 0)).toBe(0); // paused
    expect(step.elapsed).toBe(0);
  });
});
