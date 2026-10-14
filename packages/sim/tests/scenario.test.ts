import { describe, expect, it } from "vitest";
import { BUTTON_ATTACK, BUTTON_JUMP, degreesToUnits } from "@hollow-coil/sim/input";
import { scenarioCommands, secondsToTicks, type Scenario } from "@hollow-coil/sim/scenario";

const base: Scenario = {
  description: "test",
  status: "unverified",
  map: "test_movement",
  duration: 0.5,
  start: { marker: "course_start", yaw: 90 },
  inputs: [{ until: 0.1, forward: 127 }],
  expect: [{ at: 0.5, on_ground: true }],
};

describe("conversion rules (spec/README.md)", () => {
  it("rounds seconds to the nearest tick", () => {
    expect(secondsToTicks(0.1)).toBe(6);
    expect(secondsToTicks(4.45)).toBe(267); // 4.45 * 60 is 267.00000000000003 in floating point
    expect(secondsToTicks(1 / 120)).toBe(1); // exactly half a tick rounds up
  });

  it("converts degrees to angle units", () => {
    expect(degreesToUnits(90)).toBe(16384);
    expect(degreesToUnits(-45)).toBe(-8192);
    expect(degreesToUnits(1)).toBe(182); // 182.04 rounds down
  });
});

describe("scenarioCommands", () => {
  it("holds each segment's inputs over its ticks, then goes neutral with the view held", () => {
    const commands = scenarioCommands(base);
    expect(commands).toHaveLength(30);
    expect(commands.slice(0, 6).every((c) => c.forward === 127 && c.yaw === 16384)).toBe(true);
    expect(commands[6]).toEqual({ yaw: 16384, pitch: 0, forward: 0, side: 0, buttons: 0, weapon: 0 });
  });

  it("carries view angles between segments but resets everything else", () => {
    const commands = scenarioCommands({
      ...base,
      inputs: [
        { until: 0.1, yaw: 180, pitch: 10, jump: true, attack: true, side: -127, weapon: 2 },
        { until: 0.2, forward: 50 },
      ],
    });
    expect(commands[0]).toEqual({ yaw: 32768, pitch: 1820, forward: 0, side: -127, buttons: BUTTON_JUMP | BUTTON_ATTACK, weapon: 2 });
    expect(commands[6]).toEqual({ yaw: 32768, pitch: 1820, forward: 50, side: 0, buttons: 0, weapon: 0 });
  });

  it("wraps yaw into 0..65535", () => {
    expect(scenarioCommands({ ...base, start: { marker: "course_start", yaw: 359.999 } })[0]!.yaw).toBe(0);
  });
});
