import { describe, expect, it } from "vitest";
import { CELL_HEIGHT, CELL_WIDTH, cellOf, cellPosition, fontImage, fontText, GLYPH_HEIGHT, GLYPH_WIDTH, glyphs, SOLID, TAB_WIDTH } from "@mandreljs/render/font";

const code = (char: string): number => char.charCodeAt(0);

describe("the engine's font", () => {
  it("has a glyph for every printable ASCII character, each 5 by 9 of ink or space", () => {
    const table = glyphs();
    expect([...table.keys()]).toEqual(Array.from({ length: 95 }, (_, i) => 32 + i));
    for (const [char, rows] of table) {
      expect(rows, String.fromCharCode(char)).toHaveLength(GLYPH_HEIGHT);
      for (const row of rows) expect(row, String.fromCharCode(char)).toMatch(new RegExp(`^[.#]{${GLYPH_WIDTH}}$`));
      expect(rows.join("").includes("#"), String.fromCharCode(char)).toBe(char !== code(" "));
    }
  });

  it("keeps descenders below the baseline only for the letters that have them", () => {
    const below = [...glyphs()].filter(([, rows]) => rows.slice(7).some((row) => row.includes("#"))).map(([char]) => String.fromCharCode(char));
    expect(below.sort().join("")).toBe(",_gjpqy|");
  });

  it("packs the glyphs white on transparent, with the spacing column and row left clear", () => {
    const image = fontImage();
    const alpha = (x: number, y: number): number => image.data[(y * image.width + x) * 4 + 3]!;
    const a = cellPosition(code("A"));
    expect(alpha(a.x + 2, a.y)).toBe(255); // the top of A's point
    expect(alpha(a.x, a.y)).toBe(0);
    expect(image.data[(a.y * image.width + a.x + 2) * 4]).toBe(255); // white
    for (let c = 32; c < SOLID; c++) {
      const cell = cellPosition(c);
      for (let y = 0; y < CELL_HEIGHT; y++) expect(alpha(cell.x + CELL_WIDTH - 1, cell.y + y)).toBe(0);
      for (let x = 0; x < CELL_WIDTH; x++) expect(alpha(cell.x + x, cell.y + CELL_HEIGHT - 1)).toBe(0);
    }
  });

  it("ends with a solid cell for filled rectangles", () => {
    const image = fontImage();
    const solid = cellPosition(SOLID);
    for (let y = 0; y < CELL_HEIGHT; y++) {
      for (let x = 0; x < CELL_WIDTH; x++) expect(image.data[((solid.y + y) * image.width + solid.x + x) * 4 + 3]).toBe(255);
    }
    expect(image.height).toBe(6 * CELL_HEIGHT);
  });

  it("draws typographic punctuation as the ASCII it stands for", () => {
    expect(fontText("Ranger’s “best” shotgun – 2×4 • wait…")).toBe(`Ranger's "best" shotgun - 2x4 * wait...`);
    expect(fontText("«hi» −5")).toBe("<<hi>> -5");
  });

  it("draws accented letters without their accents", () => {
    expect(fontText("Château Été Straße Ærø Łódź")).toBe("Chateau Ete Strasse AEro Lodz");
    expect(fontText("é")).toBe("e"); // an accent already apart from its letter
  });

  it("draws other spaces as spaces, and drops characters with no width", () => {
    expect(fontText("10 s left​﻿")).toBe("10 s left");
  });

  it("turns tabs into spaces to the next tab stop", () => {
    expect(TAB_WIDTH).toBe(4);
    expect(fontText("a\tbc\td\t\te")).toBe("a   bc  d       e");
    expect(fontText("…\tx")).toBe("... x"); // stops count the cells drawn
  });

  it("gives one cell per character, with a question mark for what it can't stand in for", () => {
    expect(fontText("日本 🙂!")).toBe("?? ?!");
    const plain = "nothing to change: ~`{}|";
    expect(fontText(plain)).toBe(plain);
  });

  it("draws characters it doesn't have as a question mark", () => {
    expect(cellOf(code("A"))).toBe(code("A"));
    expect(cellOf(code("é"))).toBe(code("?"));
    expect(cellOf(9)).toBe(code("?"));
    expect(cellOf(SOLID)).toBe(code("?"));
  });
});
