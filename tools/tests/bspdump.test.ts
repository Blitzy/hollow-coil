import { readRepoBytes, readRepoFile } from "../src/testing.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dump, main } from "../src/bspdump.ts";

// The committed lit room: two colored lights and a flickering one (style 10). See packages/sim/tests/fixtures/bsp.
const FIXTURE = "packages/sim/tests/fixtures/bsp/lit_room.bsp";
const bytes = readRepoBytes(FIXTURE);
const expected = JSON.parse(readRepoFile("packages/sim/tests/fixtures/bsp/expected.json"));

describe("bspdump", () => {
  afterEach(() => vi.restoreAllMocks());

  const info = dump(bytes, FIXTURE) as any;

  it("reports entities, their classes, and the textures used", () => {
    expect(info.entities).toEqual(expected.entities);
    expect(info.entity_classes).toEqual({ info_marker: 1, info_player_start: 1, light: 3, worldspawn: 1 });
    expect(Object.keys(info.textures)).toEqual(["dev/grid_dark", "dev/grid_grey", "dev/grid_light", "dev/grid_orange"]);
  });

  it("counts the file's elements", () => {
    expect(info.counts.faces).toBe(expected.faces.length);
    expect(info.counts.models).toBe(1);
    expect(info.counts.brushes).toBeGreaterThanOrEqual(7); // the room's seven brushes, plus any qbsp adds
  });

  it("checks lightmap sizes against the lighting data, and counts styles", () => {
    const lightmaps = info.lightmaps;
    expect(lightmaps.sizes_consistent).toBe(true);
    expect(lightmaps.bytes).toBe(expected.lighting_bytes);
    expect(lightmaps.lit_faces).toBe(info.counts.faces);
    expect(lightmaps.unlit_faces).toBe(0);
    expect(Object.keys(lightmaps.faces_per_style)).toEqual(["0", "10"]);
    expect(lightmaps.used_samples + lightmaps.padding_samples).toBe(lightmaps.samples);
    expect(lightmaps.padding_samples).toBeLessThan(4 * lightmaps.lit_faces);
    expect(lightmaps.mean_rgb[0]).toBeGreaterThan(0);
  });

  it("leaves entities out on request", () => {
    const short = dump(bytes, FIXTURE, false);
    expect(short).not.toHaveProperty("entities");
    expect(short).toHaveProperty("entity_classes");
  });

  it("rejects files that aren't Quake 2 .bsp files", () => {
    const quake1 = new Uint8Array(256);
    quake1[0] = 0x1d; // a Quake 1 BSP29 header
    expect(() => dump(quake1, "q1.bsp")).toThrow(/not a Quake 2 \.bsp/);
  });

  it("reports a missing file on the command line", () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => void errors.push(line));
    expect(main(["definitely/not/here.bsp"])).toBe(1);
    expect(errors.join("\n")).toContain("here.bsp");
  });

  it("prints JSON for a real file", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));
    expect(main([FIXTURE, "--no-entities"])).toBe(0);
    expect(JSON.parse(lines.join("\n")).lightmaps.sizes_consistent).toBe(true);
  });
});
