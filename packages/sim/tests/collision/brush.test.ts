import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "@hollow-coil/testing";
import { describe, expect, it } from "vitest";
import { CONTENTS } from "@hollow-coil/sim/constants";
import { vec3 } from "@hollow-coil/sim/math/vec3";
import { parseMap, type MapFace } from "@hollow-coil/sim/map/parse";
import { buildBrush, type Brush } from "@hollow-coil/sim/collision/brush";
import { planeFromPoints, type Plane } from "@hollow-coil/sim/collision/plane";

const REPO = REPO_ROOT;
const FIXTURES = join(REPO, "packages/sim/tests/fixtures/bevels");

function face(points: [number, number, number][], contents = 0): MapFace {
  const [a, b, c] = points.map(([x, y, z]) => vec3(x, y, z));
  return {
    points: [a!, b!, c!], texture: "dev/grid_grey", projection: { kind: "standard", offset: [0, 0] },
    rotation: 0, scale: [1, 1], contents, surfaceFlags: 0, value: 0,
  };
}

/** Faces of an axis-aligned box, with points ordered so each plane faces outward. */
function boxFaces(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, contents = 0): MapFace[] {
  return [
    face([[x0, y0, z0], [x0, y1, z0], [x0, y0, z1]], contents),
    face([[x1, y0, z0], [x1, y0, z1], [x1, y1, z0]], contents),
    face([[x0, y0, z0], [x0, y0, z1], [x1, y0, z0]], contents),
    face([[x0, y1, z0], [x1, y1, z0], [x0, y1, z1]], contents),
    face([[x0, y0, z0], [x1, y0, z0], [x0, y1, z0]], contents),
    face([[x0, y0, z1], [x0, y1, z1], [x1, y0, z1]], contents),
  ];
}

const bevelCount = (b: Brush): number => b.planes.length - b.faces.length;

describe("planeFromPoints", () => {
  it("gives an outward unit normal and distance", () => {
    expect(planeFromPoints(vec3(64, 0, 0), vec3(64, 0, 64), vec3(64, 64, 0))).toEqual({ normal: vec3(1, 0, 0), dist: 64 });
  });

  it("rejects collinear points", () => {
    expect(planeFromPoints(vec3(0, 0, 0), vec3(1, 1, 1), vec3(2, 2, 2))).toBeNull();
  });

  // From test_combat's floor. The cross product is (25088, 0, 0), and 25088 * (1 / 25088) is
  // 0.9999999999999999, so normalizing by multiplying would leave the normal not quite axial.
  it("gives an exactly axial normal for an axial face, however its points lie", () => {
    expect(planeFromPoints(vec3(784, -784, 0), vec3(784, 784, -16), vec3(784, -784, -16))).toEqual({ normal: vec3(1, 0, 0), dist: 784 });
  });
});

describe("buildBrush", () => {
  it("builds a box with six faces, no bevels, and its bounds", () => {
    const brush = buildBrush(boxFaces(0, 0, 0, 64, 32, 16))!;
    expect(brush.faces).toHaveLength(6);
    expect(bevelCount(brush)).toBe(0);
    expect(brush.mins).toEqual(vec3(0, 0, 0));
    expect(brush.maxs).toEqual(vec3(64, 32, 16));
    expect(brush.contents).toBe(CONTENTS.SOLID);
    for (const f of brush.faces) expect(f.winding).toHaveLength(4);
  });

  it("adds no bevels to a box whose face points run diagonally across each face", () => {
    // test_combat's floor brush, as TrenchBroom wrote it. qbsp stores six planes for it.
    const brush = buildBrush([
      face([[-784, -784, -16], [-784, 784, -16], [-784, -784, 0]]),
      face([[784, -784, 0], [784, 784, -16], [784, -784, -16]]),
      face([[-784, -784, 0], [784, -784, -16], [-784, -784, -16]]),
      face([[-784, 784, -16], [784, 784, -16], [-784, 784, 0]]),
      face([[-784, -784, -16], [784, -784, -16], [-784, 784, -16]]),
      face([[-784, 784, 0], [784, -784, 0], [-784, -784, 0]]),
    ])!;
    expect(brush.planes).toHaveLength(6);
    expect(brush.mins).toEqual(vec3(-784, -784, -16));
    expect(brush.maxs).toEqual(vec3(784, 784, 0));
  });

  it("takes contents from the faces", () => {
    expect(buildBrush(boxFaces(0, 0, 0, 64, 64, 64, CONTENTS.PLAYERCLIP))!.contents).toBe(CONTENTS.PLAYERCLIP);
  });

  it("drops a redundant face and duplicate planes", () => {
    const faces = [...boxFaces(0, 0, 0, 64, 64, 64), face([[100, 0, 0], [100, 0, 64], [100, 64, 0]]), boxFaces(0, 0, 0, 64, 64, 64)[0]!];
    const brush = buildBrush(faces)!;
    expect(brush.faces).toHaveLength(6);
    expect(brush.planes).toHaveLength(6);
  });

  it("rejects faces that don't enclose a volume", () => {
    expect(buildBrush(boxFaces(0, 0, 0, 64, 64, 64).slice(0, 3))).toBeNull();
  });
});

describe("bevels match qbsp", () => {
  // shapes.map and expected.json come from tests/fixtures/bevels/generate.ts, which
  // compiles the shapes with the pinned qbsp and records the planes it stored.
  const expected: Record<string, number[][]> = JSON.parse(readFileSync(join(FIXTURES, "expected.json"), "utf-8"));
  const world = parseMap(readFileSync(join(FIXTURES, "shapes.map"), "utf-8"))[0]!;
  const shapeBrushes = world.brushes.slice(6); // after the six room walls, in the order of expected.json

  const close = (p: Plane, [nx, ny, nz, d]: number[]): boolean =>
    Math.abs(p.normal.x - nx!) < 1e-5 && Math.abs(p.normal.y - ny!) < 1e-5 &&
    Math.abs(p.normal.z - nz!) < 1e-5 && Math.abs(p.dist - d!) < 2e-3;

  Object.entries(expected).forEach(([name, planes], i) => {
    it(`${name}: ${planes.length} planes`, () => {
      const brush = buildBrush(shapeBrushes[i]!)!;
      expect(brush.planes).toHaveLength(planes.length);
      for (const plane of planes) {
        expect(brush.planes.some((p) => close(p, plane)), `missing plane ${plane.join(" ")}`).toBe(true);
      }
    });
  });
});

describe("repo maps", () => {
  const mapsDir = join(REPO, "maps");
  const maps = readdirSync(mapsDir).filter((f) => f.endsWith(".map"));

  it.each(maps)("%s: every brush builds", (file) => {
    const entities = parseMap(readFileSync(join(mapsDir, file), "utf-8"));
    for (const faces of entities[0]!.brushes) expect(buildBrush(faces)).not.toBeNull();
  });

  it("test_movement gets the 3 bevels qbsp reports (one per ramp)", () => {
    const world = parseMap(readFileSync(join(mapsDir, "test_movement.map"), "utf-8"))[0]!;
    const total = world.brushes.reduce((n, faces) => n + bevelCount(buildBrush(faces)!), 0);
    expect(total).toBe(3);
  });
});
