import { describe, expect, it } from "vitest";
import { vec3 } from "@mandreljs/sim/math/vec3";
import { DamageView } from "../../src/game/damage-view.ts";

const ORIGIN = vec3(0, 0, 0);
const DEGREES = Math.PI / 180;

describe("DamageView", () => {
  it("shows nothing until hurt", () => {
    const view = new DamageView();
    expect(view.flash).toBe(0);
    expect(view.pitch).toBeCloseTo(0, 12);
    expect(view.roll).toBeCloseTo(0, 12);
  });

  it("flashes more for bigger hits, counting at least 10 (Quake's V_ParseDamage)", () => {
    const small = new DamageView();
    small.hurt(4, ORIGIN, 0, null); // counts as 10: a shift of 30
    expect(small.flash).toBeCloseTo(30 / 255, 12);
    const big = new DamageView();
    big.hurt(40, ORIGIN, 0, null); // counts as 20: a shift of 60
    expect(big.flash).toBeCloseTo(60 / 255, 12);
  });

  it("adds up hits, to at most a shift of 150", () => {
    const view = new DamageView();
    for (let i = 0; i < 10; i++) view.hurt(40, ORIGIN, 0, null);
    expect(view.flash).toBeCloseTo(150 / 255, 12);
  });

  it("fades the flash 150 a second", () => {
    const view = new DamageView();
    view.hurt(40, ORIGIN, 0, null);
    view.update(0.2);
    expect(view.flash).toBeCloseTo(30 / 255, 12);
    view.update(1);
    expect(view.flash).toBe(0);
  });

  it("dips the view for a shot from in front, fading over half a second", () => {
    const view = new DamageView();
    view.hurt(4, ORIGIN, 0, vec3(100, 0, 0)); // facing +x, shot from +x
    expect(view.pitch).toBeCloseTo(-6 * DEGREES, 12); // count 10 * 0.6 degrees, looking down
    expect(view.roll).toBeCloseTo(0, 12);
    view.update(0.25);
    expect(view.pitch).toBeCloseTo(-3 * DEGREES, 12);
    view.update(0.25);
    expect(view.pitch).toBeCloseTo(0, 12);
  });

  it("tilts toward a shot from the side", () => {
    const right = new DamageView();
    right.hurt(4, ORIGIN, 0, vec3(0, -100, 0)); // facing +x, so -y is on the right
    expect(right.roll).toBeCloseTo(6 * DEGREES, 12);
    expect(right.pitch).toBeCloseTo(0, 12);
    const left = new DamageView();
    left.hurt(4, ORIGIN, Math.PI / 2, vec3(-100, 0, 0)); // facing +y, so -x is on the left
    expect(left.roll).toBeCloseTo(-6 * DEGREES, 12);
  });

  it("forgets everything on reset", () => {
    const view = new DamageView();
    view.hurt(40, ORIGIN, 0, vec3(100, 0, 0));
    view.reset();
    expect(view.flash).toBe(0);
    expect(view.pitch).toBeCloseTo(0, 12);
  });
});
