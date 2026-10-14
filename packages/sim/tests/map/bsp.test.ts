import { describe, expect, it } from "vitest";
import { readRepoBytes, readRepoFile } from "@hollow-coil/testing";
import { CONTENTS } from "@hollow-coil/sim/constants";
import { cross, dot, sub } from "@hollow-coil/sim/math/vec3";
import { BSP_LUMP_NAMES, BspError, faceNormal, lightmapExtents, modelBrushes, readBsp, type Bsp } from "@hollow-coil/sim/map/bsp";
import { parseEntities, parseMap } from "@hollow-coil/sim/map/parse";

// Compiled by tests/fixtures/bsp/generate.ts; expected.json holds what that script reads from it with its own parser.
const FIXTURE = "packages/sim/tests/fixtures/bsp";

interface ExpectedFace {
  texture: string;
  flags: number;
  normal: number[];
  vertices: number[][];
  styles: number[];
  light_offset: number;
  lightmap?: { mins: number[]; width: number; height: number; first_luxel: number[] };
}

interface Expected {
  lighting_bytes: number;
  entities: Record<string, string>[];
  models: { first_face: number; num_faces: number }[];
  faces: ExpectedFace[];
}

const expected = JSON.parse(readRepoFile(`${FIXTURE}/expected.json`)) as Expected;
const bytes = readRepoBytes(`${FIXTURE}/lit_room.bsp`);
const bsp = readBsp(bytes);
const round = (n: number, places: number): number => Math.round(n * 10 ** places) / 10 ** places + 0;

describe("readBsp", () => {
  it("reads the entity lump", () => {
    expect(parseEntities(bsp.entities)).toEqual(expected.entities);
  });

  it("keeps the .map's entities, in order", () => {
    const fromMap = parseMap(readRepoFile(`${FIXTURE}/lit_room.map`)).map((e) => e.properties);
    expect(parseEntities(bsp.entities)).toEqual(fromMap);
  });

  it("reads models", () => {
    expect(bsp.models.map((m) => ({ first_face: m.firstFace, num_faces: m.numFaces }))).toEqual(expected.models);
  });

  it("reads faces: texture, flags, normal, vertices, and light styles", () => {
    expect(bsp.faces).toHaveLength(expected.faces.length);
    bsp.faces.forEach((face, i) => {
      const want = expected.faces[i]!;
      const info = bsp.texinfo[face.texinfo]!;
      const n = faceNormal(bsp, face);
      expect({
        texture: info.texture,
        flags: info.flags,
        normal: [n.x, n.y, n.z].map((c) => round(c, 6)),
        vertices: face.vertices.map((v) => [v.x, v.y, v.z].map((c) => round(c, 4))),
        styles: face.styles,
        light_offset: face.lightOffset,
      }).toEqual({ ...want, lightmap: undefined });
    });
  });

  it("winds face vertices clockwise seen from the front", () => {
    for (const face of bsp.faces) {
      const [a, b, c] = face.vertices;
      expect(dot(cross(sub(b!, a!), sub(c!, a!)), faceNormal(bsp, face))).toBeLessThan(0);
    }
  });

  it("computes each lit face's lightmap extents and finds its first luxel", () => {
    expect(bsp.lighting.byteLength).toBe(expected.lighting_bytes);
    bsp.faces.forEach((face, i) => {
      const want = expected.faces[i]!.lightmap;
      if (!want) return;
      const { minS, minT, width, height } = lightmapExtents(bsp, face);
      expect({ mins: [minS, minT], width, height }).toEqual({ mins: want.mins, width: want.width, height: want.height });
      expect([...bsp.lighting.subarray(face.lightOffset, face.lightOffset + 3)]).toEqual(want.first_luxel);
    });
  });

  // ericw-tools stores each face's styles back to back and pads the face to a multiple of 4 samples.
  // Checking the gaps exactly catches any extents that come out a luxel too small, not just too large.
  it("accounts for every byte of the lighting lump", () => {
    const lit = bsp.faces.filter((f) => f.lightOffset >= 0).sort((a, b) => a.lightOffset - b.lightOffset);
    lit.forEach((face, i) => {
      const { width, height } = lightmapExtents(bsp, face);
      const samples = width * height * face.styles.length;
      const end = lit[i + 1]?.lightOffset ?? bsp.lighting.byteLength;
      expect(end - face.lightOffset).toBe(Math.ceil(samples / 4) * 4 * 3);
    });
  });

  it("exposes the header's lump table", () => {
    expect(bsp.lumps).toHaveLength(BSP_LUMP_NAMES.length);
    const lighting = bsp.lumps[BSP_LUMP_NAMES.indexOf("lighting")]!;
    expect(lighting.length).toBe(expected.lighting_bytes);
    expect(bytes.subarray(lighting.offset, lighting.offset + lighting.length)).toEqual(bsp.lighting);
  });

  it("rejects files that are not Quake 2 .bsp files", () => {
    expect(() => readBsp(new Uint8Array(16))).toThrow(BspError);
    const wrongVersion = bytes.slice();
    new DataView(wrongVersion.buffer).setInt32(4, 29, true);
    expect(() => readBsp(wrongVersion)).toThrow(/version 29/);
  });

  it("rejects lumps that run past the end of the file", () => {
    expect(() => readBsp(bytes.subarray(0, bytes.byteLength - 100))).toThrow(/out of bounds/);
  });

  it("rejects a node tree that points past its nodes and leafs", () => {
    const broken = bytes.slice();
    const nodes = bsp.lumps[BSP_LUMP_NAMES.indexOf("nodes")]!;
    new DataView(broken.buffer).setInt32(nodes.offset + 4, bsp.nodes.length + 5, true); // node 0's front child
    expect(() => readBsp(broken)).toThrow(/node 0/);
  });
});

