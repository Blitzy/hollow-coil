// Animated light styles: each style's brightness steps through a pattern of
// letters from the engine's light styles (packages/defs/lightstyles.json). Lightmaps are re-composed on the CPU
// when a style's value changes, the way Quake's GL renderers updated them, and
// only for faces lit by an animated style.
//
// Animation runs on sim ticks, not the wall clock, so it pauses and replays
// with the sim. It is presentation only: the sim never reads light styles.

import lightStylesJson from "@mandreljs/defs/lightstyles.json";
import { TICK_RATE } from "@mandreljs/sim/constants";
import type { Bsp } from "@mandreljs/sim/map/bsp";
import { secondsToTicks } from "@mandreljs/sim/constants";
import { composeLightmaps, type LightmapAtlas } from "./lightmap-atlas.ts";

/** The shape of packages/defs/lightstyles.json. */
export interface LightStyleData {
  /** Seconds per pattern letter. */
  readonly step_time: number;
  readonly styles: Readonly<Record<string, { readonly name: string; readonly pattern: string }>>;
}

/** The engine's light styles, shared by every game: Quake's patterns, picked by a light's style key. Built into the engine, not loaded with a game. */
export const LIGHT_STYLES: LightStyleData = lightStylesJson;

/** Style numbers fit in a byte; undefined styles stay at normal brightness. */
const STYLE_COUNT = 256;

/**
 * Brightness for one pattern letter: 'a' is 0, 'm' is 1 (normal), 'z' is 25/12.
 * Follows CL_SetLightstyle in Quake 2's cl_fx.c (GPLv2 or later, id Software).
 */
export const letterValue = (letter: string): number => (letter.charCodeAt(0) - 97) / 12;

/** Every style's brightness at a sim tick. A pattern advances one letter per step and loops. */
export function styleValuesAt(data: LightStyleData, tick: number, tickRate = TICK_RATE): Float64Array {
  const values = new Float64Array(STYLE_COUNT).fill(1);
  const step = Math.floor(tick / Math.max(1, secondsToTicks(data.step_time, tickRate)));
  for (const [key, { pattern }] of Object.entries(data.styles)) {
    values[Number(key)] = letterValue(pattern[step % pattern.length]!);
  }
  return values;
}

/** True if a style's pattern ever changes brightness. */
const isAnimated = (data: LightStyleData, style: number): boolean => new Set(data.styles[style]?.pattern ?? "").size > 1;

export class LightStyleAnimator {
  /** Faces whose lightmaps change as styles animate. */
  readonly animatedFaces: readonly number[];
  /** Per animated face, the styles that actually put light on it. */
  private readonly faceStyles: ReadonlyMap<number, readonly number[]>;
  private values: Float64Array;
  private readonly bsp: Bsp;
  private readonly atlas: LightmapAtlas;
  private readonly data: LightStyleData;
  private readonly image: Uint8Array;
  private readonly tickRate: number;

  /** Composes every face's lightmap into image at tick 0. */
  constructor(bsp: Bsp, atlas: LightmapAtlas, data: LightStyleData, image: Uint8Array, tickRate = TICK_RATE) {
    this.bsp = bsp;
    this.atlas = atlas;
    this.data = data;
    this.image = image;
    this.tickRate = tickRate;
    const faceStyles = new Map<number, number[]>();
    for (const index of atlas.blocks.keys()) {
      const lit = litStyles(bsp, atlas, index);
      if (lit.some((style) => isAnimated(data, style))) faceStyles.set(index, lit);
    }
    this.faceStyles = faceStyles;
    this.animatedFaces = [...faceStyles.keys()].sort((a, b) => a - b);
    this.values = styleValuesAt(data, 0, tickRate);
    composeLightmaps(bsp, atlas, this.values, image);
  }

  /** Brings the image to a sim tick. Returns true if any lightmap changed. */
  update(tick: number): boolean {
    const values = styleValuesAt(this.data, tick, this.tickRate);
    const faces = this.animatedFaces.filter((face) => this.faceStyles.get(face)!.some((style) => values[style] !== this.values[style]));
    this.values = values;
    if (faces.length === 0) return false;
    composeLightmaps(this.bsp, this.atlas, values, this.image, faces);
    return true;
  }
}

/**
 * A face's styles whose samples aren't all black. ericw-tools sometimes gives a
 * face a style slot that no light reaches; animating it would change nothing.
 */
function litStyles(bsp: Bsp, atlas: LightmapAtlas, index: number): number[] {
  const face = bsp.faces[index]!;
  const block = atlas.blocks.get(index)!;
  const bytes = block.width * block.height * 3;
  return face.styles.filter((_, slot) => {
    const start = face.lightOffset + slot * bytes;
    return bsp.lighting.subarray(start, start + bytes).some((b) => b !== 0);
  });
}
