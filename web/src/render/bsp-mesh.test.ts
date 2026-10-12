import { describe, expect, it } from "vitest";
import { readRepoBytes } from "../../tests/helpers/data";
import { faceNormal, readBsp, SURF, texelCoords, type Bsp } from "../sim/map/bsp";
import { cross, dot, sub, vec3 } from "../sim/math/vec3";
import { bspSurfaces, bspTextureNames } from "./bsp-mesh";
import { toThree } from "./coords";
import { lightmapUv, packLightmaps } from "./lightmap-atlas";

const bsp = readBsp(readRepoBytes("web/tests/fixtures/bsp/lit_room.bsp"));
const SIZE = 64;
const size = (): [number, number] => [SIZE, SIZE];

/** The same .bsp with the world model reduced to one face. */
const onlyFace = (source: Bsp, index: number): Bsp => ({ ...source, models: [{ ...source.models[0]!, firstFace: index, numFaces: 1 }] });

/** The same .bsp with one face's texinfo flags replaced. */
function withFlags(source: Bsp, index: number, flags: number): Bsp {
  const texinfo = [...source.texinfo, { ...source.texinfo[source.faces[index]!.texinfo]!, flags }];
  const faces = source.faces.map((f, i) => (i === index ? { ...f, texinfo: texinfo.length - 1 } : f));
  return { ...source, texinfo, faces };
}

describe("bspSurfaces", () => {
  const atlas = packLightmaps(bsp);

  it("fans each face into counterclockwise triangles that cover it, facing out of its front", () => {
    let dropped = 0;
    bsp.faces.forEach((face, i) => {
      const [batch, ...rest] = bspSurfaces(onlyFace(bsp, i), atlas, size);
      expect(rest).toHaveLength(0);
      const p = batch!.positions;
      dropped += face.vertices.length - 2 - p.length / 9;
      const normal = toThree(faceNormal(bsp, face));
      const n = vec3(normal[0], normal[1], normal[2]);
      let area = 0;
      for (let t = 0; t < p.length; t += 9) {
        const a = vec3(p[t + 3]! - p[t]!, p[t + 4]! - p[t + 1]!, p[t + 5]! - p[t + 2]!);
        const b = vec3(p[t + 6]! - p[t]!, p[t + 7]! - p[t + 1]!, p[t + 8]! - p[t + 2]!);
        const facing = dot(cross(a, b), n);
        expect(facing).toBeGreaterThan(0);
        area += facing / 2;
      }
      // The polygon's own area, from its vertices (clockwise in Quake coordinates, so negate).
      const v = face.vertices;
      let polygon = 0;
      for (let k = 1; k + 1 < v.length; k++) polygon -= dot(cross(sub(v[k]!, v[0]!), sub(v[k + 1]!, v[0]!)), faceNormal(bsp, face)) / 2;
      expect(area).toBeCloseTo(polygon, 3);
    });
    expect(dropped).toBeGreaterThan(0); // the fixture does have edge vertices that make degenerate triangles
  });

  it("gives each vertex its texture UV and lightmap UV", () => {
    bsp.faces.forEach((face, i) => {
      const [batch] = bspSurfaces(onlyFace(bsp, i), atlas, size);
      const info = bsp.texinfo[face.texinfo]!;
      const block = atlas.blocks.get(i)!;
      for (let v = 0; v < batch!.positions.length / 3; v++) {
        const [x, y, z] = batch!.positions.slice(v * 3, v * 3 + 3);
        const point = vec3(x!, -z!, y!); // back from Three to Quake coordinates
        const [s, t] = texelCoords(info, point);
        expect(batch!.uvs[v * 2]).toBeCloseTo(s / SIZE, 6);
        expect(batch!.uvs[v * 2 + 1]).toBeCloseTo(t / SIZE, 6);
        const [lu, lv] = lightmapUv(bsp, atlas, block, point);
        expect(batch!.lightUvs[v * 2]).toBeCloseTo(lu, 6);
        expect(batch!.lightUvs[v * 2 + 1]).toBeCloseTo(lv, 6);
      }
    });
  });

  it("batches faces by texture and draws every world face", () => {
    const batches = bspSurfaces(bsp, atlas, size);
    expect(new Set(batches.map((b) => b.texture)).size).toBe(batches.length);
    const triangles = batches.reduce((n, b) => n + b.positions.length / 9, 0);
    const perFace = bsp.faces.reduce((n, _face, i) => n + bspSurfaces(onlyFace(bsp, i), atlas, size)[0]!.positions.length / 9, 0);
    expect(triangles).toBe(perFace);
    expect(batches.every((b) => b.lit)).toBe(true);
  });

  it("skips sky and nodraw faces", () => {
    for (const flag of [SURF.SKY, SURF.NODRAW]) {
      const hidden = withFlags(bsp, 0, flag);
      expect(bspSurfaces(onlyFace(hidden, 0), atlas, size)).toEqual([]);
      expect(bspTextureNames(onlyFace(hidden, 0))).toEqual([]);
    }
  });

  it("puts faces without a lightmap in an unlit batch", () => {
    const unlit: Bsp = { ...bsp, faces: bsp.faces.map((f, i) => (i === 0 ? { ...f, styles: [], lightOffset: -1 } : f)) };
    const batches = bspSurfaces(onlyFace(unlit, 0), packLightmaps(unlit), size);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.lit).toBe(false);
  });
});

describe("bspTextureNames", () => {
  it("lists the world's textures once each, sorted", () => {
    expect(bspTextureNames(bsp)).toEqual(["dev/grid_dark", "dev/grid_grey", "dev/grid_light", "dev/grid_orange"]);
  });
});
