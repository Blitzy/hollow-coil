// Exercised in a temporary folder; never touches the real TrenchBroom settings.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { install, InstallError, removeOldLink, trenchbroomUserDir, uninstall } from "../src/install-trenchbroom.ts";

describe("install-trenchbroom", () => {
  const dirs: string[] = [];
  /** A temp folder with a target folder holding one file, and a link path under games/. */
  const setup = (): { target: string; other: string; link: string } => {
    const dir = mkdtempSync(join(tmpdir(), "hc-tb-"));
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
    expect(install(link, target)).toMatch(/^installed: /);
    expect(readFileSync(join(link, "GameConfig.cfg"), "utf-8")).toBe("config");
    expect(install(link, target)).toMatch(/^already installed: /);
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
    expect(uninstall(link)).toMatch(/^removed: /);
    expect(existsSync(link)).toBe(false);
    expect(readFileSync(join(target, "GameConfig.cfg"), "utf-8")).toBe("config");
    expect(uninstall(link)).toMatch(/^not installed: /);
  });

  it("removes an old-name link to the config, and nothing else", () => {
    const { target, other, link } = setup();
    const old = join(link, "..", "HollowCoil");
    install(old, target);
    expect(removeOldLink(old, target)).toMatch(/^removed: /);
    expect(existsSync(old)).toBe(false);
    expect(readFileSync(join(target, "GameConfig.cfg"), "utf-8")).toBe("config");
    expect(removeOldLink(old, target)).toBeNull();

    install(old, other);
    expect(removeOldLink(old, target)).toBeNull();
    expect(existsSync(old)).toBe(true);
    uninstall(old);
    mkdirSync(old);
    expect(removeOldLink(old, target)).toBeNull();
    expect(existsSync(old)).toBe(true);
  });

  it("knows where TrenchBroom keeps its games", () => {
    expect(trenchbroomUserDir()).toMatch(/TrenchBroom$/);
  });
});
