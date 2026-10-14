// Generates the example game's placeholder textures in example/textures/dev/.
//
// Grid textures are 64x64 with a line every 16 texels and a darker line on the
// tile edge, so at the default scale of 1 they show 16- and 64-unit
// measurements in the world. Solid textures are flat colors. The generated
// PNGs are committed; rerun this after changing the lists below.
//
// Usage: node tools/src/make-placeholder-textures.ts   (or npm run make-placeholder-textures)

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { EXAMPLE_GAME, isMain, relativeToRepo } from "./repo.ts";

export const OUT_DIR = join(EXAMPLE_GAME, "textures", "dev");
const SIZE = 64;
const MINOR_STEP = 16;

type Color = readonly [number, number, number];

/** name: [base, minor line, major line] */
const GRIDS: Record<string, [Color, Color, Color]> = {
  grid_grey: [[150, 150, 150], [118, 118, 118], [72, 72, 72]],
  grid_light: [[200, 200, 200], [165, 165, 165], [110, 110, 110]],
  grid_dark: [[80, 80, 80], [62, 62, 62], [36, 36, 36]],
  grid_orange: [[168, 108, 58], [138, 86, 44], [88, 54, 26]],
  grid_blue: [[72, 104, 172], [54, 80, 138], [32, 48, 92]],
  grid_green: [[84, 140, 76], [64, 112, 58], [38, 70, 34]],
  grid_red: [[168, 64, 56], [136, 48, 42], [88, 28, 24]],
};

const SOLIDS: Record<string, Color> = {
  solid_white: [235, 235, 235],
  solid_black: [20, 20, 20],
  solid_red: [200, 40, 40],
  solid_green: [40, 170, 60],
  solid_blue: [40, 80, 200],
  solid_yellow: [230, 200, 40],
};

export function gridPixels(base: Color, minor: Color, major: Color): Color[] {
  const pixels: Color[] = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (x === 0 || y === 0) pixels.push(major);
      else if (x % MINOR_STEP === 0 || y % MINOR_STEP === 0) pixels.push(minor);
      else pixels.push(base);
    }
  }
  return pixels;
}

/** Encodes 8-bit RGB pixels as a PNG. */
export function pngBytes(width: number, height: number, pixels: readonly Color[]): Uint8Array {
  const chunk = (kind: string, data: Uint8Array): Buffer => {
    const body = Buffer.concat([Buffer.from(kind, "latin1"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body) >>> 0, body.length + 4);
    return out;
  };
  const rows = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3); // each row starts with filter type 0 (none)
    for (let x = 0; x < width; x++) rows.set(pixels[y * width + x]!, row + 1 + x * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, no interlace
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", new Uint8Array()),
  ]));
}

/** Every placeholder texture, by name, as pixels. */
export function placeholderTextures(): Map<string, Color[]> {
  const textures = new Map<string, Color[]>();
  for (const [name, [base, minor, major]] of Object.entries(GRIDS)) textures.set(name, gridPixels(base, minor, major));
  for (const [name, color] of Object.entries(SOLIDS)) textures.set(name, Array<Color>(SIZE * SIZE).fill(color));
  return textures;
}

export function main(outDir: string = OUT_DIR): number {
  mkdirSync(outDir, { recursive: true });
  const textures = placeholderTextures();
  for (const [name, pixels] of textures) writeFileSync(join(outDir, `${name}.png`), pngBytes(SIZE, SIZE, pixels));
  console.log(`wrote ${textures.size} textures to ${relativeToRepo(outDir)}`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main();
