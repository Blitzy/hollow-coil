import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { gridPixels, OUT_DIR, placeholderTextures, pngBytes } from "../src/make-placeholder-textures.ts";

/** A PNG's header fields and decompressed scanlines. */
function decodePng(bytes: Uint8Array): { width: number; height: number; depth: number; colorType: number; rows: Buffer } {
  const b = Buffer.from(bytes);
  expect(b.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  let header = Buffer.alloc(0);
  const data: Buffer[] = [];
  for (let at = 8; at < b.length; ) {
    const length = b.readUInt32BE(at);
    const kind = b.toString("latin1", at + 4, at + 8);
    if (kind === "IHDR") header = b.subarray(at + 8, at + 8 + length);
    if (kind === "IDAT") data.push(b.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  return { width: header.readUInt32BE(0), height: header.readUInt32BE(4), depth: header[8]!, colorType: header[9]!, rows: inflateSync(Buffer.concat(data)) };
}

describe("make-placeholder-textures", () => {
  it("draws grid lines on the edge and every 16 texels", () => {
    const base = [1, 1, 1] as const;
    const minor = [2, 2, 2] as const;
    const major = [3, 3, 3] as const;
    const pixels = gridPixels(base, minor, major);
    expect(pixels).toHaveLength(64 * 64);
    expect(pixels[0]).toBe(major);
    expect(pixels[16]).toBe(major); // the whole top row is the tile edge
    expect(pixels[64 * 5]).toBe(major); // and so is the left column
    expect(pixels[64 * 5 + 16]).toBe(minor);
    expect(pixels[64 * 16 + 5]).toBe(minor);
    expect(pixels[64 * 5 + 5]).toBe(base);
  });

  it("writes valid 8-bit RGB PNGs", () => {
    const png = decodePng(pngBytes(2, 1, [[255, 0, 0], [0, 0, 255]]));
    expect([png.width, png.height, png.depth, png.colorType]).toEqual([2, 1, 8, 2]);
    expect([...png.rows]).toEqual([0, 255, 0, 0, 0, 0, 255]);
  });

  it("matches the committed textures pixel for pixel", () => {
    const textures = placeholderTextures();
    expect(readdirSync(OUT_DIR).filter((f) => f.endsWith(".png")).sort()).toEqual([...textures.keys()].map((n) => `${n}.png`).sort());
    for (const [name, pixels] of textures) {
      const committed = decodePng(new Uint8Array(readFileSync(join(OUT_DIR, `${name}.png`))));
      expect(committed.rows.equals(decodePng(pngBytes(64, 64, pixels)).rows), name).toBe(true);
    }
  });
});
