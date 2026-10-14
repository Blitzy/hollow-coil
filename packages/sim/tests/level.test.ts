import { describe, expect, it } from "vitest";
import { loadPlayerData, readRepoBytes, readRepoFile } from "@mandreljs/testing";
import { brushMismatches, compareSweeps } from "@mandreljs/testing/level-parity";
import type { Plane } from "@mandreljs/sim/collision/plane";
import { hullFromData } from "@mandreljs/sim/data";
import { levelFromBsp, levelFromMap, LevelError, type Level } from "@mandreljs/sim/level";
import { readBsp, type Bsp } from "@mandreljs/sim/map/bsp";
import { vec3 } from "@mandreljs/sim/math/vec3";
import { PLAYER_MASK } from "@mandreljs/sim/player/movement";

const FIXTURES = "packages/sim/tests/fixtures";
const fixture = (path: string): { map: Level; bsp: Level } => ({
  map: levelFromMap(readRepoFile(`${FIXTURES}/${path}.map`)),
  bsp: levelFromBsp(readBsp(readRepoBytes(`${FIXTURES}/${path}.bsp`))),
});

describe("levelFromMap", () => {
  const level = levelFromMap(readRepoFile("maps/test_movement.map"));

  it("reads markers and the player start from the map", () => {
    expect(level.markers.get("step18_start")).toEqual(vec3(64, 144, 24));
    expect(level.markers.size).toBe(6);
    expect(level.playerStart).toEqual({ origin: vec3(-64, -208, 24), angle: 0 });
    expect(level.world.brushes.length).toBe(level.brushes.length);
  });

  it("rejects a map without worldspawn first", () => {
    expect(() => levelFromMap('{\n"classname" "light"\n}\n')).toThrow(LevelError);
  });
});

// The real maps get the same comparisons in tools/tests/compiled-maps.test.ts, which compiles them.
describe("levelFromBsp", () => {
  // qbsp reorders brushes, so each .map brush is matched by shape, not by position.
  it.each(["bevels/shapes", "bsp/lit_room"])("%s: has the same brushes as the .map, bevels included", (path) => {
    const { map, bsp } = fixture(path);
    expect(brushMismatches(map, bsp)).toEqual([]);
  });

  it("reads the same entities, markers, and player start as the .map", () => {
    const { map, bsp } = fixture("bsp/lit_room");
    expect(bsp.entities).toEqual(map.entities);
    expect(bsp.markers).toEqual(map.markers);
    expect(bsp.playerStart).toEqual(map.playerStart);
  });

  // The bevel shapes are where .map and .bsp collision could most easily disagree.
  it("gives the same sweeps as the .map through the bevel test shapes", () => {
    const { map, bsp } = fixture("bevels/shapes");
    const { hits, differences } = compareSweeps(map, bsp, {
      hull: hullFromData(loadPlayerData().hull),
      region: { mins: vec3(-112, -112, 24), maxs: vec3(112, 112, 96) },
      reach: 224,
      mask: PLAYER_MASK,
      count: 2000,
      seed: 7,
    });
    expect(differences).toEqual([]);
    expect(hits).toBeGreaterThan(500); // most sweeps hit something, so the comparison means something
  });

  // A hand-built .bsp, to test cases qbsp never writes.
  const handBuilt = (brushes: Bsp["brushes"], leafBrushes: number[][]): Bsp => {
    const real = readBsp(readRepoBytes(`${FIXTURES}/bsp/lit_room.bsp`));
    return {
      ...real,
      models: [{ ...real.models[0]!, headNode: 0 }, { ...real.models[0]!, headNode: -2 }],
      nodes: [{ plane: 0, children: [-1, -1] }],
      leafs: leafBrushes.map((b) => ({ contents: 1, brushes: b })),
      brushes,
    };
  };

  it("uses only the world model's brushes", () => {
    const level = levelFromBsp(handBuilt([{ sides: [], contents: 1 }, { sides: [], contents: 2 }], [[0], [1]]));
    expect(level.world.brushes.map((b) => b.contents)).toEqual([1]);
  });

  it("takes bounds from the axial sides, leaving a missing one open", () => {
    const planes: Plane[] = [
      { normal: vec3(1, 0, 0), dist: 10 }, { normal: vec3(-1, 0, 0), dist: 20 }, { normal: vec3(0, 1, 0), dist: 30 },
      { normal: vec3(0, -1, 0), dist: 40 }, { normal: vec3(0, 0, 1), dist: 50 }, // no -z side
    ];
    const sides = planes.map((_, plane) => ({ plane, texinfo: -1 }));
    const level = levelFromBsp({ ...handBuilt([{ sides, contents: 1 }], [[0]]), planes });
    const brush = level.world.brushes[0]!;
    expect(brush.mins).toEqual(vec3(-20, -40, -Infinity));
    expect(brush.maxs).toEqual(vec3(10, 30, 50));
  });

  it("rejects a .bsp without worldspawn first", () => {
    expect(() => levelFromBsp({ ...handBuilt([], []), entities: '{\n"classname" "light"\n}\n' })).toThrow(LevelError);
  });
});
