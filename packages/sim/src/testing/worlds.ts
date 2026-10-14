// Small worlds built from boxes and ramps, for tests.

import { entityBox } from "../collision/box.ts";
import { buildBrush, type Brush } from "../collision/brush.ts";
import { CONTENTS } from "../constants.ts";
import type { Surroundings } from "../enemy/ai.ts";
import type { CollisionWorld } from "../collision/trace.ts";
import { cross, dot, sub, vec3, type Vec3 } from "../math/vec3.ts";
import type { MapFace } from "../map/parse.ts";

function face(points: readonly [Vec3, Vec3, Vec3], center: Vec3, contents: number): MapFace {
  let [p0, p1, p2] = points;
  // Order the points so the plane faces away from the brush center.
  if (dot(cross(sub(p0, p1), sub(p2, p1)), sub(p0, center)) < 0) [p0, p2] = [p2, p0];
  return {
    points: [p0, p1, p2], texture: "dev/grid_grey", projection: { kind: "standard", offset: [0, 0] },
    rotation: 0, scale: [1, 1], contents, surfaceFlags: 0, value: 0,
  };
}

function brushFrom(vertices: Vec3[], polygons: number[][], contents: number): Brush {
  const c = vec3(
    vertices.reduce((s, v) => s + v.x, 0) / vertices.length,
    vertices.reduce((s, v) => s + v.y, 0) / vertices.length,
    vertices.reduce((s, v) => s + v.z, 0) / vertices.length,
  );
  const faces = polygons.map((p) => face([vertices[p[0]!]!, vertices[p[1]!]!, vertices[p[2]!]!], c, contents));
  const brush = buildBrush(faces);
  if (!brush) throw new Error("test brush does not enclose a volume");
  return brush;
}

export function box(mins: [number, number, number], maxs: [number, number, number], contents = 0): Brush {
  const [x0, y0, z0] = mins;
  const [x1, y1, z1] = maxs;
  const v = [x0, x1].flatMap((x) => [y0, y1].flatMap((y) => [z0, z1].map((z) => vec3(x, y, z))));
  return brushFrom(v, [[0, 1, 3], [4, 5, 7], [0, 1, 5], [2, 3, 7], [0, 2, 6], [1, 3, 7]], contents);
}

/** A ramp along x whose top rises from height h0 at x0 to h1 at x1, over a flat bottom. */
export function rampX(x0: number, x1: number, y0: number, y1: number, bottom: number, h0: number, h1: number): Brush {
  const v = [
    vec3(x0, y0, bottom), vec3(x1, y0, bottom), vec3(x1, y1, bottom), vec3(x0, y1, bottom),
    vec3(x0, y0, h0), vec3(x0, y1, h0), vec3(x1, y0, h1), vec3(x1, y1, h1),
  ];
  return brushFrom(v, [[0, 1, 2], [0, 3, 5], [1, 2, 7], [0, 1, 6], [3, 2, 7], [4, 6, 7]], 0);
}

export const world = (...brushes: Brush[]): CollisionWorld => ({ brushes });

/** An enemy's surroundings in a world with no other entities, the player standing at origin (Quake's player hull and eye). */
export function surroundingsFor(level: CollisionWorld, playerOrigin: Vec3): Surroundings {
  const box = entityBox(playerOrigin, { mins: vec3(-16, -16, -24), maxs: vec3(16, 16, 32) }, CONTENTS.MONSTER);
  return {
    world: level,
    blockers: { brushes: [...level.brushes, box] },
    player: { id: 1, origin: playerOrigin, eye: vec3(playerOrigin.x, playerOrigin.y, playerOrigin.z + 22), mins: box.mins, maxs: box.maxs },
  };
}
