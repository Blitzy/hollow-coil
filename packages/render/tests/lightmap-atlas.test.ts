import { describe, expect, it } from "vitest";
import { readRepoBytes } from "@mandreljs/testing";
import { lightmapExtents, readBsp, type Bsp } from "@mandreljs/sim/map/bsp";
import { AtlasError, composeLightmaps, lightmapUv, packLightmaps, type LightmapAtlas } from "@mandreljs/render/lightmap-atlas";

const bsp = readBsp(readRepoBytes("packages/sim/tests/fixtures/bsp/lit_room.bsp"));
const FLICKER = 10; // the fixture's flickering light style

const styleValues = (values: Record<number, number> = {}): number[] => Array.from({ length: 256 }, (_, s) => values[s] ?? 1);

function compose(atlas: LightmapAtlas, values = styleValues(), source: Bsp = bsp): Uint8Array {
  const image = new Uint8Array(atlas.width * atlas.height * 4);
  composeLightmaps(source, atlas, values, image);
  return image;
}

/** The atlas pixel for luxel (x, y) of a face's block. */
function pixel(atlas: LightmapAtlas, image: Uint8Array, face: number, x: number, y: number): number[] {
  const b = atlas.blocks.get(face)!;
  const at = ((b.y + y) * atlas.width + b.x + x) * 4;
  return [...image.subarray(at, at + 4)];
}

/** Raw RGB of luxel i in style slot s of a face. */
function raw(face: number, s: number, i: number): number[] {
  const f = bsp.faces[face]!;
  const { width, height } = lightmapExtents(bsp, f);
  const at = f.lightOffset + (s * width * height + i) * 3;
  return [...bsp.lighting.subarray(at, at + 3)];
}

describe("packLightmaps", () => {
  const atlas = packLightmaps(bsp);
  const lit = bsp.faces.flatMap((f, i) => (f.lightOffset >= 0 ? [i] : []));

  it("places every lit face, at its lightmap size", () => {
    expect([...atlas.blocks.keys()].sort((a, b) => a - b)).toEqual(lit);
    for (const [face, block] of atlas.blocks) {
      const { width, height, minS, minT } = lightmapExtents(bsp, bsp.faces[face]!);
      expect(block).toMatchObject({ face, width, height, minS, minT });
    }
  });

  it("keeps blocks inside the atlas without overlapping", () => {
    const owner = new Int32Array(atlas.width * atlas.height).fill(-1);
    for (const b of atlas.blocks.values()) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(atlas.width);
      expect(b.y + b.height).toBeLessThanOrEqual(atlas.height);
      for (let y = b.y; y < b.y + b.height; y++) {
        for (let x = b.x; x < b.x + b.width; x++) {
          expect(owner[y * atlas.width + x]).toBe(-1);
          owner[y * atlas.width + x] = b.face;
        }
      }
    }
  });

  it("packs deterministically", () => {
    expect(packLightmaps(bsp)).toEqual(atlas);
  });

  it("refuses an atlas over the size limit", () => {
    expect(() => packLightmaps(bsp, 32)).toThrow(AtlasError);
  });
});

