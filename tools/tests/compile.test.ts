// Compiles small fixture maps with the pinned ericw-tools. Skipped when the
// tools aren't installed (npm run setup); CI installs them before testing.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dump } from "../src/bspdump.ts";
import { compileMap, compileOk, errorLine, findMaps } from "../src/compile.ts";
import { toolsInstalled } from "../src/setup.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");

describe("findMaps", () => {
  it("treats an unknown map name as an error", () => {
    expect(() => findMaps(["definitely_not_a_map"])).toThrow(/no such map/);
  });

  it("lists every map in the example game's maps/ by default", () => {
    expect(findMaps([]).map((p) => p.split(/[\\/]/).pop())).toContain("test_movement.map");
  });

  it("finds maps in another game directory", () => {
    const game = mkdtempSync(join(tmpdir(), "mandrel-game-"));
    try {
      mkdirSync(join(game, "maps"));
      writeFileSync(join(game, "maps", "e1m1.map"), "");
      expect(findMaps([], game)).toEqual([join(game, "maps", "e1m1.map")]);
      expect(findMaps(["e1m1"], game)).toEqual([join(game, "maps", "e1m1.map")]);
      expect(() => findMaps(["test_movement"], game)).toThrow(/no such map/);
    } finally {
      rmSync(game, { recursive: true, force: true });
    }
  });
});

describe("errorLine", () => {
  it("prefers the line after an ERROR banner", () => {
    expect(errorLine("starting\n**** ERROR ****\nbrush 3 is bad\n")).toBe("brush 3 is bad");
    expect(errorLine("one\nERROR: no file\n")).toBe("ERROR: no file");
    expect(errorLine("just\nthe last line\n")).toBe("the last line");
  });
});

describe.skipIf(!toolsInstalled())("compileMap (needs ericw-tools)", () => {
  const dirs: string[] = [];
  const outDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "mandrel-compile-"));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("compiles a sealed room to a lit Quake 2 .bsp", async () => {
    const out = outDir();
    const result = await compileMap(join(FIXTURES, "room.map"), out);
    expect(result.problems).toEqual([]);
    const data = readFileSync(join(out, "room.bsp"));
    expect([data.toString("latin1", 0, 4), data.readInt32LE(4)]).toEqual(["IBSP", 38]);
    expect(data.readInt32LE(8 + 7 * 8 + 4)).toBeGreaterThan(0); // the lighting lump's length: light wrote lightmaps
  });

  it("compiles in release mode", async () => {
    const out = outDir();
    expect((await compileMap(join(FIXTURES, "room.map"), out, "release")).problems).toEqual([]);
    expect(existsSync(join(out, "room.bsp"))).toBe(true);
  });

  it("fails on a leak, names the entity, and keeps the point file for TrenchBroom", async () => {
    const out = outDir();
    const result = await compileMap(join(FIXTURES, "leak.map"), out);
    expect(compileOk(result)).toBe(false);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain("leak");
    expect(result.problems[0]).toContain("info_player_start");
    expect(existsSync(join(out, "leak.bsp"))).toBe(false);
    expect(existsSync(join(out, "leak.pts"))).toBe(true);
  });

  it("fails on a missing texture and leaves no .bsp", async () => {
    const out = outDir();
    const result = await compileMap(join(FIXTURES, "missing_texture.map"), out);
    expect(result.problems).toEqual(["missing texture: dev/not_a_texture"]);
    expect(existsSync(join(out, "missing_texture.bsp"))).toBe(false);
  });

  it("clears stale failure files when a fixed map recompiles", async () => {
    const out = outDir();
    const map = join(out, "fixme.map");
    copyFileSync(join(FIXTURES, "leak.map"), map);
    expect(compileOk(await compileMap(map, join(out, "build")))).toBe(false);
    copyFileSync(join(FIXTURES, "room.map"), map);
    expect((await compileMap(map, join(out, "build"))).problems).toEqual([]);
    expect(existsSync(join(out, "build", "fixme.pts"))).toBe(false);
  });

  it("never deletes the map when the output goes next to it", async () => {
    const out = outDir();
    copyFileSync(join(FIXTURES, "room.map"), join(out, "room.map"));
    expect((await compileMap(join(out, "room.map"), out)).problems).toEqual([]);
    expect(existsSync(join(out, "room.map"))).toBe(true);
    expect(existsSync(join(out, "room.bsp"))).toBe(true);
  });

  it("produces a .bsp bspdump reads: entities, textures, and lightmaps", async () => {
    const out = outDir();
    await compileMap(join(FIXTURES, "room.map"), out);
    const info = dump(new Uint8Array(readFileSync(join(out, "room.bsp"))), "room.bsp") as any;
    expect(info.entity_classes).toEqual({ info_player_start: 1, light: 1, worldspawn: 1 });
    expect(info.entities).toContainEqual({ classname: "light", origin: "0 0 96", light: "200" });
    expect(Object.keys(info.textures).sort()).toEqual(["dev/grid_grey", "dev/grid_light", "dev/grid_orange"]);
    expect(info.counts.brushes).toBe(6);
    expect(info.lightmaps.sizes_consistent).toBe(true);
    expect(info.lightmaps.lit_faces).toBe(info.counts.faces);
    expect(info.lightmaps.faces_per_style).toEqual({ "0": info.counts.faces });
  });

  it("gives a styled light's faces a second lightmap", async () => {
    const out = outDir();
    const map = join(out, "styled.map");
    writeFileSync(map, readFileSync(join(FIXTURES, "room.map"), "utf-8").replace('"light" "200"', '"light" "200"\n"style" "10"'));
    await compileMap(map, out);
    const info = dump(new Uint8Array(readFileSync(join(out, "styled.bsp"))), "styled.bsp") as any;
    expect(info.lightmaps.sizes_consistent).toBe(true);
    expect(info.lightmaps.faces_per_style).toHaveProperty("10");
  });
});
