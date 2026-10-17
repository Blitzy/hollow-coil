import { describe, expect, it } from "vitest";
import { loadSimConfig, readRepoFile } from "@mandreljs/tools/testing";
import { TICK_RATE } from "@mandreljs/sim/constants";
import { contentHashes, DemoError, DemoRecorder, KEYFRAME_SECONDS, type Demo, type DemoHeader } from "@mandreljs/sim/demo";
import { BUTTON_ATTACK, wrapYaw, type InputCommand } from "@mandreljs/sim/input";
import { levelFromMap } from "@mandreljs/sim/level";
import { simContext, startLevel, step, type SimConfig, type SimState } from "@mandreljs/sim/sim";
import { DemoPlayback, lerpYaw, PLAYBACK_SPEEDS, placeDemo, speedLabel, type PageLevel } from "../../src/game/demo-playback.ts";

const config = loadSimConfig();
const level = levelFromMap(readRepoFile("example/maps/test_movement.map"));
const header: DemoHeader = { game: "Mandrel.js Example", map: "test_movement", level: "map", seed: 0, content: contentHashes(level, config) };

/** Walking forward while turning, firing now and then, for a little over one keyframe's worth of seconds. */
const commands: InputCommand[] = Array.from({ length: KEYFRAME_SECONDS * TICK_RATE + 40 }, (_, i) => ({
  yaw: wrapYaw(-i * 30),
  pitch: 0,
  forward: 127,
  side: 0,
  buttons: i % 60 === 10 ? BUTTON_ATTACK : 0,
  weapon: 0,
}));

/** Plays the commands from the level's start, recording a demo and every state. */
function record(): { demo: Demo; states: SimState[] } {
  const ctx = simContext(level, config);
  const states = [startLevel(level, config, header.seed)];
  const recorder = new DemoRecorder(header, states[0]!);
  for (const cmd of commands) {
    states.push(step(states.at(-1)!, cmd, ctx).state);
    recorder.record(cmd, states.at(-1)!);
  }
  return { demo: recorder.finish(), states };
}

const { demo, states } = record();

/** Steps a playback to its end, returning every state it passed through. */
function playToEnd(playback: DemoPlayback): SimState[] {
  const seen = [playback.state];
  for (let result = playback.step(); result !== null; result = playback.step()) seen.push(result.state);
  return seen;
}

describe("DemoPlayback", () => {
  it("plays the recorded game tick by tick, and every tick matches the recording", () => {
    const playback = new DemoPlayback(demo, level, config);
    expect(playback.paused).toBe(false);
    expect(playback.changes).toEqual([]);
    expect(playToEnd(playback)).toEqual(states);
    expect(playback.finished).toBe(true);
    expect(playback.divergedAt).toBeNull();
    expect(playback.differences).toBeNull();
  });

  it("gives each tick's events, for presenting it as in play", () => {
    const playback = new DemoPlayback(demo, level, config);
    const fired = Array.from({ length: 11 }, () => playback.step()!).flatMap((r) => r.events).filter((e) => e.type === "fired");
    expect(fired).toHaveLength(1); // the attack pressed on the 11th tick
  });

  it("says how far into the demo it is", () => {
    const playback = new DemoPlayback(demo, level, config);
    expect(playback.length).toBe(commands.length / TICK_RATE);
    for (let i = 0; i < TICK_RATE / 2; i++) playback.step();
    expect(playback.seconds).toBe(0.5);
  });

  it("scales time by its speed, from 1/4x to 4x, starting at 1x", () => {
    const playback = new DemoPlayback(demo, level, config);
    expect(playback.scale(1)).toBe(1);
    for (let i = 0; i < 10; i++) playback.faster();
    expect(playback.speed).toBe(4);
    expect(playback.scale(0.5)).toBe(2);
    for (let i = 0; i < 10; i++) playback.slower();
    expect(playback.speed).toBe(0.25);
    expect(PLAYBACK_SPEEDS[0]).toBe(0.25);
  });

  it("lets no time pass while paused or after the end", () => {
    const playback = new DemoPlayback(demo, level, config);
    playback.togglePause();
    expect(playback.scale(1)).toBe(0);
    playback.togglePause();
    playToEnd(playback);
    expect(playback.scale(1)).toBe(0);
  });

  it("plays again from the start when unpaused at the end", () => {
    const playback = new DemoPlayback(demo, level, config);
    playToEnd(playback);
    playback.togglePause();
    expect(playback.state).toEqual(states[0]);
    expect(playback.paused).toBe(false);
    expect(playback.finished).toBe(false);
  });

  it("starts paused, naming what changed, on content that changed since the demo was recorded", () => {
    const faster: SimConfig = { ...config, player: { ...config.player, movement: { ...config.player.movement, max_ground_speed: 400 } } };
    const playback = new DemoPlayback(demo, level, faster);
    expect(playback.changes).toEqual(["player"]);
    expect(playback.paused).toBe(true);
  });

  it("flags the first tick that differs from the recording, and what differs at the keyframe after it", () => {
    const faster: SimConfig = { ...config, player: { ...config.player, movement: { ...config.player.movement, max_ground_speed: 400 } } };
    const playback = new DemoPlayback(demo, level, faster);
    for (let i = 0; i < 20; i++) playback.step();
    const diverged = playback.divergedAt;
    expect(diverged).not.toBeNull();
    expect(diverged!).toBeGreaterThan(0); // the start is the same; walking faster isn't
    expect(playback.differences).toBeNull(); // not at a keyframe yet
    playToEnd(playback);
    expect(playback.divergedAt).toBe(diverged);
    expect(playback.differences?.tick).toBe(KEYFRAME_SECONDS * TICK_RATE);
    expect(playback.differences!.lines.some((line) => line.startsWith("player.origin"))).toBe(true);
  });

  it("flags a level whose start differs at tick 0", () => {
    const moved = { ...demo, hashes: `00000000${demo.hashes.slice(8)}` };
    expect(new DemoPlayback(moved, level, config).divergedAt).toBe(0);
  });

  it("refuses a demo recorded at another tick rate, or with hashes missing", () => {
    expect(() => new DemoPlayback({ ...demo, tick_rate: 35 }, level, config)).toThrow(DemoError);
    expect(() => new DemoPlayback({ ...demo, hashes: demo.hashes.slice(8) }, level, config)).toThrow(DemoError);
  });
});

