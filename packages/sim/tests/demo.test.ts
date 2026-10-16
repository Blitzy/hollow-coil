import { describe, expect, it } from "vitest";
import { loadSimConfig, readRepoFile } from "@mandreljs/tools/testing";
import { TICK_RATE } from "@mandreljs/sim/constants";
import {
  contentChanges,
  contentHashes,
  DEMO_FORMAT,
  DEMO_VERSION,
  DemoError,
  DemoRecorder,
  demoCommands,
  differences,
  formatDemo,
  KEYFRAME_SECONDS,
  rebaselineDemo,
  replayDemo,
  upgradeDemo,
  type Demo,
  type DemoHeader,
} from "@mandreljs/sim/demo";
import { BUTTON_ATTACK, BUTTON_JUMP, NEUTRAL_COMMAND, wrapYaw, type InputCommand } from "@mandreljs/sim/input";
import { levelFromMap } from "@mandreljs/sim/level";
import { simContext, startLevel, step } from "@mandreljs/sim/sim";

const config = loadSimConfig();
const level = levelFromMap(readRepoFile("example/maps/test_movement.map"));
const header: DemoHeader = { game: "Mandrel.js Example", map: "test_movement", level: "map", seed: 0, engine: "0.0.1", content: contentHashes(level, config) };

/** A few seconds of play: walking, turning left past yaw 0 and back, a jump, and fire. */
function inputs(ticks: number): InputCommand[] {
  return Array.from({ length: ticks }, (_, i) => ({
    yaw: wrapYaw(i < 120 ? -i * 40 : -120 * 40 + (i - 120) * 25),
    pitch: i < 60 ? 0 : Math.min(800, (i - 60) * 10),
    forward: i < 200 ? 127 : 0,
    side: i >= 150 && i < 180 ? -127 : 0,
    buttons: (i >= 90 && i < 100 ? BUTTON_JUMP : 0) | (i >= 130 && i < 132 ? BUTTON_ATTACK : 0),
    weapon: i === 40 ? 2 : 0,
  }));
}

/** Plays commands from the level's start, recording a demo. */
function record(commands: readonly InputCommand[]): Demo {
  const ctx = simContext(level, config);
  let state = startLevel(level, config, header.seed);
  const recorder = new DemoRecorder(header, state);
  for (const cmd of commands) {
    state = step(state, cmd, ctx).state;
    recorder.record(cmd, state);
  }
  return recorder.finish();
}

/** A demo as a file would give it back. */
const reread = (demo: Demo): Demo => upgradeDemo(JSON.parse(formatDemo(demo)));