describe("brushes", () => {
  it("reads the world's brushes: the room's seven boxes, solid, with six sides each", () => {
    const world = modelBrushes(bsp, 0);
    expect(world).toHaveLength(7);
    for (const index of world) {
      const brush = bsp.brushes[index]!;
      expect(brush.contents).toBe(CONTENTS.SOLID);
      expect(brush.sides).toHaveLength(6);
    }
  });

  // shapes.bsp and expected.json come from tests/fixtures/bevels/generate.ts, which reads
  // each test shape's planes, bevels included, straight from the .bsp's bytes.
  it("finds every plane qbsp stored for each bevel test shape", () => {
    const shapes = readBsp(readRepoBytes("packages/sim/tests/fixtures/bevels/shapes.bsp"));
    const want = JSON.parse(readRepoFile("packages/sim/tests/fixtures/bevels/expected.json")) as Record<string, number[][]>;
    const planeLists = modelBrushes(shapes, 0).map((index) =>
      shapes.brushes[index]!.sides
        .map((side) => shapes.planes[side.plane]!)
        .map((p) => [...[p.normal.x, p.normal.y, p.normal.z].map((c) => round(c, 6)), round(p.dist, 4)])
        .sort(byNumbers),
    );
    for (const [name, planes] of Object.entries(want)) {
      expect(planeLists, name).toContainEqual(planes);
    }
  });

  it("lists a model's brushes from its own node tree only", () => {
    // Two models over three brushes: the world has a node with two leafs, model 1 is a single leaf.
    const twoModels: Bsp = {
      ...bsp,
      models: [
        { ...bsp.models[0]!, headNode: 0 },
        { ...bsp.models[0]!, headNode: -3 },
      ],
      nodes: [{ plane: 0, children: [-1, -2] }],
      leafs: [
        { contents: 1, brushes: [2, 0] },
        { contents: 1, brushes: [0] },
        { contents: 1, brushes: [1] },
      ],
    };
    expect(modelBrushes(twoModels, 0)).toEqual([0, 2]);
    expect(modelBrushes(twoModels, 1)).toEqual([1]);
    expect(() => modelBrushes(twoModels, 2)).toThrow(/no model 2/);
  });
});

/** Orders number lists element by element, as the fixture generator sorts them. */
function byNumbers(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}
