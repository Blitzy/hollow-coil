// Packs a .bsp's face lightmaps into one atlas image, and composes each face's
// light styles into it. Plain data, no Three.js: the renderer uploads the
// composed RGBA bytes as a texture and re-composes when light styles change.

import { lightmapExtents, texelCoords, LUXEL_SIZE, type Bsp } from "@mandreljs/sim/map/bsp";
import type { Vec3 } from "@mandreljs/sim/math/vec3";

/** Where one face's lightmap sits in the atlas, in luxels. */
export interface AtlasBlock {
  readonly face: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Texel coordinates of the face's first luxel, for lightmap UVs. */
  readonly minS: number;
  readonly minT: number;
}

export interface LightmapAtlas {
  readonly width: number;
  readonly height: number;
  /** Blocks for every lit face, by face index. */
  readonly blocks: ReadonlyMap<number, AtlasBlock>;
}

export class AtlasError extends Error {
  override name = "AtlasError";
}

const nextPowerOfTwo = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

/**
 * Packs every lit face's lightmap into one atlas. Blocks touch with no gap
 * between them: lightmap UVs land on luxel centers, so linear filtering never
 * reads a neighbor's luxels.
 */
export function packLightmaps(bsp: Bsp, maxSize = 4096): LightmapAtlas {
  const pending = bsp.faces.flatMap((face, index) => (face.lightOffset < 0 ? [] : [{ face: index, ...lightmapExtents(bsp, face) }]));
  const area = pending.reduce((sum, b) => sum + b.width * b.height, 0);
  const widest = pending.reduce((w, b) => Math.max(w, b.width), 1);
  const width = Math.max(64, nextPowerOfTwo(Math.max(widest, Math.ceil(Math.sqrt(area)))));
  if (width > maxSize) throw new AtlasError(`lightmaps need an atlas ${width} luxels wide, over the ${maxSize} limit`);

  // Tallest first packs tighter. Ties fall back to face order so packing is deterministic.
  pending.sort((a, b) => b.height - a.height || b.width - a.width || a.face - b.face);

  // Skyline packing, adapted from LM_AllocBlock in Quake's gl_rsurf.c (GPLv2 or later, id Software):
  // filled[x] is the height used in column x; each block goes where its columns' top is lowest.
  const filled = new Array<number>(width).fill(0);
  const blocks = new Map<number, AtlasBlock>();
  let height = 0;
  for (const b of pending) {
    let bestX = 0;
    let bestY = Infinity;
    for (let x = 0; x + b.width <= width; x++) {
      let y = 0;
      for (let i = 0; i < b.width && y < bestY; i++) y = Math.max(y, filled[x + i]!);
      if (y < bestY) {
        bestX = x;
        bestY = y;
      }
    }
    for (let i = 0; i < b.width; i++) filled[bestX + i] = bestY + b.height;
    height = Math.max(height, bestY + b.height);
    blocks.set(b.face, { face: b.face, x: bestX, y: bestY, width: b.width, height: b.height, minS: b.minS, minT: b.minT });
  }
  if (height > maxSize) throw new AtlasError(`lightmaps need an atlas ${height} luxels tall, over the ${maxSize} limit`);
  return { width, height: Math.max(height, 1), blocks };
}

/**
 * Writes faces' lightmaps into an RGBA atlas image (width * height * 4 bytes),
 * summing each face's styles scaled by their current values (1 is normal
 * brightness). A sum over 255 is scaled down as a whole, keeping its hue, as
 * in R_BuildLightMap from Quake 2's gl_light.c (GPLv2 or later, id Software).
 * Pass `faces` to update only some faces, such as those with animated styles.
 */
export function composeLightmaps(
  bsp: Bsp,
  atlas: LightmapAtlas,
  styleValues: ArrayLike<number>,
  image: Uint8Array,
  faces: Iterable<number> = atlas.blocks.keys(),
): void {
  if (image.length !== atlas.width * atlas.height * 4) throw new AtlasError("image size does not match the atlas");
  const { lighting } = bsp;
  for (const index of faces) {
    const block = atlas.blocks.get(index);
    if (!block) continue;
    const face = bsp.faces[index]!;
    const samples = block.width * block.height;
    const scales = face.styles.map((style) => styleValues[style] ?? 1);
    for (let i = 0; i < samples; i++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let s = 0; s < scales.length; s++) {
        const at = face.lightOffset + (s * samples + i) * 3;
        r += lighting[at]! * scales[s]!;
        g += lighting[at + 1]! * scales[s]!;
        b += lighting[at + 2]! * scales[s]!;
      }
      const max = Math.max(r, g, b);
      const fit = max > 255 ? 255 / max : 1;
      const out = ((block.y + Math.floor(i / block.width)) * atlas.width + block.x + (i % block.width)) * 4;
      image[out] = Math.round(r * fit);
      image[out + 1] = Math.round(g * fit);
      image[out + 2] = Math.round(b * fit);
      image[out + 3] = 255;
    }
  }
}

/**
 * Atlas UV for a point on a face, landing on luxel centers: a point at the
 * face's first luxel maps to the middle of the block's first texel. Follows
 * GL_BuildPolygonFromSurface in Quake 2's gl_rsurf.c (GPLv2 or later, id Software).
 */
export function lightmapUv(bsp: Bsp, atlas: LightmapAtlas, block: AtlasBlock, p: Vec3): [number, number] {
  const [s, t] = texelCoords(bsp.texinfo[bsp.faces[block.face]!.texinfo]!, p);
  return [
    (block.x + (s - block.minS) / LUXEL_SIZE + 0.5) / atlas.width,
    (block.y + (t - block.minT) / LUXEL_SIZE + 0.5) / atlas.height,
  ];
}
