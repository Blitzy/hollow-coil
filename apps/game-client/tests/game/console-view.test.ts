import { describe, expect, it } from "vitest";
import { CELL_HEIGHT, CELL_WIDTH } from "@mandreljs/render/font";
import { Layer2D } from "@mandreljs/render/layer2d";
import { Console } from "../../src/game/console.ts";
import { ConsoleView, inputWindow, scrollbackRows, SLIDE_SECONDS, wrap } from "../../src/game/console-view.ts";

const line = (text: string, warning = false): { text: string; warning: boolean } => ({ text, warning });

describe("wrap", () => {
  it("breaks a long line at spaces, or mid-word when a word is too long", () => {
    expect(wrap("short", 10)).toEqual(["short"]);
    expect(wrap("the quick brown fox", 10)).toEqual(["the quick", "brown fox"]);
    expect(wrap("abcdefghijkl", 5)).toEqual(["abcde", "fghij", "kl"]);
    expect(wrap("", 5)).toEqual([""]);
  });
});

describe("scrollbackRows", () => {
  const lines = ["one", "two three four", "five"].map((text) => line(text));

  it("shows the newest rows that fit, wrapped, oldest first", () => {
    expect(scrollbackRows(lines, 9, 3, 0)).toEqual({ rows: [line("two three"), line("four"), line("five")], scroll: 0 });
  });

  it("scrolls back, but no further than the oldest row", () => {
    expect(scrollbackRows(lines, 9, 3, 1).rows).toEqual([line("one"), line("two three"), line("four")]);
    expect(scrollbackRows(lines, 9, 3, 50)).toEqual({ rows: [line("one"), line("two three"), line("four")], scroll: 1 });
    expect(scrollbackRows(lines, 40, 10, 5)).toEqual({ rows: lines, scroll: 0 });
  });

  it("keeps a warning's color on every row it wraps to", () => {
    expect(scrollbackRows([line("bad news here", true)], 8, 5, 0).rows).toEqual([line("bad news", true), line("here", true)]);
  });
});

describe("inputWindow", () => {
  it("shows the whole line when it fits", () => {
    expect(inputWindow("map e1m1", 3, 20)).toEqual({ text: "map e1m1", cursor: 3 });
  });

  it("scrolls a long line to keep the cursor in view, with room for it at the end", () => {
    expect(inputWindow("abcdefghij", 10, 5)).toEqual({ text: "ghij", cursor: 4 });
    expect(inputWindow("abcdefghij", 2, 5)).toEqual({ text: "abcde", cursor: 2 });
  });
});

describe("ConsoleView", () => {
  it("slides down and back up over SLIDE_SECONDS, showing nothing when up", () => {
    const view = new ConsoleView();
    const layer = new Layer2D();
    layer.resize(1280, 720);
    view.draw(layer, new Console(), 0, "v");
    expect(layer.quadCount).toBe(0);
    view.open = true;
    view.update(SLIDE_SECONDS / 2);
    expect(view.shown).toBe(true);
    view.open = false;
    view.update(SLIDE_SECONDS);
    expect(view.shown).toBe(false);
  });

  it("draws over the top half, with the command line at the bottom and the scrollback above it", () => {
    const view = new ConsoleView();
    const layer = new Layer2D();
    layer.resize(1280, 720); // 640 by 360 virtual pixels
    const con = new Console();
    con.print("hello");
    con.type("map");
    view.open = true;
    view.update(SLIDE_SECONDS);
    view.draw(layer, con, 0, "v1");
    const geometry = layer.mesh.geometry;
    const position = geometry.getAttribute("position");
    const corners = Array.from({ length: layer.quadCount }, (_, i) => ({ x: position.getX(i * 4), y: position.getY(i * 4), y1: position.getY(i * 4 + 2) }));
    expect(corners[0]).toEqual({ x: 0, y: 0, y1: 180 }); // the background
    const glyphs = corners.filter((corner) => corner.y1 - corner.y === CELL_HEIGHT);
    const rows = [...new Set(glyphs.map((glyph) => glyph.y))].sort((a, b) => a - b);
    expect(rows).toHaveLength(2); // "hello", then "] map" with "v1" beside it
    expect(rows[1]! + CELL_HEIGHT).toBeLessThan(180);
    expect(rows[1]! - rows[0]!).toBeGreaterThanOrEqual(CELL_HEIGHT);
    expect(glyphs.filter((glyph) => glyph.y === rows[0]).length).toBe("hello".length);
    expect(Math.max(...glyphs.map((glyph) => glyph.x))).toBe(640 - 4 - CELL_WIDTH); // the version's last character, at the right
    expect(con.pageRows).toBeGreaterThan(5);
  });
});
