import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXAMPLE_GAME } from "../src/repo.ts";
import { gameFgd, main, readGameMap } from "../src/validate.ts";

describe("validate", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const run = (argv: string[] = []): { code: number; lines: string[] } => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));
    return { code: main(argv), lines };
  };
  /** A copy of the example game outside the repo, to break. */
  const copyOfExample = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "mandrel-validate-"));
    dirs.push(dir);
    const game = join(dir, "mygame");
    // Without textures (not checked), editor autosaves, or the engine link install-trenchbroom may have made.
    const skip = new Set(["textures", "autosave", "engine"]);
    cpSync(EXAMPLE_GAME, game, { recursive: true, filter: (src) => !skip.has(basename(src)) });
    return game;
  };

  it("passes the engine's data, the example game, and the scenarios, printing a line per file", () => {
    const { code, lines } = run();
    expect(code).toBe(0);
    expect(lines).toContain("ok    data/lightstyles.json");
    expect(lines).toContain("ok    example/data/game.json");
    expect(lines).toContain("ok    example/data/player.json");
    expect(lines).toContain("ok    spec/step_18_succeeds.json");
    expect(lines.at(-1)).toBe("ok    cross-file checks");
  });

  it("checks another game directory, without the scenarios", () => {
    const { code, lines } = run(["--game", copyOfExample()]);
    expect(code).toBe(0);
    expect(lines).toContain("skip  spec/ (scenarios run on the example game)");
    expect(lines.some((line) => line.includes("spec/step_18_succeeds.json"))).toBe(false);
  });

  it("fails a game whose enemy isn't in its FGD, or whose maps name another game", () => {
    const game = copyOfExample();
    const fgd = join(game, "trenchbroom", "MandrelJSExample.fgd");
    writeFileSync(fgd, readFileSync(fgd, "utf-8").replace("monster_shotgunner", "monster_grunt"));
    const map = join(game, "maps", "test_combat.map");
    writeFileSync(map, readFileSync(map, "utf-8").replace("// Game: Mandrel.js Example", "// Game: Quake"));
    const { code, lines } = run(["--game", game]);
    expect(code).toBe(1);
    expect(lines).toContain("FAIL  cross-file checks");
    expect(lines).toContain("        enemies.json: 'shotgunner' classname 'monster_shotgunner' is not defined in the FGD");
    expect(lines).toContain("        maps/test_combat.map: says // Game: Quake, but the game is 'Mandrel.js Example'");
  });

  it("reads a game's maps, or null for a missing one", () => {
    expect(readGameMap(EXAMPLE_GAME, "test_movement")).toContain("worldspawn");
    expect(readGameMap(EXAMPLE_GAME, "no_such_map")).toBeNull();
  });

  it("includes the engine's FGD without the link install-trenchbroom makes", () => {
    const { text, problems } = gameFgd(EXAMPLE_GAME, "MandrelJSExample.fgd");
    expect(problems).toEqual([]);
    expect(text).toContain("= info_player_start");
    expect(text).toContain("= monster_shotgunner");
    expect(gameFgd(EXAMPLE_GAME, "nope.fgd").problems).toEqual(["trenchbroom/nope.fgd: not found (named in trenchbroom/GameConfig.cfg)"]);
  });
});
