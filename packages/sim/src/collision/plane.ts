import { cross, divide, dot, length, sub, type Vec3 } from "../math/vec3.ts";

/** A plane with a unit normal pointing out of the brush. Points with dot(p, normal) - dist > 0 are in front (outside). */
export interface Plane {
  readonly normal: Vec3;
  readonly dist: number;
}

/**
 * The plane through three .map face points.
 * Adapted from ericw-tools qbsp/map.cc mapface_t::set_planepts (GPLv2 or later).
 */
export function planeFromPoints(p0: Vec3, p1: Vec3, p2: Vec3): Plane | null {
  const n = cross(sub(p0, p1), sub(p2, p1));
  const len = length(n);
  if (len < 1e-6) return null; // the points are collinear
  const normal = divide(n, len); // dividing keeps axial normals exact, as qbsp does
  return { normal, dist: dot(p1, normal) };
}

export const distanceTo = (plane: Plane, p: Vec3): number => dot(p, plane.normal) - plane.dist;
