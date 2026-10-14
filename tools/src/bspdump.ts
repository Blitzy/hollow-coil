// Prints a compiled Quake 2 .bsp's contents as JSON: entities, element counts,
// textures used, and lightmap stats. Built on the game's own .bsp reader
// (@mandreljs/sim/map/bsp), so tools and game read the format one way.
//
// Lightmap sizes are computed from face geometry the way Quake 2 does (one
// luxel per 16 texels) and checked against the lighting data: each face's
// lightmap must fit in the space before the next face's data. This catches
// both reader mistakes and compiler settings that change the luxel size.
// ericw-tools pads each face's lightmap to a multiple of 4 samples, so faces
// are not packed back to back; always locate a face's lightmap by its offset.
//
// Usage: node tools/src/bspdump.ts build/example/test_movement.bsp [--no-entities]
//        (or npm run bspdump -- build/example/test_movement.bsp)

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { BSP_LUMP_NAMES, BspError, lightmapExtents, readBsp, type Bsp } from "@mandreljs/sim/map/bsp";
import { parseEntities } from "@mandreljs/sim/map/parse";
import { isMain } from "./repo.ts";

/** Bytes per record, for lumps that are arrays of fixed-size records. */
const RECORD_SIZES: Partial<Record<(typeof BSP_LUMP_NAMES)[number], number>> = {
  planes: 20, vertices: 12, nodes: 28, texinfo: 76, faces: 20, leafs: 28, models: 48, brushes: 12, brush_sides: 4,
};
const COUNTED = ["faces", "models", "brushes", "brush_sides", "planes", "texinfo", "vertices", "nodes", "leafs"] as const;

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Counts of each value, as an object with keys in sorted order. */
function tally<K extends string | number>(items: Iterable<K>, compare?: (a: K, b: K) => number): Record<string, number> {
  const counts = new Map<K, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([a], [b]) => (compare ? compare(a, b) : String(a) < String(b) ? -1 : 1)));
}

/** Extra BSPX lumps after the standard ones, as name to byte length. */
export function bspxLumps(bytes: Uint8Array, bsp: Bsp): Record<string, number> {
  const end = (Math.max(...bsp.lumps.map((l) => l.offset + l.length)) + 3) & ~3;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, length: number): string => String.fromCharCode(...bytes.subarray(at, at + length)).split("\0")[0]!;
  if (end + 8 > bytes.byteLength || text(end, 4) !== "BSPX") return {};
  const result: Record<string, number> = {};
  const count = view.getUint32(end + 4, true);
  for (let i = 0; i < count; i++) {
    const at = end + 8 + i * 32;
    if (at + 32 > bytes.byteLength) break;
    result[text(at, 24)] = view.getUint32(at + 28, true);
  }
  return result;
}

/** The report for a .bsp file's bytes. */
export function dump(bytes: Uint8Array, file: string, includeEntities = true): Record<string, unknown> {
  const bsp = readBsp(bytes);
  const entities = parseEntities(bsp.entities);

  let litFaces = 0;
  let unlitFaces = 0;
  let usedSamples = 0;
  let largest: [number, number] = [0, 0];
  const styles: number[] = [];
  const blocks: [offset: number, bytes: number][] = [];
  for (const face of bsp.faces) {
    if (face.lightOffset < 0) {
      unlitFaces++;
      continue;
    }
    litFaces++;
    styles.push(...face.styles);
    const { width, height } = lightmapExtents(bsp, face);
    const needed = width * height * face.styles.length;
    usedSamples += needed;
    blocks.push([face.lightOffset, needed * 3]);
    if (width * height > largest[0] * largest[1]) largest = [width, height];
  }

  // Each face's lightmap must end before the next one starts, and inside the lump.
  blocks.sort((a, b) => a[0] - b[0]);
  const sizesConsistent = blocks.every(([offset, size], i) => offset + size <= (blocks[i + 1]?.[0] ?? bsp.lighting.length));

  const lighting = bsp.lighting;
  const samples = Math.floor(lighting.length / 3);
  const channel = (c: number): number[] => Array.from({ length: samples }, (_, i) => lighting[i * 3 + c]!);
  const counts = Object.fromEntries(COUNTED.map((name) => [name, Math.floor(bsp.lumps[BSP_LUMP_NAMES.indexOf(name)]!.length / RECORD_SIZES[name]!)]));

  const result: Record<string, unknown> = {
    file,
    format: "Quake 2 IBSP v38",
    counts,
    entity_classes: tally(entities.map((e) => e.classname ?? "")),
    textures: tally(bsp.faces.map((f) => bsp.texinfo[f.texinfo]!.texture)),
    lightmaps: {
      bytes: lighting.length,
      samples,
      used_samples: usedSamples,
      padding_samples: samples - usedSamples,
      sizes_consistent: sizesConsistent,
      lit_faces: litFaces,
      unlit_faces: unlitFaces,
      largest_face_luxels: largest,
      faces_per_style: tally(styles, (a, b) => a - b),
      mean_rgb: samples ? [0, 1, 2].map((c) => round1(channel(c).reduce((s, v) => s + v, 0) / samples)) : [0, 0, 0],
      max_rgb: samples ? [0, 1, 2].map((c) => channel(c).reduce((m, v) => Math.max(m, v), 0)) : [0, 0, 0],
    },
    bspx_lumps: bspxLumps(bytes, bsp),
  };
  if (includeEntities) result.entities = entities;
  return result;
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const { values, positionals } = parseArgs({ args: argv, options: { "no-entities": { type: "boolean" } }, allowPositionals: true });
  const file = positionals[0];
  if (positionals.length !== 1 || !file) {
    console.error("usage: node tools/src/bspdump.ts <file.bsp> [--no-entities]");
    return 2;
  }
  try {
    const bytes = new Uint8Array(readFileSync(file));
    console.log(JSON.stringify(dump(bytes, file.split("\\").join("/"), !values["no-entities"]), null, 2));
    return 0;
  } catch (error) {
    if (!(error instanceof BspError) && !(error instanceof Error && "code" in error)) throw error;
    console.error(`error: ${file}: ${error.message}`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = main();
