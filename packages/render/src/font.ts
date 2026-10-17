// The engine's bitmap font, for the console and, later, the HUD and menus:
// printable ASCII in 5 by 9 pixel glyphs (7 above the baseline, 2 below for
// descenders), each in a 6 by 10 cell so text spaces itself. Drawn here rather
// than loaded, so every game has it with nothing to serve or license separately.
//
// fontImage() packs the glyphs into one white-on-transparent RGBA image, 16
// cells to a row, with a solid cell last for drawing filled rectangles.
// fontText() turns text into what the font can draw, a character to a cell:
// tabs to spaces, typographic punctuation to the ASCII it stands for, accented
// letters without their accents, and anything else to "?".

/** A glyph's cell in pixels: its advance, and the line height. */
export const CELL_WIDTH = 6;
export const CELL_HEIGHT = 10;
/** A glyph's ink fits in this, at its cell's top left; the rest of the cell is space. */
export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 9;
const FIRST = 32; // space
const LAST = 126; // ~
/** The cell after "~", filled solid, for drawing rectangles with the font's texture. */
export const SOLID = LAST + 1;
const COLUMNS = 16;

/** Shown for characters the font doesn't have. */
const MISSING = "?".charCodeAt(0);
/** Columns between tab stops. */
export const TAB_WIDTH = 4;

/** What characters the font lacks are drawn as, where ASCII has a stand-in. */
const FALLBACKS: Readonly<Record<string, string>> = {
  "‘": "'", // ‘ ’ ‚ ‛ ′ single quotes and prime
  "’": "'",
  "‚": "'",
  "‛": "'",
  "′": "'",
  "“": '"', // “ ” „ ″ double quotes and double prime
  "”": '"',
  "„": '"',
  "″": '"',
  "«": "<<", // « » ‹ › guillemets
  "»": ">>",
  "‹": "<",
  "›": ">",
  "‐": "-", // hyphens, dashes, and the minus sign
  "‑": "-",
  "‒": "-",
  "–": "-",
  "—": "-",
  "―": "-",
  "−": "-",
  "…": "...", // …
  "•": "*", // •
  "·": ".", // ·
  "×": "x", // ×
  "ß": "ss", // letters with no accent to drop: ß æ Æ œ Œ ø Ø ł Ł
  "æ": "ae",
  "Æ": "AE",
  "œ": "oe",
  "Œ": "OE",
  "ø": "o",
  "Ø": "O",
  "ł": "l",
  "Ł": "L",
};
/** Spaces other than the plain one (no-break, thin, em, and so on), drawn as a plain space. */
const SPACES = /^[   -   　]$/;
/** Characters with no width (zero-width space and joiners, the byte order mark), dropped. */
const INVISIBLE = /^[​-‍⁠﻿]$/;
const DRAWABLE = /^[\x20-\x7e]*$/;

/** One character the font lacks, as what it can draw: its stand-in, itself without accents, or "?". */
function standIn(char: string): string {
  const fallback = FALLBACKS[char];
  if (fallback !== undefined) return fallback;
  if (SPACES.test(char)) return " ";
  if (INVISIBLE.test(char) || /^\p{M}$/u.test(char)) return ""; // a combining accent goes with the letter before it
  const bare = char.normalize("NFD").replace(/\p{M}/gu, ""); // é is e and a combining accent
  return bare !== "" && DRAWABLE.test(bare) ? bare : "?";
}

/**
 * A line of text as the font draws it, one character to a cell, so its length is the cells it takes: tabs become
 * spaces to the next tab stop, and characters the font lacks become their stand-ins (see standIn).
 */
export function fontText(line: string): string {
  if (DRAWABLE.test(line)) return line;
  let out = "";
  for (const char of line) {
    if (char === "\t") out += " ".repeat(TAB_WIDTH - (out.length % TAB_WIDTH));
    else out += cellOf(char.codePointAt(0)!) === char.codePointAt(0) ? char : standIn(char);
  }
  return out;
}

