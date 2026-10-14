// Parser for TrenchBroom .map files: entities with key/value pairs and brushes.
//
// Faces may use the Valve 220 or standard texture format, and may end with the
// Quake 2 contents, surface flags, and value fields. The same key/value entity
// text appears in a .bsp's entity lump, which parseEntities() reads.

import { vec3, type Vec3 } from "../math/vec3.ts";

export type TextureProjection =
  | { readonly kind: "valve"; readonly u: readonly [number, number, number, number]; readonly v: readonly [number, number, number, number] }
  | { readonly kind: "standard"; readonly offset: readonly [number, number] };

export interface MapFace {
  readonly points: readonly [Vec3, Vec3, Vec3];
  readonly texture: string;
  readonly projection: TextureProjection;
  readonly rotation: number;
  readonly scale: readonly [number, number];
  /** Quake 2 contents bits from the face; 0 when absent. */
  readonly contents: number;
  readonly surfaceFlags: number;
  readonly value: number;
}

export interface MapEntity {
  readonly properties: Readonly<Record<string, string>>;
  readonly brushes: readonly (readonly MapFace[])[];
}

export class MapParseError extends Error {
  readonly line: number;

  constructor(message: string, line: number) {
    super(`line ${line}: ${message}`);
    this.name = "MapParseError";
    this.line = line;
  }
}

class Cursor {
  private pos = 0;
  private line = 1;
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  /** Skips whitespace and // comments; returns the next character without consuming it, or "" at the end. */
  peek(): string {
    for (;;) {
      const c = this.text[this.pos];
      if (c === undefined) return "";
      if (c === "\n") {
        this.line++;
        this.pos++;
      } else if (c === " " || c === "\t" || c === "\r") {
        this.pos++;
      } else if (c === "/" && this.text[this.pos + 1] === "/") {
        while (this.pos < this.text.length && this.text[this.pos] !== "\n") this.pos++;
      } else {
        return c;
      }
    }
  }

  expect(char: string): void {
    const c = this.peek();
    if (c !== char) this.fail(`expected '${char}', found ${c === "" ? "end of file" : `'${c}'`}`);
    this.pos++;
  }

  /** A run of non-whitespace characters, such as a number or a texture name. */
  word(): string {
    if (this.peek() === "") this.fail("unexpected end of file");
    const start = this.pos;
    while (this.pos < this.text.length && !/\s/.test(this.text[this.pos]!)) this.pos++;
    return this.text.slice(start, this.pos);
  }

  number(): number {
    const w = this.word();
    const n = Number(w);
    if (w === "" || !Number.isFinite(n)) this.fail(`expected a number, found '${w}'`);
    return n;
  }

  /** True if the next word is a number, without consuming it. */
  peekNumber(): boolean {
    const c = this.peek();
    return c === "-" || c === "+" || c === "." || (c >= "0" && c <= "9");
  }

  quoted(): string {
    this.expect('"');
    const end = this.text.indexOf('"', this.pos);
    if (end < 0) this.fail("unterminated string");
    const s = this.text.slice(this.pos, end);
    for (const ch of s) if (ch === "\n") this.line++;
    this.pos = end + 1;
    return s;
  }

  fail(message: string): never {
    throw new MapParseError(message, this.line);
  }
}

function parsePoint(c: Cursor): Vec3 {
  c.expect("(");
  const p = vec3(c.number(), c.number(), c.number());
  c.expect(")");
  return p;
}

function parseAxis(c: Cursor): [number, number, number, number] {
  c.expect("[");
  const axis: [number, number, number, number] = [c.number(), c.number(), c.number(), c.number()];
  c.expect("]");
  return axis;
}

function parseFace(c: Cursor): MapFace {
  const points = [parsePoint(c), parsePoint(c), parsePoint(c)] as const;
  const texture = c.word();
  let projection: TextureProjection;
  if (c.peek() === "[") {
    projection = { kind: "valve", u: parseAxis(c), v: parseAxis(c) };
  } else {
    projection = { kind: "standard", offset: [c.number(), c.number()] };
  }
  const rotation = c.number();
  const scale = [c.number(), c.number()] as const;
  let contents = 0;
  let surfaceFlags = 0;
  let value = 0;
  if (c.peekNumber()) {
    contents = c.number();
    surfaceFlags = c.number();
    value = c.number();
  }
  return { points, texture, projection, rotation, scale, contents, surfaceFlags, value };
}

function parseBrush(c: Cursor): MapFace[] {
  c.expect("{");
  const faces: MapFace[] = [];
  while (c.peek() === "(") faces.push(parseFace(c));
  c.expect("}");
  return faces;
}

function parseEntity(c: Cursor): MapEntity {
  c.expect("{");
  const properties: Record<string, string> = {};
  const brushes: MapFace[][] = [];
  for (;;) {
    const next = c.peek();
    if (next === '"') {
      const key = c.quoted();
      properties[key] = c.quoted();
    } else if (next === "{") {
      brushes.push(parseBrush(c));
    } else if (next === "}") {
      c.expect("}");
      return { properties, brushes };
    } else {
      c.fail(next === "" ? "unterminated entity" : `unexpected '${next}' in entity`);
    }
  }
}

/** Parses a .map file into its entities. The first entity is normally worldspawn. */
export function parseMap(text: string): MapEntity[] {
  const c = new Cursor(text);
  const entities: MapEntity[] = [];
  while (c.peek() !== "") entities.push(parseEntity(c));
  return entities;
}

/** Parses entity key/value text with no brushes, such as a .bsp entity lump. */
export function parseEntities(text: string): Record<string, string>[] {
  return parseMap(text).map((e) => ({ ...e.properties }));
}