describe("placeDemo", () => {
  const page: PageLevel = { game: "Mandrel.js Example", map: "greybox_01", level: "bsp", lightingOff: false, note: "" };
  const recorded = { game: "Mandrel.js Example", map: "greybox_01", level: "bsp" } as const;

  it("plays here on the map and level file it was recorded on", () => {
    expect(placeDemo(recorded, page, "", false)).toEqual({ kind: "here" });
  });

  it("reloads on the demo's map, keeping other options", () => {
    expect(placeDemo({ ...recorded, map: "test_combat" }, page, "?game=example&brightness=2", false)).toEqual({ kind: "reload", search: "?game=example&brightness=2&map=test_combat" });
  });

  it("reloads on the .map for a demo recorded unlit, and on the .bsp for one recorded lit", () => {
    expect(placeDemo({ ...recorded, level: "map" }, page, "?map=greybox_01", false)).toEqual({ kind: "reload", search: "?map=greybox_01&lighting=off" });
    const unlit: PageLevel = { ...page, level: "map", lightingOff: true };
    expect(placeDemo(recorded, unlit, "?map=greybox_01&lighting=off", false)).toEqual({ kind: "reload", search: "?map=greybox_01" });
  });

  it("can't play a lit demo when the .bsp didn't load, rather than reloading again", () => {
    const failed: PageLevel = { ...page, level: "map", note: "unlit (ericw-tools not installed)" };
    expect(placeDemo(recorded, failed, "", false)).toEqual({ kind: "unplayable", reason: "it was recorded on greybox_01.bsp, which didn't load: unlit (ericw-tools not installed)" });
  });

  it("doesn't reload twice for the same demo", () => {
    expect(placeDemo({ ...recorded, map: "test_combat" }, page, "", true).kind).toBe("unplayable");
  });

  it("can't play a demo from another game", () => {
    expect(placeDemo({ ...recorded, game: "Another Game" }, page, "", false)).toEqual({ kind: "unplayable", reason: "it was recorded in Another Game, and this is Mandrel.js Example" });
  });
});

describe("lerpYaw", () => {
  const units = (radians: number): number => (radians * 65536) / (2 * Math.PI);

  it("eases between two yaws", () => {
    expect(units(lerpYaw(1000, 2000, 0.25))).toBeCloseTo(1250);
  });

  it("goes the short way round past yaw 0", () => {
    expect(units(lerpYaw(65000, 500, 0.5))).toBeCloseTo(65518);
    expect(units(lerpYaw(500, 65000, 0.5))).toBeCloseTo(-18);
  });
});

describe("speedLabel", () => {
  it("shows slow speeds as fractions", () => {
    expect(PLAYBACK_SPEEDS.map(speedLabel)).toEqual(["1/4x", "1/2x", "1x", "2x", "4x"]);
  });
});
