import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "@mandreljs/tools/testing";
import * as trig from "@mandreljs/sim/math/trig";

/** How many representable doubles apart two finite doubles are. */
function ulps(a: number, b: number): number {
  const view = new DataView(new ArrayBuffer(8));
  const ordered = (x: number): bigint => {
    view.setFloat64(0, x);
    const raw = view.getBigInt64(0);
    return raw < 0n ? -(raw & 0x7fffffffffffffffn) : raw;
  };
  const d = ordered(a) - ordered(b);
  return Number(d < 0n ? -d : d);
}

describe("trig", () => {
  // Exact outputs, to the last bit, that every engine (and any port of the sim) must
  // reproduce. The first few were where Chrome's and Node's Math.sin, cos, tan, and atan2 differ.
  it.each([
    ["sin", [1.864457773875754], 0.9571904557173803],
    ["sin", [0.5], 0.479425538604203],
    ["sin", [-3], -0.1411200080598672],
    ["sin", [100], -0.5063656411097588],
    ["cos", [1.864457773875754], -0.2894588597427168],
    ["cos", [0.5], 0.8775825618903728],
    ["cos", [2.389730390161276], -0.7304182099159764],
    ["cos", [-100], 0.8623188722876839],
    ["tan", [0.1], 0.10033467208545055],
    ["tan", [-0.702188148163259], -0.8460358224294979],
    ["atan2", [1, 1], 0.7853981633974483],
    ["atan2", [-17.82346696127206, -10.517256334424019], -2.10388915135616],
    ["atan2", [34.9941763561219, -4.800649383105338], 1.7071295722169502],
    ["atan2", [0, -1], 3.141592653589793],
    ["hypot", [3, 4], 5],
    ["hypot", [0.1, 0.2], 0.223606797749979],
  ] as const)("%s(%j) is exactly %d", (fn, args, expected) => {
    expect((trig[fn] as (...a: number[]) => number)(...args)).toBe(expected);
  });

  it("is as accurate as the platform's Math", () => {
    let seed = 1;
    const rand = (): number => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
    const worst = { sin: 0, cos: 0, tan: 0, atan2: 0 };
    for (const range of [1e-6, 1, Math.PI, 100, 1e5]) {
      for (let i = 0; i < 5000; i++) {
        const a = (rand() - 0.5) * 2 * range;
        const b = (rand() - 0.5) * 2 * range;
        worst.sin = Math.max(worst.sin, ulps(trig.sin(a), Math.sin(a)));
        worst.cos = Math.max(worst.cos, ulps(trig.cos(a), Math.cos(a)));
        worst.tan = Math.max(worst.tan, ulps(trig.tan(a), Math.tan(a)));
        worst.atan2 = Math.max(worst.atan2, ulps(trig.atan2(a, b), Math.atan2(a, b)));
      }
    }
    // Both are within an ulp or so of the true value, so they agree to within a few.
    expect(worst).toEqual({ sin: expect.toBeOneOf([0, 1]), cos: expect.toBeOneOf([0, 1]), tan: expect.toBeOneOf([0, 1, 2, 3]), atan2: expect.toBeOneOf([0, 1]) });
  });

  it("handles signed zeros, infinities, NaN, and huge arguments", () => {
    expect(Object.is(trig.sin(-0), -0)).toBe(true);
    expect(trig.cos(0)).toBe(1);
    expect(trig.sin(Infinity)).toBeNaN();
    expect(trig.atan2(NaN, 1)).toBeNaN();
    expect(trig.atan2(0, -0)).toBe(Math.PI);
    expect(Object.is(trig.atan2(-0, 1), -0)).toBe(true);
    expect(trig.atan2(1, 0)).toBe(Math.PI / 2);
    expect(trig.atan2(Infinity, -Infinity)).toBe((3 * Math.PI) / 4);
    for (const x of [1e10, -1e300]) expect(Math.abs(trig.sin(x)) <= 1 && Math.abs(trig.cos(x)) <= 1).toBe(true);
  });
});

describe("sim code", () => {
  it("uses only the Math functions JavaScript computes exactly everywhere, and trig.ts for the rest", () => {
    // Math.sin, cos, tan, atan2, hypot, exp, pow, and the like may differ in the last bit between engines; see trig.ts.
    const exact = new Set(["abs", "floor", "ceil", "round", "trunc", "sign", "min", "max", "sqrt", "fround", "imul", "clz32", "PI"]);
    const src = join(REPO_ROOT, "packages", "sim", "src");
    const files = (readdirSync(src, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts") && !f.endsWith("trig.ts"));
    const found = files.flatMap((file) =>
      [...readFileSync(join(src, file), "utf-8").matchAll(/Math\.(\w+)/g)].filter(([, name]) => !exact.has(name!)).map(([call]) => `${file}: ${call}`),
    );
    expect(found).toEqual([]);
  });
});
