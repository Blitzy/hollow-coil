// Runs the engine-neutral scenarios in /spec, following the conversion rules in
// spec/README.md. The caller loads the scenario JSON, the level, and the data.

import { TICK_RATE } from "./constants";
import { ANGLE_UNITS_PER_TURN, BUTTON_ATTACK, BUTTON_JUMP, NEUTRAL_COMMAND, type InputCommand } from "./input";
import type { Level } from "./level";
import { length, sub, type Vec3 } from "./math/vec3";
import { createSim, movementContext, step, type SimConfig, type SimState } from "./sim";

type Vec3OrNull = readonly [number | null, number | null, number | null];

export interface Scenario {
  readonly description: string;
  readonly status: "unverified" | "verified";
  readonly map: string;
  readonly seed?: number;
  readonly duration: number;
  readonly start: { readonly marker: string; readonly yaw: number; readonly pitch?: number };
  readonly inputs: readonly {
    readonly until: number;
    readonly yaw?: number;
    readonly pitch?: number;
    readonly forward?: number;
    readonly side?: number;
    readonly jump?: boolean;
    readonly attack?: boolean;
    readonly weapon?: number;
  }[];
  readonly expect: readonly {
    readonly at: number;
    readonly note?: string;
    readonly position?: Vec3OrNull;
    readonly velocity?: Vec3OrNull;
    readonly tolerance?: number;
    readonly on_ground?: boolean;
    readonly near_marker?: { readonly name: string; readonly within: number };
  }[];
}

export interface CheckResult {
  readonly at: number;
  readonly tick: number;
  readonly note: string | undefined;
  readonly passed: boolean;
  /** One line per failed check, with the expected and actual values. */
  readonly failures: readonly string[];
}

export interface ScenarioResult {
  readonly passed: boolean;
  readonly checks: readonly CheckResult[];
  /** State after every tick, starting with the spawn state (index = tick). */
  readonly states: readonly SimState[];
}

export const secondsToTicks = (seconds: number, tickRate = TICK_RATE): number => Math.floor(seconds * tickRate + 0.5);

export const degreesToUnits = (degrees: number): number => Math.floor((degrees * ANGLE_UNITS_PER_TURN) / 360 + 0.5);

const yawUnits = (degrees: number): number =>
  ((degreesToUnits(degrees) % ANGLE_UNITS_PER_TURN) + ANGLE_UNITS_PER_TURN) % ANGLE_UNITS_PER_TURN;

/** The input command for every tick of the scenario, by the segment rules in spec/README.md. */
export function scenarioCommands(scenario: Scenario, tickRate = TICK_RATE): InputCommand[] {
  const total = secondsToTicks(scenario.duration, tickRate);
  let yaw = yawUnits(scenario.start.yaw);
  let pitch = degreesToUnits(scenario.start.pitch ?? 0);
  const commands: InputCommand[] = [];
  let tick = 0;
  for (const segment of scenario.inputs) {
    if (segment.yaw !== undefined) yaw = yawUnits(segment.yaw);
    if (segment.pitch !== undefined) pitch = degreesToUnits(segment.pitch);
    const cmd: InputCommand = {
      yaw,
      pitch,
      forward: segment.forward ?? 0,
      side: segment.side ?? 0,
      buttons: (segment.jump ? BUTTON_JUMP : 0) | (segment.attack ? BUTTON_ATTACK : 0),
      weapon: segment.weapon ?? 0,
    };
    const end = Math.min(secondsToTicks(segment.until, tickRate), total);
    for (; tick < end; tick++) commands.push(cmd);
  }
  for (; tick < total; tick++) commands.push({ ...NEUTRAL_COMMAND, yaw, pitch });
  return commands;
}

function compare(label: string, expected: Vec3OrNull, actual: Vec3, tolerance: number, failures: string[]): void {
  const axes = [actual.x, actual.y, actual.z];
  expected.forEach((want, i) => {
    if (want === null) return;
    const got = axes[i]!;
    if (Math.abs(got - want) > tolerance) {
      failures.push(`${label}.${"xyz"[i]}: expected ${want} ± ${tolerance}, got ${got.toFixed(3)}`);
    }
  });
}

export function runScenario(scenario: Scenario, level: Level, config: SimConfig): ScenarioResult {
  const marker = level.markers.get(scenario.start.marker);
  if (!marker) throw new Error(`marker "${scenario.start.marker}" not found in ${scenario.map}`);

  const commands = scenarioCommands(scenario);
  const ctx = movementContext(level, config);
  const states: SimState[] = [
    createSim(config, { origin: marker, yaw: yawUnits(scenario.start.yaw), pitch: degreesToUnits(scenario.start.pitch ?? 0) }, scenario.seed ?? 0),
  ];
  for (const cmd of commands) states.push(step(states.at(-1)!, cmd, ctx).state);

  const checks = scenario.expect.map((e): CheckResult => {
    const tick = secondsToTicks(e.at);
    const p = states[tick]!.player;
    const failures: string[] = [];
    const tolerance = e.tolerance ?? 0;
    if (e.position) compare("position", e.position, p.origin, tolerance, failures);
    if (e.velocity) compare("velocity", e.velocity, p.velocity, tolerance, failures);
    if (e.on_ground !== undefined && p.onGround !== e.on_ground) {
      failures.push(`on_ground: expected ${e.on_ground}, got ${p.onGround}`);
    }
    if (e.near_marker) {
      const target = level.markers.get(e.near_marker.name);
      if (!target) throw new Error(`marker "${e.near_marker.name}" not found in ${scenario.map}`);
      const distance = length(sub(p.origin, target));
      if (distance > e.near_marker.within) {
        failures.push(`near_marker ${e.near_marker.name}: expected within ${e.near_marker.within}, got ${distance.toFixed(1)}`);
      }
    }
    return { at: e.at, tick, note: e.note, passed: failures.length === 0, failures };
  });
  return { passed: checks.every((c) => c.passed), checks, states };
}
