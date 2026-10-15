// Exercised in a temporary folder; never touches the real TrenchBroom settings.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gameLinkName, gamePathRow, install, InstallError, removeOldLink, report, trenchbroomGamePath, trenchbroomUserDir, uninstall } from "../src/install-trenchbroom.ts";
import { EXAMPLE_GAME } from "../src/layout.ts";

describe("install-trenchbroom", () => {
  const dirs: string[] = [];
  /** A temp folder with a target folder holding one file, and a link path under games/. */
  const setup = (): { target: string; other: string; link: string } => {
    const dir = mkdtempSync(join(tmpdir(), "mandreljs-tb-"));
    dirs.push(dir);
    const target = join(dir, "config");
    const other = join(dir, "other");
    mkdirSync(target);
    mkdirSync(other);
    writeFileSync(join(target, "GameConfig.cfg"), "config");
    return { target, other, link: join(dir, "TrenchBroom", "games", "MandrelJSExample") };
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("links the config folder, and does nothing the second time", () => {
    const { target, link } = setup();
    expect(install(link, target)).toBe("new");
    expect(readFileSync(join(link, "GameConfig.cfg"), "utf-8")).toBe("config");
    expect(install(link, target)).toBe("ok");
  });

  it("refuses to replace a link to somewhere else, or a real folder", () => {
    const { target, other, link } = setup();
    install(link, other);
    expect(() => install(link, target)).toThrow(/already links to/);
    uninstall(link);
    mkdirSync(link);
    expect(() => install(link, target)).toThrow(InstallError);
    expect(() => uninstall(link)).toThrow(/not a link; not touching it/);
  });

  it("removes only the link, never the files it points to", () => {
    const { target, link } = setup();
    install(link, target);
    expect(uninstall(link)).toBe("gone");
    expect(existsSync(link)).toBe(false);
    expect(readFileSync(join(target, "GameConfig.cfg"), "utf-8")).toBe("config");
    expect(uninstall(link)).toBe("skip");
  });

  it("removes an old-name link to the config, and nothing else", () => {
    const { target, other, link } = setup();
    const old = join(link, "..", "MandrelJS");
    install(old, target);
    expect(removeOldLink(old, target)).toBe(true);
    expect(existsSync(old)).toBe(false);
    expect(readFileSync(join(target, "GameConfig.cfg"), "utf-8")).toBe("config");
    expect(removeOldLink(old, target)).toBe(false);

    install(old, other);
    expect(removeOldLink(old, target)).toBe(false);
    expect(existsSync(old)).toBe(true);
    uninstall(old);
    mkdirSync(old);
    expect(removeOldLink(old, target)).toBe(false);
    expect(existsSync(old)).toBe(true);
  });

  it("names a game's link after its FGD, as TrenchBroom's own configs are", () => {
    expect(gameLinkName(join(EXAMPLE_GAME, "trenchbroom"))).toBe("MandrelJSExample");
    const { target } = setup();
    writeFileSync(join(target, "GameConfig.cfg"), '{\n  // My game\n  "name": "My Game",\n  "entities": { "definitions": [ "MyGame.fgd", "Extras.fgd" ] }\n}');
    expect(gameLinkName(target)).toBe("MyGame");
  });

  it("reads the game path TrenchBroom has for a game", () => {
    const { target: userDir } = setup();
    expect(trenchbroomGamePath(userDir, "My Game")).toBeNull(); // no preferences yet
    writeFileSync(join(userDir, "Preferences.json"), JSON.stringify({ "Games/My Game/Path": "C:\\games\\mygame", "Games/Quake/Path": "C:\\quake" }));
    expect(trenchbroomGamePath(userDir, "My Game")).toBe("C:\\games\\mygame");
    expect(trenchbroomGamePath(userDir, "Other")).toBeNull();
  });

  it("checks the game path is the game directory", () => {
    const game = join(tmpdir(), "mygame");
    expect(gamePathRow(game, game)).toEqual({ status: "ok", what: "game path", detail: game });
    expect(gamePathRow(game, null)).toEqual({ status: "todo", what: "game path", detail: "not set" });
    expect(gamePathRow(game, join(game, "trenchbroom")).detail).toBe(`${join(game, "trenchbroom")} (should be the folder holding maps/ and textures/)`);
  });

  it("reports each step in a column, and what's left to do", () => {
    const rows = [
      { status: "ok", what: "game config", detail: "TrenchBroom/games/MyGame -> mygame/trenchbroom" },
      { status: "todo", what: "game path", detail: "not set" },
    ] as const;
    expect(report("My Game", "C:\\mygame", rows).split("\n")).toEqual([
      "My Game in TrenchBroom",
      "",
      "  ok    game config  TrenchBroom/games/MyGame -> mygame/trenchbroom",
      "  todo  game path    not set",
      "",
      "To finish, in TrenchBroom open Preferences > Games > My Game and set the game path to:",
      "",
      "  C:\\mygame",
    ]);
    expect(report("My Game", "C:\\mygame", rows.slice(0, 1))).not.toContain("To finish");
  });

  it("knows where TrenchBroom keeps its games", () => {
    expect(trenchbroomUserDir()).toMatch(/TrenchBroom$/);
  });
});
