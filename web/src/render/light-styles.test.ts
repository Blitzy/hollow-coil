import { describe, expect, it } from "vitest";
import { readRepoBytes, readRepoFile } from "../../tests/helpers/data";
import { lightmapExtents, readBsp } from "../sim/map/bsp";
import { LightStyleAnimator, letterValue, styleValuesAt, type LightStyleData } from "./light-styles";
import { composeLightmaps, packLightmaps } from "./lightmap-atlas";

const data = JSON.parse(readRepoFile("data/lightstyles.json")) as LightStyleData;
const bsp = readBsp(readRepoBytes("web/tests/fixtures/bsp/lit_room.bsp"));
const FLICKER = 10; // the fixture's flickering light, "Fluorescent flicker"
const TEST: LightStyleData = { step_time: 0.1, styles: { "0": { name: "Normal", pattern: "m" }, "3": { name: "Test", pattern: "amz" } } };

describe("letterValue", () => {
  it("maps 'a' to dark, 'm' to normal, and 'z' to a little over double", () => {
    expect(letterValue("a")).toBe(0);
    expect(letterValue("m")).toBe(1);
    expect(letterValue("z")).toBeCloseTo(25 / 12, 12);
  });
});

describe("styleValuesAt", () => {
  it("steps each pattern one letter per step time and loops", () => {
    // 0.1 seconds is 6 ticks at 60 Hz.
    const at = (tick: number): number => styleValuesAt(TEST, tick, 60)[3]!;
    expect([0, 5, 6, 11, 12, 17, 18].map(at)).toEqual([0, 0, 1, 1, 25 / 12, 25 / 12, 0]);
  });

  it("keeps undefined styles at normal brightness", () => {
    const values = styleValuesAt(TEST, 6, 60);
    expect(values).toHaveLength(256);
    expect(values[1]).toBe(1);
    expect(values[40]).toBe(1);
  });

  it("follows the step time at other tick rates", () => {
    expect(styleValuesAt(TEST, 2, 20)[3]).toBe(1); // 0.1 seconds is 2 ticks at 20 Hz
  });

  it("reads the real fluorescent flicker", () => {
    // "mmamammmmammamamaaamammma": the third letter is the first dark one.
    expect(styleValuesAt(data, 2 * 6, 60)[FLICKER]).toBe(0);
    expect(styleValuesAt(data, 0, 60)[FLICKER]).toBe(1);
  });
});

describe("LightStyleAnimator", () => {
  const atlas = packLightmaps(bsp);
  const fullCompose = (tick: number): Uint8Array => {
    const image = new Uint8Array(atlas.width * atlas.height * 4);
    composeLightmaps(bsp, atlas, styleValuesAt(data, tick, 60), image);
    return image;
  };

  it("animates only faces the flickering light actually reaches", () => {
    const animator = new LightStyleAnimator(bsp, atlas, data, new Uint8Array(atlas.width * atlas.height * 4), 60);
    const reached = bsp.faces.flatMap((face, i) => {
      const slot = face.styles.indexOf(FLICKER);
      if (slot < 0) return [];
      const { width, height } = lightmapExtents(bsp, face);
      const start = face.lightOffset + slot * width * height * 3;
      return bsp.lighting.subarray(start, start + width * height * 3).some((b) => b !== 0) ? [i] : [];
    });
    expect(animator.animatedFaces).toEqual(reached);
    expect(reached.length).toBeGreaterThan(0);
    expect(reached.length).toBeLessThan(bsp.faces.filter((f) => f.styles.includes(FLICKER)).length); // some slots are empty
  });

  /** Index of the first byte that differs, or -1. Much faster than a deep equality check on big arrays. */
  const firstDifference = (a: Uint8Array, b: Uint8Array): number => {
    if (a.length !== b.length) return 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
    return -1;
  };

  it("keeps the image equal to composing every face from scratch, tick by tick", () => {
    const image = new Uint8Array(atlas.width * atlas.height * 4);
    const animator = new LightStyleAnimator(bsp, atlas, data, image, 60);
    expect(firstDifference(image, fullCompose(0))).toBe(-1);
    let changes = 0;
    for (let tick = 1; tick <= 300; tick++) {
      const changed = animator.update(tick);
      if (changed) changes++;
      expect(firstDifference(image, fullCompose(tick)), `tick ${tick}`).toBe(-1);
      // Patterns only move on step boundaries, every 6 ticks.
      if (tick % 6 !== 0) expect(changed).toBe(false);
    }
    expect(changes).toBeGreaterThan(0);
  });

  it("does nothing for steady styles", () => {
    const steady: LightStyleData = { step_time: 0.1, styles: { "0": { name: "Normal", pattern: "m" }, "10": { name: "Off", pattern: "aaa" } } };
    const image = new Uint8Array(atlas.width * atlas.height * 4);
    const animator = new LightStyleAnimator(bsp, atlas, steady, image, 60);
    expect(animator.animatedFaces).toEqual([]);
    expect(animator.update(60)).toBe(false);
  });
});
