// Windings: the convex polygon a brush face occupies on its plane.
// Adapted from Quake's BaseWindingForPlane and ClipWinding (id Software, GPLv2 or later).

import { add, addScaled, component, cross, dot, normalize, scale, sub, vec3, type Vec3 } from "../math/vec3";
import { distanceTo, type Plane } from "./plane";

export type Winding = readonly Vec3[];

const BASE_WINDING_SIZE = 1 << 17; // far beyond any map coordinate

/** A huge square lying in the plane, to be clipped down to a face. */
export function baseWinding(plane: Plane): Winding {
  const n = plane.normal;
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  // Pick an "up" direction that isn't parallel to the normal.
  let up = az >= ax && az >= ay ? vec3(1, 0, 0) : vec3(0, 0, 1);
  up = normalize(addScaled(up, n, -dot(up, n)));
  const right = scale(cross(up, n), BASE_WINDING_SIZE);
  up = scale(up, BASE_WINDING_SIZE);
  const origin = scale(n, plane.dist);
  return [
    add(sub(origin, right), up),
    add(add(origin, right), up),
    sub(add(origin, right), up),
    sub(sub(origin, right), up),
  ];
}

/**
 * Keeps the part of the winding behind or on the plane. Returns null if nothing
 * remains. Points within epsilon of the plane count as on it.
 */
export function clipWindingBack(winding: Winding, plane: Plane, epsilon: number): Winding | null {
  const dists = winding.map((p) => distanceTo(plane, p));
  const sides = dists.map((d) => (d > epsilon ? 1 : d < -epsilon ? -1 : 0));
  if (!sides.includes(1)) return winding; // nothing in front
  if (!sides.includes(-1)) return null; // nothing behind

  const out: Vec3[] = [];
  for (let i = 0; i < winding.length; i++) {
    const p1 = winding[i]!;
    const side = sides[i]!;
    if (side === 0) {
      out.push(p1);
      continue;
    }
    if (side === -1) out.push(p1);
    const j = (i + 1) % winding.length;
    const nextSide = sides[j]!;
    if (nextSide === 0 || nextSide === side) continue;

    // The edge crosses the plane: add the crossing point, exact on axial planes.
    const p2 = winding[j]!;
    const t = dists[i]! / (dists[i]! - dists[j]!);
    const mid = [0, 1, 2].map((axis) => {
      const n = component(plane.normal, axis);
      if (n === 1) return plane.dist;
      if (n === -1) return 0 - plane.dist; // 0 - x, not -x, so zero stays +0
      return component(p1, axis) + t * (component(p2, axis) - component(p1, axis));
    });
    out.push(vec3(mid[0]!, mid[1]!, mid[2]!));
  }
  return out.length >= 3 ? out : null;
}