// Strips of 16 glyphs, from space to "~", one string per pixel row: "#" is ink.
const SHEET = [
  // space !     "     #     $     %     &     '     (     )     *     +     ,     -     .     /
  "..... ..#.. .#.#. .#.#. ..#.. ##... .##.. ..#.. ...#. .#... ..... ..... ..... ..... ..... .....",
  "..... ..#.. .#.#. .#.#. .#### ##..# #..#. ..#.. ..#.. ..#.. ..#.. ..#.. ..... ..... ..... ....#",
  "..... ..#.. .#.#. ##### #.#.. ...#. #.#.. .#... .#... ...#. #.#.# ..#.. ..... ..... ..... ...#.",
  "..... ..#.. ..... .#.#. .###. ..#.. .#... ..... .#... ...#. .###. ##### ..... ##### ..... ..#..",
  "..... ..#.. ..... ##### ..#.# .#... #.#.# ..... .#... ...#. #.#.# ..#.. ..... ..... ..... .#...",
  "..... ..... ..... .#.#. ####. #..## #..#. ..... ..#.. ..#.. ..#.. ..#.. .##.. ..... .##.. #....",
  "..... ..#.. ..... .#.#. ..#.. ...## .##.# ..... ...#. .#... ..... ..... ..#.. ..... .##.. .....",
  "..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... .#... ..... ..... .....",
  "..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... .....",
  // 0     1     2     3     4     5     6     7     8     9     :     ;     <     =     >     ?
  ".###. ..#.. .###. ##### ...#. ##### ..##. ##### .###. .###. ..... ..... ...#. ..... .#... .###.",
  "#...# .##.. #...# ...#. ..##. #.... .#... ....# #...# #...# .##.. .##.. ..#.. ..... ..#.. #...#",
  "#..## ..#.. ....# ..#.. .#.#. ####. #.... ...#. #...# #...# .##.. .##.. .#... ##### ...#. ....#",
  "#.#.# ..#.. ...#. ...#. #..#. ....# ####. ..#.. .###. .#### ..... ..... #.... ..... ....# ...#.",
  "##..# ..#.. ..#.. ....# ##### ....# #...# .#... #...# ....# .##.. .##.. .#... ##### ...#. ..#..",
  "#...# ..#.. .#... #...# ...#. #...# #...# .#... #...# ...#. .##.. ..#.. ..#.. ..... ..#.. .....",
  ".###. .###. ##### .###. ...#. .###. .###. .#... .###. .##.. ..... .#... ...#. ..... .#... ..#..",
  "..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... .....",
  "..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... .....",
  // @     A     B     C     D     E     F     G     H     I     J     K     L     M     N     O
  ".###. .###. ####. .###. ###.. ##### ##### .###. #...# .###. ..### #...# #.... #...# #...# .###.",
  "#...# #...# #...# #...# #..#. #.... #.... #...# #...# ..#.. ...#. #..#. #.... ##.## #...# #...#",
  "....# #...# #...# #.... #...# #.... #.... #.... #...# ..#.. ...#. #.#.. #.... #.#.# ##..# #...#",
  ".##.# ##### ####. #.... #...# ####. ####. #.### ##### ..#.. ...#. ##... #.... #.#.# #.#.# #...#",
  "#.#.# #...# #...# #.... #...# #.... #.... #...# #...# ..#.. ...#. #.#.. #.... #...# #..## #...#",
  "#.#.# #...# #...# #...# #..#. #.... #.... #...# #...# ..#.. #..#. #..#. #.... #...# #...# #...#",
  ".###. #...# ####. .###. ###.. ##### #.... .#### #...# .###. .##.. #...# ##### #...# #...# .###.",
  "..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... .....",
  "..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... .....",
  // P     Q     R     S     T     U     V     W     X     Y     Z     [     \     ]     ^     _
  "####. .###. ####. .#### ##### #...# #...# #...# #...# #...# ##### .###. ..... .###. ..#.. .....",
  "#...# #...# #...# #.... ..#.. #...# #...# #...# #...# #...# ....# .#... #.... ...#. .#.#. .....",
  "#...# #...# #...# #.... ..#.. #...# #...# #...# .#.#. #...# ...#. .#... .#... ...#. #...# .....",
  "####. #...# ####. .###. ..#.. #...# #...# #.#.# ..#.. .#.#. ..#.. .#... ..#.. ...#. ..... .....",
  "#.... #.#.# #.#.. ....# ..#.. #...# #...# #.#.# .#.#. ..#.. .#... .#... ...#. ...#. ..... .....",
  "#.... #..#. #..#. ....# ..#.. #...# .#.#. #.#.# #...# ..#.. #.... .#... ....# ...#. ..... .....",
  "#.... .##.# #...# ####. ..#.. .###. ..#.. .#.#. #...# ..#.. ##### .###. ..... .###. ..... .....",
  "..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... #####",
  "..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... ..... .....",
  // `     a     b     c     d     e     f     g     h     i     j     k     l     m     n     o
  ".#... ..... #.... ..... ....# ..... ..##. ..... #.... ..#.. ...#. #.... .##.. ..... ..... .....",
  "..#.. ..... #.... ..... ....# ..... .#..# ..... #.... ..... ..... #.... ..#.. ..... ..... .....",
  "...#. .###. #.##. .###. .##.# .###. .#... .#### #.##. .##.. ..##. #..#. ..#.. ##.#. #.##. .###.",
  "..... ....# ##..# #.... #..## #...# ###.. #...# ##..# ..#.. ...#. #.#.. ..#.. #.#.# ##..# #...#",
  "..... .#### #...# #.... #...# ##### .#... #...# #...# ..#.. ...#. ##... ..#.. #.#.# #...# #...#",
  "..... #...# #...# #...# #...# #.... .#... #...# #...# ..#.. ...#. #.#.. ..#.. #...# #...# #...#",
  "..... .#### ####. .###. .#### .###. .#... .#### #...# .###. ...#. #..#. .###. #...# #...# .###.",
  "..... ..... ..... ..... ..... ..... ..... ....# ..... ..... #..#. ..... ..... ..... ..... .....",
  "..... ..... ..... ..... ..... ..... ..... .###. ..... ..... .##.. ..... ..... ..... ..... .....",
  // p     q     r     s     t     u     v     w     x     y     z     {     |     }     ~
  "..... ..... ..... ..... .#... ..... ..... ..... ..... ..... ..... ...#. ..#.. .#... .....",
  "..... ..... ..... ..... .#... ..... ..... ..... ..... ..... ..... ..#.. ..#.. ..#.. .....",
  "####. .#### #.##. .#### ###.. #...# #...# #...# #...# #...# ##### ..#.. ..#.. ..#.. .#...",
  "#...# #...# ##..# #.... .#... #...# #...# #...# .#.#. #...# ...#. .#... ..#.. ...#. #.#.#",
  "#...# #...# #.... .###. .#... #...# #...# #.#.# ..#.. #...# ..#.. ..#.. ..#.. ..#.. ...#.",
  "#...# #...# #.... ....# .#..# #..## .#.#. #.#.# .#.#. #...# .#... ..#.. ..#.. ..#.. .....",
  "####. .#### #.... ####. ..##. .##.# ..#.. .#.#. #...# .#### ##### ...#. ..#.. .#... .....",
  "#.... ....# ..... ..... ..... ..... ..... ..... ..... ....# ..... ..... ..#.. ..... .....",
  "#.... ....# ..... ..... ..... ..... ..... ..... ..... .###. ..... ..... ..#.. ..... .....",
];

