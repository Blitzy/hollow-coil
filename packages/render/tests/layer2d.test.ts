import { describe, expect, it } from "vitest";
import { CELL_HEIGHT, CELL_WIDTH, cellPosition, fontImage } from "@mandreljs/render/font";
import { Layer2D, MIN_HEIGHT } from "@mandreljs/render/layer2d";

/** The quads a layer holds: each one's corners, the font image pixels it shows, and its color. */
function quads(layer: Layer2D): { x: number; y: number; x1: number; y1: number; u: number; v: number; u1: number; v1: number; tint: number[] }[] {
  const geometry = layer.mesh.geometry;
  const count = layer.quadCount;
  const image = fontImage();
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const tint = geometry.getAttribute("tint");
  return Array.from({ length: count }, (_, i) => ({
    x: position.getX(i * 4),
    y: position.getY(i * 4),
    x1: position.getX(i * 4 + 2),
    y1: position.getY(i * 4 + 2),
    u: Math.round(uv.getX(i * 4) * image.width * 16) / 16, // back to font pixels, past float32 rounding
    v: Math.round(uv.getY(i * 4) * image.height * 16) / 16,
    u1: Math.round(uv.getX(i * 4 + 2) * image.width * 16) / 16,
    v1: Math.round(uv.getY(i * 4 + 2) * image.height * 16) / 16,
    tint: [tint.getX(i * 4), tint.getY(i * 4), tint.getZ(i * 4), tint.getW(i * 4)],
  }));
}

describe("Layer2D", () => {
  it("scales by whole screen pixels, keeping at least MIN_HEIGHT virtual pixels", () => {
    const layer = new Layer2D();
    layer.resize(1280, 720);
    expect([layer.scale, layer.width, layer.height]).toEqual([2, 640, 360]);
    layer.resize(1920, 1080);
    expect([layer.scale, layer.width, layer.height]).toEqual([3, 640, 360]);
    layer.resize(2560, 1439);
    expect([layer.scale, layer.width, layer.height]).toEqual([3, 853, 479]);
    layer.resize(800, 300);
    expect([layer.scale, layer.width, layer.height]).toEqual([1, 800, 300]);
    expect(MIN_HEIGHT).toBe(360);
  });

  it("draws text a cell per character, skipping spaces, and says where it ends", () => {
    const layer = new Layer2D();
    expect(layer.text(10, 20, "Hi !", 0xff8000, 0.5)).toBe(10 + 4 * CELL_WIDTH);
    const drawn = quads(layer);
    expect(drawn).toHaveLength(3);
    const h = cellPosition("H".charCodeAt(0));
    expect(drawn[0]).toMatchObject({ x: 10, y: 20, x1: 10 + CELL_WIDTH, y1: 20 + CELL_HEIGHT, u: h.x, v: h.y, u1: h.x + CELL_WIDTH, v1: h.y + CELL_HEIGHT });
    expect(drawn[2]!.x).toBe(10 + 3 * CELL_WIDTH);
    expect(drawn[0]!.tint.map((c) => Math.round(c * 255))).toEqual([255, 128, 0, 128]);
  });

  it("draws text as fontText gives it, a cell per character", () => {
    const layer = new Layer2D();
    expect(layer.text(0, 0, "wait…", 0xffffff)).toBe(7 * CELL_WIDTH);
    const dot = cellPosition(".".charCodeAt(0));
    expect(quads(layer).slice(4).map((quad) => [quad.x, quad.u, quad.v])).toEqual([4, 5, 6].map((column) => [column * CELL_WIDTH, dot.x, dot.y]));
  });

  it("fills rectangles from the font's solid cell", () => {
    const layer = new Layer2D();
    layer.rect(0, 0, 640, 180, 0x000000, 0.8);
    const [rect] = quads(layer);
    expect(rect).toMatchObject({ x: 0, y: 0, x1: 640, y1: 180 });
    const image = fontImage();
    expect(image.data[(Math.floor(rect!.v) * image.width + Math.floor(rect!.u)) * 4 + 3]).toBe(255);
  });

  it("grows to hold as much as a frame adds, and clear starts it over", () => {
    const layer = new Layer2D();
    const line = "#".repeat(100);
    for (let row = 0; row < 30; row++) layer.text(0, row * CELL_HEIGHT, line, 0xffffff);
    expect(quads(layer)).toHaveLength(3000);
    expect(quads(layer)[2999]).toMatchObject({ x: 99 * CELL_WIDTH, y: 29 * CELL_HEIGHT });
    layer.clear();
    expect(quads(layer)).toHaveLength(0);
  });
});
