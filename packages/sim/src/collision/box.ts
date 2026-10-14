// Entities in the collision world: an entity's box is a brush with six axial
// planes, so traces collide with it exactly as with a box-shaped brush.

import { axial, vec3, type Vec3 } from "../math/vec3.ts";
import type { CollisionBrush, CollisionWorld } from "./trace.ts";

/** The box from mins to maxs (world space) as a brush with the given contents. */
export function boxBrush(mins: Vec3, maxs: Vec3, contents: number): CollisionBrush {
  return {
    planes: [
      { normal: axial(0, 1), dist: maxs.x },
      { normal: axial(0, -1), dist: 0 - mins.x },
      { normal: axial(1, 1), dist: maxs.y },
      { normal: axial(1, -1), dist: 0 - mins.y },
      { normal: axial(2, 1), dist: maxs.z },
      { normal: axial(2, -1), dist: 0 - mins.z },
    ],
    contents,
    mins,
    maxs,
  };
}

/** An entity's box at origin, from its hull. */
export const entityBox = (origin: Vec3, hull: { readonly mins: Vec3; readonly maxs: Vec3 }, contents: number): CollisionBrush =>
  boxBrush(
    vec3(origin.x + hull.mins.x, origin.y + hull.mins.y, origin.z + hull.mins.z),
    vec3(origin.x + hull.maxs.x, origin.y + hull.maxs.y, origin.z + hull.maxs.z),
    contents,
  );

/** The world with extra brushes (such as entity boxes) added for this tick. */
export const withBrushes = (world: CollisionWorld, brushes: readonly CollisionBrush[]): CollisionWorld =>
  brushes.length === 0 ? world : { brushes: [...world.brushes, ...brushes] };
