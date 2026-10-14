import { describe, expect, it } from "vitest";
import { boxBrush, entityBox, withBrushes } from "@mandreljs/sim/collision/box";
import { DIST_EPSILON, trace } from "@mandreljs/sim/collision/trace";
import { CONTENTS } from "@mandreljs/sim/constants";
import { vec3 } from "@mandreljs/sim/math/vec3";
import { box, world } from "@mandreljs/sim/testing/worlds";

const HULL = { mins: vec3(-16, -16, -24), maxs: vec3(16, 16, 32) };

describe("entity boxes", () => {
  it("places an entity's hull at its origin", () => {
    const brush = entityBox(vec3(100, 50, 24), HULL, CONTENTS.MONSTER);
    expect([brush.mins, brush.maxs]).toEqual([vec3(84, 34, 0), vec3(116, 66, 56)]);
    expect(brush.contents).toBe(CONTENTS.MONSTER);
    expect(brush.planes).toHaveLength(6);
  });

  it("stops a box trace at its face, like a box brush", () => {
    const blocker = boxBrush(vec3(100, -16, 0), vec3(132, 16, 56), CONTENTS.MONSTER);
    const result = trace({ brushes: [blocker] }, vec3(0, 0, 24), vec3(200, 0, 24), HULL.mins, HULL.maxs, CONTENTS.MONSTER);
    expect(result.endpos.x).toBeCloseTo(100 - 16 - DIST_EPSILON, 10);
    expect(result.normal).toEqual(vec3(-1, 0, 0));
  });

  it("is ignored by masks without its contents", () => {
    const blocker = boxBrush(vec3(100, -16, 0), vec3(132, 16, 56), CONTENTS.MONSTER);
    expect(trace({ brushes: [blocker] }, vec3(0, 0, 24), vec3(200, 0, 24), HULL.mins, HULL.maxs, CONTENTS.SOLID).fraction).toBe(1);
  });

  it("adds brushes to a world without changing it", () => {
    const level = world(box([0, 0, 0], [8, 8, 8]));
    const extra = boxBrush(vec3(20, 0, 0), vec3(28, 8, 8), CONTENTS.MONSTER);
    expect(withBrushes(level, [extra]).brushes).toHaveLength(2);
    expect(level.brushes).toHaveLength(1);
    expect(withBrushes(level, [])).toBe(level);
  });
});