describe("composeLightmaps", () => {
  const atlas = packLightmaps(bsp);
  const single = bsp.faces.findIndex((f) => f.styles.length === 1);
  // ericw-tools can give a face a style slot with no light in it, so pick the face the flicker lights most.
  const flickerLight = (face: number): number => {
    const f = bsp.faces[face]!;
    const { width, height } = lightmapExtents(bsp, f);
    const slot = f.styles.indexOf(FLICKER);
    return slot < 0 ? -1 : Math.max(...Array.from({ length: width * height }, (_, i) => Math.max(...raw(face, slot, i))));
  };
  const double = bsp.faces
    .flatMap((f, i) => (f.styles.length === 2 ? [i] : []))
    .reduce((best, i) => (flickerLight(i) > flickerLight(best) ? i : best));
  const steadySlot = 1 - bsp.faces[double]!.styles.indexOf(FLICKER);

  it("copies a single-style face's samples at normal brightness", () => {
    const image = compose(atlas);
    const { width, height } = atlas.blocks.get(single)!;
    for (let i = 0; i < width * height; i++) {
      expect(pixel(atlas, image, single, i % width, Math.floor(i / width))).toEqual([...raw(single, 0, i), 255]);
    }
  });

  it("adds a face's styles together", () => {
    const image = compose(atlas);
    const { width, height } = atlas.blocks.get(double)!;
    for (let i = 0; i < width * height; i++) {
      const sum = raw(double, 0, i).map((c, k) => c + raw(double, 1, i)[k]!);
      const fit = Math.max(...sum) > 255 ? 255 / Math.max(...sum) : 1;
      expect(pixel(atlas, image, double, i % width, Math.floor(i / width))).toEqual([...sum.map((c) => Math.round(c * fit)), 255]);
    }
  });

  it("scales each style by its current value", () => {
    const image = compose(atlas, styleValues({ [FLICKER]: 0 }));
    const { width, height } = atlas.blocks.get(double)!;
    for (let i = 0; i < width * height; i++) {
      expect(pixel(atlas, image, double, i % width, Math.floor(i / width))).toEqual([...raw(double, steadySlot, i), 255]);
    }
  });

  it("scales an overbright sum down as a whole, keeping its hue", () => {
    const image = compose(atlas, styleValues({ 0: 20 }));
    const { width, height } = atlas.blocks.get(single)!;
    for (let i = 0; i < width * height; i++) {
      const source = raw(single, 0, i);
      const out = pixel(atlas, image, single, i % width, Math.floor(i / width));
      if (Math.max(...source) === 0) continue;
      expect(Math.max(...out.slice(0, 3))).toBe(255);
      source.forEach((c, k) => expect(Math.abs(out[k]! - (c / Math.max(...source)) * 255)).toBeLessThanOrEqual(0.5 + 1e-9));
    }
  });

  it("updates only the faces it is given", () => {
    const image = compose(atlas);
    const before = image.slice();
    composeLightmaps(bsp, atlas, styleValues({ [FLICKER]: 0 }), image, [double]);
    const b = atlas.blocks.get(double)!;
    const inBlock = (pixelIndex: number): boolean => {
      const x = pixelIndex % atlas.width;
      const y = Math.floor(pixelIndex / atlas.width);
      return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
    };
    let changedInBlock = 0;
    for (let i = 0; i < image.length; i++) {
      if (image[i] === before[i]) continue;
      expect(inBlock(Math.floor(i / 4))).toBe(true);
      changedInBlock++;
    }
    expect(changedInBlock).toBeGreaterThan(0);
  });

  it("rejects an image of the wrong size", () => {
    expect(() => composeLightmaps(bsp, atlas, styleValues(), new Uint8Array(4))).toThrow(AtlasError);
  });
});

describe("lightmapUv", () => {
  const atlas = packLightmaps(bsp);

  it("maps a face onto luxel centers inside its block", () => {
    for (const block of atlas.blocks.values()) {
      const uvs = bsp.faces[block.face]!.vertices.map((v) => lightmapUv(bsp, atlas, block, v));
      const us = uvs.map(([u]) => u * atlas.width);
      const vs = uvs.map(([, v]) => v * atlas.height);
      // The face's lowest texel coordinate rounds down to a luxel, so it lands within the first luxel's center span.
      expect(Math.min(...us)).toBeGreaterThanOrEqual(block.x + 0.5 - 1e-9);
      expect(Math.min(...us)).toBeLessThan(block.x + 1.5);
      expect(Math.max(...us)).toBeLessThanOrEqual(block.x + block.width - 0.5 + 1e-9);
      expect(Math.min(...vs)).toBeGreaterThanOrEqual(block.y + 0.5 - 1e-9);
      expect(Math.max(...vs)).toBeLessThanOrEqual(block.y + block.height - 0.5 + 1e-9);
    }
  });
});
