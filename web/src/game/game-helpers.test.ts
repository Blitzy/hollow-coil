import { describe, expect, it } from "vitest";
import { BUTTON_ATTACK, BUTTON_JUMP } from "../sim/input";
import { buildCommand, MAX_PITCH, type HeldInput } from "./command";
import { FixedStep } from "./fixed-step";

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
});
