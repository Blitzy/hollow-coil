import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildDir, displayPath, EXAMPLE_GAME, findGame, GameNotFoundError, REPO_ROOT, toolsCacheDir } from "../src/layout.ts";

describe("layout", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  /** A folder outside the repo holding a game directory, mygame/. */
  const outside = (): { dir: string; game: string } => {
    const dir = mkdtempSync(join(tmpdir(), "mandrel-layout-"));
    dirs.push(dir);
    const game = join(dir, "mygame");
    mkdirSync(join(game, "data"), { recursive: true });
    writeFileSync(join(game, "data", "game.json"), "{}");
    return { dir, game };
  };

  it("works on the game the command runs in, wherever it is", () => {
    const { game } = outside();
    expect(findGame(undefined, game)).toBe(game);
  });

  it("takes --game relative to the folder the command runs in", () => {
    const { dir, game } = outside();
    expect(findGame("mygame", dir)).toBe(game);
    expect(findGame(game, REPO_ROOT)).toBe(game);
    expect(findGame("example", REPO_ROOT)).toBe(EXAMPLE_GAME);
  });

  it("falls back to the example game inside this repo", () => {
    expect(findGame(undefined, REPO_ROOT)).toBe(EXAMPLE_GAME);
    expect(findGame(undefined, join(REPO_ROOT, "tools"))).toBe(EXAMPLE_GAME);
  });

  it("refuses a folder that isn't a game", () => {
    const { dir } = outside();
    expect(() => findGame(undefined, dir)).toThrow(/run this in a game directory/);
    expect(() => findGame(".", dir)).toThrow(GameNotFoundError);
    expect(() => findGame("nope", dir)).toThrow(/has no data\/game.json/);
  });

  it("compiles a game's maps into its own build/", () => {
    const { game } = outside();
    expect(buildDir(game)).toBe(join(game, "build"));
  });

  it("keeps pinned tools in a per-user cache, not in a repo", () => {
    expect(toolsCacheDir()).toMatch(/mandreljs$/);
    expect(toolsCacheDir().startsWith(REPO_ROOT)).toBe(false);
  });

  it("shows paths relative to the folder the command runs in", () => {
    const { dir, game } = outside();
    expect(displayPath(join(game, "maps", "e1m1.map"), game)).toBe("maps/e1m1.map");
    expect(displayPath(join(game, "maps"), dir)).toBe("mygame/maps");
    expect(displayPath(dir, game)).toBe(dir); // outside it: absolute
  });
});
