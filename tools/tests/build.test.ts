// What mandreljs build writes, from a copy of the example game and a stand-in
// client, so the test needs neither Vite nor ericw-tools and writes nothing in the repo.

import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { engineInfo, gameNotices, main, releaseNotice, writeRelease } from "../src/build.ts";
import { EXAMPLE_GAME } from "../src/layout.ts";

describe("build", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** A copy of the example game with stand-in compiled maps, and a stand-in client. */
  const setup = (): { game: string; client: string } => {
    const dir = mkdtempSync(join(tmpdir(), "mandreljs-build-"));
    dirs.push(dir);
    const game = join(dir, "mygame");
    for (const folder of ["data", "textures", "trenchbroom"]) cpSync(join(EXAMPLE_GAME, folder), join(game, folder), { recursive: true, filter: (src) => !lstatSync(src).isSymbolicLink() });
    mkdirSync(join(game, "maps"));
    mkdirSync(join(game, "build"));
    for (const map of ["greybox_01", "test_movement"]) {
      cpSync(join(EXAMPLE_GAME, "maps", `${map}.map`), join(game, "maps", `${map}.map`));
      writeFileSync(join(game, "build", `${map}.bsp`), "IBSP");
      writeFileSync(join(game, "build", `${map}.log`), "compiler log");
    }
    const client = join(dir, "client");
    mkdirSync(join(client, "assets"), { recursive: true });
    writeFileSync(join(client, "index.html"), "<!doctype html>");
    writeFileSync(join(client, "assets", "main.js"), "");
    return { game, client };
  };

  it("writes the client, the game's index, data, textures, and compiled maps, and nothing else", () => {
    const { game, client } = setup();
    const out = join(game, "dist");
    const wrote = writeRelease(game, client, out);
    expect(readdirSync(out).sort()).toEqual(["LICENSE", "LICENSE-EXCEPTION.md", "NOTICE.md", "assets", "games", "index.html"]);
    expect(readFileSync(join(out, "NOTICE.md"), "utf-8")).toContain("Mandrel.js Example runs on Mandrel.js");
    expect(JSON.parse(readFileSync(join(out, "games", "index.json"), "utf-8"))).toEqual({ default: "mygame", games: ["mygame"] });
    expect(readdirSync(join(out, "games", "mygame")).sort()).toEqual(["build", "data", "textures"]);
    expect(readdirSync(join(out, "games", "mygame", "build")).sort()).toEqual(["greybox_01.bsp", "test_movement.bsp"]); // no logs or .map sources
    expect(readdirSync(join(out, "games", "mygame", "data")).sort()).toEqual(["enemies.json", "game.json", "player.json", "weapons.json"]);
    expect(existsSync(join(out, "games", "mygame", "textures", "dev", "grid_grey.png"))).toBe(true);
    expect(wrote).toMatchObject({ maps: 2, data: 4, textures: 13 });
    expect(wrote.bytes).toBeGreaterThan(0);
  });

  it("says what's the engine's (its license and source) and what's the game's", () => {
    const notice = releaseNotice("My Game", { version: "1.2.3", source: "https://example.com/engine" });
    expect(notice).toContain("My Game runs on Mandrel.js 1.2.3");
    expect(notice).toContain("GNU General Public License v3.0 or later");
    expect(notice).toContain("Its source code is at https://example.com/engine (version 1.2.3).");
    expect(notice).toContain("THIRD-PARTY-NOTICES.txt");
    expect(notice).toContain("is by the authors of My Game, under their own terms");
  });

  it("carries the game's own notices with its content, and points to them", () => {
    const { game, client } = setup();
    writeFileSync(join(game, "LICENSE.md"), "CC BY 4.0");
    writeFileSync(join(game, "CREDITS.txt"), "textures by someone");
    writeFileSync(join(game, "README.md"), "not a notice");
    expect(gameNotices(game)).toEqual(["CREDITS.txt", "LICENSE.md"]);
    const out = join(game, "dist");
    writeRelease(game, client, out);
    expect(readFileSync(join(out, "games", "mygame", "LICENSE.md"), "utf-8")).toBe("CC BY 4.0");
    expect(existsSync(join(out, "games", "mygame", "README.md"))).toBe(false);
    expect(readFileSync(join(out, "NOTICE.md"), "utf-8")).toContain("under their own terms: see `games/mygame/CREDITS.txt` and `games/mygame/LICENSE.md`.");
  });

  it("finds the example game's license, which credits its CC BY content", () => {
    expect(gameNotices(EXAMPLE_GAME)).toEqual(["LICENSE.md"]);
    expect(readFileSync(join(EXAMPLE_GAME, "LICENSE.md"), "utf-8")).toContain("licensed under CC BY 4.0");
  });

  it("finds the engine's version and source in its package.json", () => {
    const { version, source } = engineInfo();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
    expect(source).toBe("https://github.com/mandreljs/mandrel.js");
  });

  it("replaces an earlier release", () => {
    const { game, client } = setup();
    const out = join(game, "dist");
    mkdirSync(out);
    writeFileSync(join(out, "stale.txt"), "from an old build");
    writeRelease(game, client, out);
    expect(existsSync(join(out, "stale.txt"))).toBe(false);
  });

  it("stops before building anything when the game doesn't validate", async () => {
    const { game } = setup();
    writeFileSync(join(game, "data", "player.json"), "{ not json");
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));
    expect(await main(["--game", game])).toBe(1);
    expect(lines.join("\n")).toContain("build stopped");
    expect(existsSync(join(game, "dist"))).toBe(false);
  });

  it("rejects an unknown lighting mode", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await main(["--mode", "best"])).toBe(2);
  });
});
