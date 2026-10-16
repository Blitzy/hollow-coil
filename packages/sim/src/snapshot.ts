// Snapshots and hashes. Sim state is plain data, so a snapshot is its JSON text
// (JSON round-trips every float64 exactly). A hash covers every value in plain
// data, in a fixed order: golden demos compare the state's tick by tick, and the
// content a demo was recorded on (see demo.ts).

import type { SimState } from "./sim.ts";

export const snapshot = (state: SimState): string => JSON.stringify(state);

export const restore = (text: string): SimState => JSON.parse(text) as SimState;

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

class Hasher {
  private h = FNV_OFFSET;
  private readonly view = new DataView(new ArrayBuffer(8));

  byte(b: number): void {
    this.h = Math.imul(this.h ^ (b & 0xff), FNV_PRIME) >>> 0;
  }

  uint32(n: number): void {
    for (let i = 0; i < 4; i++) this.byte(n >>> (i * 8));
  }

  float64(n: number): void {
    this.view.setFloat64(0, n === 0 ? 0 : n, true); // -0 and 0 hash the same, as JSON can't tell them apart
    for (let i = 0; i < 8; i++) this.byte(this.view.getUint8(i));
  }

  string(s: string): void {
    this.uint32(s.length);
    for (let i = 0; i < s.length; i++) this.uint32(s.charCodeAt(i));
  }

  value(v: unknown): void {
    if (v === null || v === undefined) {
      this.byte(0x7a);
    } else if (typeof v === "number") {
      this.byte(0x6e);
      this.float64(v);
    } else if (typeof v === "boolean") {
      this.byte(0x62);
      this.byte(v ? 1 : 0);
    } else if (typeof v === "string") {
      this.byte(0x73);
      this.string(v);
    } else if (v instanceof Map || v instanceof Set || ArrayBuffer.isView(v)) {
      throw new TypeError("can't hash a Map, Set, or typed array: hash plain data"); // their contents aren't own keys
    } else if (Array.isArray(v)) {
      this.byte(0x61);
      this.uint32(v.length);
      for (const item of v) this.value(item);
    } else if (typeof v === "object") {
      const keys = Object.keys(v).sort();
      this.byte(0x6f);
      this.uint32(keys.length);
      for (const key of keys) {
        this.string(key);
        this.value((v as Record<string, unknown>)[key]);
      }
    } else {
      throw new TypeError(`can't hash a ${typeof v}`);
    }
  }

  digest(): string {
    return this.h.toString(16).padStart(8, "0");
  }
}

/** A 32-bit FNV-1a hash of plain data (objects, arrays, numbers, strings, booleans, null), as 8 hex digits. Object key order doesn't matter. */
export function hashValue(value: unknown): string {
  const hasher = new Hasher();
  hasher.value(value);
  return hasher.digest();
}

/** A hash of the whole state, as 8 hex digits. */
export const hashState = (state: SimState): string => hashValue(state);