/** Each glyph's rows, by character code. */
export function glyphs(): Map<number, readonly string[]> {
  const result = new Map<number, readonly string[]>();
  for (let strip = 0; strip * GLYPH_HEIGHT < SHEET.length; strip++) {
    const rows = SHEET.slice(strip * GLYPH_HEIGHT, (strip + 1) * GLYPH_HEIGHT).map((row) => row.split(" "));
    rows[0]!.forEach((_, i) => result.set(FIRST + strip * COLUMNS + i, rows.map((row) => row[i]!)));
  }
  return result;
}

/** The cell a character is drawn from: its own, or "?" for one the font doesn't have. */
export function cellOf(code: number): number {
  return code >= FIRST && code <= LAST ? code : MISSING;
}

export interface FontImage {
  readonly width: number;
  readonly height: number;
  /** RGBA, white where there's ink, transparent elsewhere; row 0 at the top. */
  readonly data: Uint8Array;
}

/** The font's cells packed into one image, 16 to a row, from space to the solid cell. */
export function fontImage(): FontImage {
  const cells = SOLID - FIRST + 1;
  const width = COLUMNS * CELL_WIDTH;
  const height = Math.ceil(cells / COLUMNS) * CELL_HEIGHT;
  const data = new Uint8Array(width * height * 4);
  const ink = (x: number, y: number): void => void data.fill(255, (y * width + x) * 4, (y * width + x) * 4 + 4);
  for (const [code, rows] of glyphs()) {
    const { x, y } = cellPosition(code);
    rows.forEach((row, dy) => [...row].forEach((pixel, dx) => pixel === "#" && ink(x + dx, y + dy)));
  }
  const solid = cellPosition(SOLID);
  for (let dy = 0; dy < CELL_HEIGHT; dy++) for (let dx = 0; dx < CELL_WIDTH; dx++) ink(solid.x + dx, solid.y + dy);
  return { width, height, data };
}

/** Where a cell's top left corner is in the font's image, in pixels. */
export function cellPosition(code: number): { x: number; y: number } {
  const index = code - FIRST;
  return { x: (index % COLUMNS) * CELL_WIDTH, y: Math.floor(index / COLUMNS) * CELL_HEIGHT };
}
