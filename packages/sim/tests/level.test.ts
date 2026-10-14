import { describe, expect, it } from "vitest";
import { loadPlayerData, readRepoBytes, readRepoFile } from "@hollow-coil/testing";
import type { Plane } from "@hollow-coil/sim/collision/plane";
import { trace, type CollisionBrush } from "@hollow-coil/sim/collision/trace";
import { hullFromData } from "@hollow-coil/sim/data";
import { levelFromBsp, levelFromMap, LevelError, type Level } from "@hollow-coil/sim/level";
import { readBsp, type Bsp } from "@hollow-coil/sim/map/bsp";
import { vec3, type Vec3 } from "@hollow-coil/sim/math/vec3";
import { PLAYER_MASK } from "@hollow-coil/sim/player/movement";
import { nextRandom, seedRandom } from "@hollow-coil/sim/rng";

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

// .bsp planes are float32, so they match the .map's within float32 precision.
const NORMAL_TOLERANCE = 1e-5;
const DIST_TOLERANCE = 1e-3;
const near = (a: Vec3, b: Vec3, tolerance: number): boolean =>
  Math.abs(a.x - b.x) < tolerance && Math.abs(a.y - b.y) < tolerance && Math.abs(a.z - b.z) < tolerance;
const samePlane = (a: Plane, b: Plane): boolean => near(a.normal, b.normal, NORMAL_TOLERANCE) && Math.abs(a.dist - b.dist) < DIST_TOLERANCE;
const sameBrush = (a: CollisionBrush, b: CollisionBrush): boolean =>
  a.contents === b.contents &&
  a.planes.length === b.planes.length &&
  a.planes.every((p) => b.planes.some((q) => samePlane(p, q))) &&
  near(a.mins, b.mins, DIST_TOLERANCE) &&
  near(a.maxs, b.maxs, DIST_TOLERANCE);

describe("levelFromBsp", () => {
  // qbsp reorders brushes, so each .map brush is matched by shape, not by position.
  it.each(["bevels/shapes", "bsp/lit_room"])("%s: has the same brushes as the .map, bevels included", (path) => {
    const { map, bsp } = fixture(path);
    expect(bsp.world.brushes).toHaveLength(map.world.brushes.length);
    for (const brush of map.world.brushes) {
      expect(bsp.world.brushes.filter((b) => sameBrush(brush, b))).toHaveLength(1);
    }
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
    const { mins, maxs } = hullFromData(loadPlayerData().hull);
    let rng = seedRandom(7);
    const random = (lo: number, hi: number): number => {
      const r = nextRandom(rng);
      rng = r.state;
      return lo + r.value * (hi - lo);
    };
    const point = (): Vec3 => vec3(random(-112, 112), random(-112, 112), random(24, 96));
    let hits = 0;
    for (let i = 0; i < 2000; i++) {
      const start = point();
      const end = point();
      const a = trace(map.world, start, end, mins, maxs, PLAYER_MASK);
      const b = trace(bsp.world, start, end, mins, maxs, PLAYER_MASK);
      expect({ startSolid: b.startSolid, allSolid: b.allSolid }).toEqual({ startSolid: a.startSolid, allSolid: a.allSolid });
      expect(near(a.endpos, b.endpos, 1e-3), `sweep ${i}: ${JSON.stringify(a.endpos)} vs ${JSON.stringify(b.endpos)}`).toBe(true);
      expect(near(a.normal, b.normal, NORMAL_TOLERANCE), `sweep ${i}: normals differ`).toBe(true);
      if (a.fraction < 1 && !a.startSolid) hits++;
    }
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
