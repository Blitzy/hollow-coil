// Draws the console on the 2D layer, as Quake's: it slides down over the top half
// of the view, with the scrollback above the command line and the engine's
// version in the corner. Scrolled back, the bottom row shows carets instead of text.

import { CELL_HEIGHT, CELL_WIDTH } from "@mandreljs/render/font";
import type { Layer2D } from "@mandreljs/render/layer2d";
import type { Console, ConsoleLine } from "./console.ts";

/** Seconds to slide all the way down or up. */
export const SLIDE_SECONDS = 0.2;
/** Seconds the cursor shows, then hides. */
const BLINK_SECONDS = 0.5;
/** Virtual pixels between the console's edges and its text. */
const PAD = 4;
const PROMPT = "] ";
const COLORS = { background: 0x101018, edge: 0xb08030, text: 0xd0d0d0, warning: 0xf0c040, input: 0xffffff } as const;
const BACKGROUND_ALPHA = 0.88;

/** A line broken into rows of at most columns characters, at a space where there is one. */
export function wrap(text: string, columns: number): string[] {
  const rows: string[] = [];
  let rest = text;
  while (rest.length > columns) {
    const space = rest.lastIndexOf(" ", columns);
    const cut = space > 0 ? space : columns;
    rows.push(rest.slice(0, cut));
    rest = rest.slice(space > 0 ? cut + 1 : cut);
  }
  rows.push(rest);
  return rows;
}

/** The scrollback rows that fit, oldest first, scrolled back by scroll rows (kept within the scrollback, and returned). */
export function scrollbackRows(lines: readonly ConsoleLine[], columns: number, rows: number, scroll: number): { rows: ConsoleLine[]; scroll: number } {
  const wrapped = lines.flatMap((line) => wrap(line.text, columns).map((text) => ({ text, warning: line.warning })));
  const kept = Math.max(0, Math.min(scroll, wrapped.length - rows));
  const end = wrapped.length - kept;
  return { rows: wrapped.slice(Math.max(0, end - rows), end), scroll: kept };
}

/** The part of the command line that fits in columns, scrolled to keep the cursor in view, and the cursor's column in it. */
export function inputWindow(input: string, cursor: number, columns: number): { text: string; cursor: number } {
  const start = Math.max(0, cursor - columns + 1);
  return { text: input.slice(start, start + columns), cursor: cursor - start };
}

export class ConsoleView {
  /** Whether it's down, or going down. */
  open = false;
  /** How far down it is: 0 is up and hidden, 1 is all the way down. */
  private drop = 0;

  /** Whether any of it is on screen. */
  get shown(): boolean {
    return this.drop > 0;
  }

  /** Slides it toward open or closed, by real seconds since the last frame. */
  update(seconds: number): void {
    const step = seconds / SLIDE_SECONDS;
    this.drop = this.open ? Math.min(1, this.drop + step) : Math.max(0, this.drop - step);
  }

  /** Draws it on the layer: time is real seconds, for the cursor's blink; version goes in the corner. */
  draw(layer: Layer2D, con: Console, time: number, version: string): void {
    if (!this.shown) return;
    const full = Math.floor(layer.height / 2);
    const height = Math.round(full * this.drop);
    const top = height - full; // everything is placed as if it were all the way down, and slides with it
    layer.rect(0, 0, layer.width, height, COLORS.background, BACKGROUND_ALPHA);
    layer.rect(0, height - 1, layer.width, 1, COLORS.edge);

    const columns = Math.max(1, Math.floor((layer.width - 2 * PAD) / CELL_WIDTH));
    const inputY = top + full - 1 - PAD - CELL_HEIGHT;
    const versionX = layer.width - PAD - version.length * CELL_WIDTH;
    const inputColumns = Math.max(1, columns - PROMPT.length - version.length - 2);
    const input = inputWindow(con.input, con.cursor, inputColumns);
    const textX = layer.text(PAD, inputY, PROMPT, COLORS.input);
    layer.text(textX, inputY, input.text, COLORS.input);
    if (Math.floor(time / BLINK_SECONDS) % 2 === 0) layer.rect(textX + input.cursor * CELL_WIDTH, inputY + CELL_HEIGHT - 2, CELL_WIDTH - 1, 2, COLORS.input);
    layer.text(versionX, inputY, version, COLORS.edge);

    const rows = Math.max(1, Math.floor((inputY - top - PAD - 2) / CELL_HEIGHT));
    con.pageRows = Math.max(1, rows - 2);
    const shown = scrollbackRows(con.lines, columns, con.scroll > 0 ? rows - 1 : rows, con.scroll);
    con.scroll = shown.scroll;
    const bottom = inputY - 2 - CELL_HEIGHT;
    if (con.scroll > 0) layer.text(PAD, bottom, "^   ".repeat(Math.ceil(columns / 4)).slice(0, columns), COLORS.edge);
    const first = con.scroll > 0 ? bottom - CELL_HEIGHT : bottom;
    shown.rows.forEach((row, i) => {
      const y = first - (shown.rows.length - 1 - i) * CELL_HEIGHT;
      layer.text(PAD, y, row.text, row.warning ? COLORS.warning : COLORS.text);
    });
  }
}
