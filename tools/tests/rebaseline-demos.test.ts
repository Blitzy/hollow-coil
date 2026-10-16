import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contentHashes, DemoRecorder, formatDemo, replayDemo, upgradeDemo, type Demo } from "@mandreljs/sim/demo";
import { NEUTRAL_COMMAND } from "@mandreljs/sim/input";
import { levelFromMap } from "@mandreljs/sim/level";
import { simContext, startLevel, step } from "@mandreljs/sim/sim";
import { demoFiles, main } from "../src/rebaseline-demos.ts";
import { repoPath } from "../src/layout.ts";
import { loadSimConfig, readRepoFile } from "../src/testing.ts";

const config = loadSimConfig();
const level = levelFromMap(readRepoFile("example/maps/test_movement.map"));

/** Two seconds of walking forward on test_movement, recorded on its .map. */
function walk(): Demo {
  const ctx = simContext(level, config);
  let state = startLevel(level, config);
  const recorder = new DemoRecorder({ game: "Mandrel.js Example", map: "test_movement", level: "map", seed: 0, content: contentHashes(level, config) }, state);
  for (let i = 0; i < 120; i++) {
    const cmd = { ...NEUTRAL_COMMAND, forward: 127 };
    state = step(state, cmd, ctx).state;
    recorder.record(cmd, state);
  }
  return recorder.finish();
}

describe("rebaseline-demos", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const tempFile = (name: string, text: string): string => {
    const dir = mkdtempSync(join(tmpdir(), "mandreljs-rebaseline-"));
    dirs.push(dir);
    const file = join(dir, name);
    writeFileSync(file, text);
    return file;
  };
  const quiet = (): string[] => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));
    return lines;
  };

  it("makes a stale demo's hashes and keyframes again from its inputs", async () => {
    const demo = walk();
    const stale = { ...demo, hashes: demo.hashes.slice(0, 80) + "00000000" + demo.hashes.slice(88) }; // tick 10 recorded wrong
    const file = tempFile("walk.demo.json", formatDemo(stale));
    const lines = quiet();
    expect(await main([file])).toBe(0);
    expect(lines.join("\n")).toContain("first differed at tick 10");
    const fixed = upgradeDemo(JSON.parse(readFileSync(file, "utf-8")));
    expect(replayDemo(fixed, level, config).divergence).toBeNull();
    expect(fixed.commands).toEqual(demo.commands);
  });

  it("updates the content hashes of a demo whose content changed, and says to check it", async () => {
    const demo = walk();
    const file = tempFile("walk.demo.json", formatDemo({ ...demo, content: { ...demo.content, enemies: "00000000" } }));
    const lines = quiet();
    expect(await main([file])).toBe(0);
    expect(lines.join("\n")).toContain("content changed (enemies): play it back to check it still does what it should; plays the same");
    expect(upgradeDemo(JSON.parse(readFileSync(file, "utf-8"))).content).toEqual(demo.content);
  });

  it("leaves a demo that still replays alone", async () => {
    const text = formatDemo(walk());
    const file = tempFile("walk.demo.json", text);
    const lines = quiet();
    expect(await main([file])).toBe(0);
    expect(lines.join("\n")).toContain("unchanged");
    expect(readFileSync(file, "utf-8")).toBe(text);
  });

  it("reports a file it can't read", async () => {
    const file = tempFile("broken.demo.json", "{}");
    const lines = quiet();
    expect(await main([file])).toBe(1);
    expect(lines.join("\n")).toContain("FAIL");
  });

  it("finds demos by name in demos/", () => {
    expect(demoFiles(["greybox_01.demo.json"])).toEqual([repoPath("demos", "greybox_01.demo.json")]);
  });
});