describe("demos", () => {
  const commands = inputs(5 * TICK_RATE + 37);
  const demo = record(commands);

  it("give back exactly the commands they recorded", () => {
    expect(demoCommands(reread(demo))).toEqual(commands);
  });

  it("replay to the same states, tick for tick", () => {
    const replay = replayDemo(reread(demo), level, config);
    expect(replay.divergence).toBeNull();
    expect(replay.states).toHaveLength(commands.length + 1);
  });

  it("say what they are, and when", () => {
    expect(demo).toMatchObject({ format: DEMO_FORMAT, version: DEMO_VERSION, tick_rate: TICK_RATE, ticks: commands.length, actions: [] });
    expect(demo.hashes).toHaveLength((commands.length + 1) * 8);
    // Keyframes every few seconds from the start, and the last tick.
    expect(demo.keyframes.map((k) => k.tick)).toEqual([0, KEYFRAME_SECONDS * TICK_RATE, commands.length]);
  });

  it("store held inputs and a steadily turning view compactly", () => {
    const still = record(Array.from({ length: 60 * TICK_RATE }, () => ({ ...NEUTRAL_COMMAND, forward: 127, yaw: 100 })));
    for (const column of Object.values(still.commands)) expect(column.runs.length).toBeLessThanOrEqual(4);
    expect(demo.commands.yaw!.runs.length).toBeLessThanOrEqual(6); // two steady turns: a few runs, not one per tick
  });

  it("read a missing input as its neutral value, as an engine before that input played it", () => {
    const { weapon: _weapon, ...older } = demo.commands;
    const commandsWithout = demoCommands({ ...demo, commands: older });
    expect(commandsWithout.every((c) => c.weapon === 0)).toBe(true);
    expect(commandsWithout.map((c) => c.yaw)).toEqual(commands.map((c) => c.yaw));
  });

  it("refuse inputs, actions, and versions from a newer engine, saying so", () => {
    const newer = { ...demo, commands: { ...demo.commands, crouch: { encoding: "runs" as const, runs: [0, commands.length] } } };
    expect(() => demoCommands(newer)).toThrow(/doesn't know, "crouch": it was recorded by a newer engine/);
    expect(() => demoCommands({ ...demo, actions: [{ tick: 3, type: "change_level" }] })).toThrow(/"change_level" at tick 3/);
    expect(() => upgradeDemo({ ...demo, version: DEMO_VERSION + 1 })).toThrow(/recorded by a newer engine/);
  });

  it("refuse files that aren't demos or are damaged", () => {
    expect(() => upgradeDemo({ format: "something-else" })).toThrow(DemoError);
    expect(() => upgradeDemo({ ...demo, hashes: undefined })).toThrow(/no "hashes"/);
    const short = { ...demo, commands: { ...demo.commands, side: { encoding: "runs" as const, runs: [0, 5] } } };
    expect(() => demoCommands(short)).toThrow(/"side" has 5 ticks/);
    const odd = { ...demo, commands: { ...demo.commands, side: { encoding: "zip" as never, runs: [] } } };
    expect(() => demoCommands(odd)).toThrow(/unknown encoding/);
  });

  const faster = { ...config, player: { ...config.player, movement: { ...config.player.movement, max_ground_speed: 400 } } };

  it("say which content changed since they were recorded", () => {
    expect(contentChanges(demo, level, config)).toEqual([]);
    expect(contentChanges(demo, level, faster)).toEqual(["player"]);
    const tougher = { ...config, enemies: JSON.parse(JSON.stringify(config.enemies).replace('"health":40', '"health":50')) as typeof config.enemies };
    expect(contentChanges(demo, level, tougher)).toEqual(["enemies"]);
    const moved = { ...level, entities: level.entities.map((e) => (e.classname === "info_player_start" ? { ...e, origin: "0 0 64" } : e)) };
    expect(contentChanges(demo, moved, config)).toEqual(["map"]);
  });

  it("ignore content that doesn't change play: lighting, worldspawn's settings, and $schema", () => {
    const relit = { ...level, entities: level.entities.map((e, i) => (i === 0 ? { ...e, _sunlight: "200" } : e.classname === "light" ? { ...e, light: "999" } : e)) };
    expect(relit.entities.some((e) => e.classname === "light")).toBe(true);
    expect(contentChanges(demo, relit, config)).toEqual([]);
    const { $schema: _schema, ...player } = config.player as typeof config.player & { $schema?: string };
    expect(contentChanges(demo, level, { ...config, player })).toEqual([]);
  });

  it("don't check content they have no hash for, such as data a newer engine adds", () => {
    const { enemies: _enemies, ...older } = demo.content;
    const tougher = { ...config, enemies: { ...config.enemies, extra: 1 } as typeof config.enemies };
    expect(contentChanges({ ...demo, content: older }, level, tougher)).toEqual([]);
  });

  it("find the first tick that differs, and say what differs", () => {
    // The same inputs with different data: the player runs faster from the first tick on.
    const replay = replayDemo(demo, level, faster);
    expect(replay.divergence).not.toBeNull();
    expect(replay.divergence!.tick).toBeGreaterThan(0);
    expect(replay.divergence!.differences.some((line) => line.startsWith("player.origin"))).toBe(true);
  });

  it("can be rebaselined from their inputs when behavior or content changes on purpose", () => {
    const fresh = rebaselineDemo(demo, level, faster); // new data: same inputs, new results
    expect(contentChanges(fresh, level, faster)).toEqual([]);
    expect(replayDemo(fresh, level, faster).divergence).toBeNull();
    expect(demoCommands(fresh)).toEqual(commands);
    expect(fresh.hashes).not.toBe(demo.hashes);
  });

  it("write one line per header field and input column", () => {
    const text = formatDemo(demo);
    expect(text.split("\n").filter((line) => line.startsWith('    "') && line.includes('"encoding"'))).toHaveLength(6);
    expect(text).not.toContain("undefined");
    expect(formatDemo(reread(demo))).toBe(text);
  });
});

describe("differences", () => {
  it("lists the paths that differ, recorded then replayed", () => {
    expect(differences({ a: { x: 1, y: 2 }, b: [1, 2] }, { a: { x: 1, y: 3 }, b: [1, 4] })).toEqual(["a.y: 2 -> 3", "b[1]: 2 -> 4"]);
    expect(differences({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it("stops after a few", () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
    expect(differences(many, {}, 5)).toHaveLength(5);
  });
});
