// Brushes built from .map faces: planes, face windings, bounds, contents, and
// the bevel planes qbsp adds, so .map collision matches .bsp collision.
// See docs/MOVEMENT.md, "Brushes from a .map".

import { CONTENTS } from "../constants.ts";
import { axial, component, cross, length, scale, sub, vec3, dot, type Vec3 } from "../math/vec3.ts";
import type { MapFace } from "../map/parse.ts";
import { planeFromPoints, type Plane } from "./plane.ts";
import { baseWinding, clipWindingBack, type Winding } from "./winding.ts";

export interface BrushFace {
  readonly plane: Plane;
  readonly winding: Winding;
  readonly source: MapFace;
}

export interface Brush {
  /** Every plane used for collision: the faces' planes plus bevels. */
  readonly planes: readonly Plane[];
  /** The visible faces, with windings, for rendering. Bevels have no face. */
  readonly faces: readonly BrushFace[];
  readonly contents: number;
  readonly mins: Vec3;
  readonly maxs: Vec3;
}

// Tolerances from ericw-tools (mathlib.hh and qbsp's epsilon setting).
const NORMAL_EPSILON = 1e-6;
const DIST_EPSILON = 1e-4;
const POINT_EPSILON = 1e-4;
const MIN_EDGE_LENGTH = 0.5;

const planesEqual = (a: Plane, b: Plane): boolean =>
  Math.abs(a.normal.x - b.normal.x) < NORMAL_EPSILON &&
  Math.abs(a.normal.y - b.normal.y) < NORMAL_EPSILON &&
  Math.abs(a.normal.z - b.normal.z) < NORMAL_EPSILON &&
  Math.abs(a.dist - b.dist) < DIST_EPSILON;

/** Snaps a unit vector to exactly axial if it is within epsilon of an axis. */
function snapToAxis(v: Vec3): Vec3 {
  for (let axis = 0; axis < 3; axis++) {
    const c = component(v, axis);
    if (Math.abs(c - 1) < NORMAL_EPSILON) return axial(axis, 1);
    if (Math.abs(c + 1) < NORMAL_EPSILON) return axial(axis, -1);
  }
  return v;
}

const isAxial = (v: Vec3): boolean => [v.x, v.y, v.z].some((c) => c === 1 || c === -1);

/**
 * Builds a brush from its .map faces, or returns null if the faces don't
 * enclose a volume. Bevels adapted from ericw-tools 2.0.0-alpha11
 * qbsp/map.cc AddBrushBevels (GPLv2 or later).
 */
export function buildBrush(mapFaces: readonly MapFace[]): Brush | null {
  // Planes from points, dropping degenerate faces and exact duplicates.
  const candidates: { plane: Plane; source: MapFace }[] = [];
  for (const source of mapFaces) {
    const plane = planeFromPoints(...source.points);
    if (plane && !candidates.some((c) => planesEqual(c.plane, plane))) candidates.push({ plane, source });
  }

  // Windings: clip each face's plane by every other plane. Faces that clip away are redundant.
  const faces: BrushFace[] = [];
  for (const { plane, source } of candidates) {
    let w: Winding | null = baseWinding(plane);
    for (const other of candidates) {
      if (other.plane === plane || !w) continue;
      w = clipWindingBack(w, other.plane, 0);
    }
    if (w) faces.push({ plane, winding: w, source });
  }
  if (faces.length < 4) return null;

  let mins = vec3(Infinity, Infinity, Infinity);
  let maxs = vec3(-Infinity, -Infinity, -Infinity);
  for (const { winding } of faces) {
    for (const p of winding) {
      mins = vec3(Math.min(mins.x, p.x), Math.min(mins.y, p.y), Math.min(mins.z, p.z));
      maxs = vec3(Math.max(maxs.x, p.x), Math.max(maxs.y, p.y), Math.max(maxs.z, p.z));
    }
  }

  const planes: Plane[] = faces.map((f) => f.plane);
  const windings: (Winding | null)[] = faces.map((f) => f.winding);

  // Axial bevels: any axis direction no face already covers, placed at the bounds.
  for (let axis = 0; axis < 3; axis++) {
    for (const dir of [-1, 1]) {
      if (planes.some((p) => component(p.normal, axis) === dir)) continue;
      planes.push({ normal: axial(axis, dir), dist: dir === 1 ? component(maxs, axis) : 0 - component(mins, axis) });
      windings.push(null);
    }
  }

  // Edge bevels, for brushes that aren't pure boxes.
  if (planes.length !== 6) {
    for (let i = 0; i < faces.length; i++) {
      const face = faces[i]!;
      if (isAxial(face.plane.normal)) continue;
      const w = face.winding;
      for (let j = 0; j < w.length; j++) {
        const edge = sub(w[j]!, w[(j + 1) % w.length]!);
        const edgeLength = length(edge);
        if (edgeLength < MIN_EDGE_LENGTH) continue;
        const vec = snapToAxis(scale(edge, 1 / edgeLength));
        if (isAxial(vec)) continue;

        for (let axis = 0; axis < 3; axis++) {
          for (const dir of [-1, 1]) {
            const n = cross(vec, axial(axis, dir));
            const nLength = length(n);
            if (nLength < NORMAL_EPSILON) continue; // edge nearly parallel to this axis
            const normal = scale(n, 1 / nLength);
            const candidate: Plane = { normal, dist: dot(w[j]!, normal) };

            // A proper bevel is new and has every point of the brush behind it.
            const rejected = planes.some(
              (p, k) =>
                planesEqual(p, candidate) ||
                (windings[k]?.some((q) => dot(q, normal) - candidate.dist > POINT_EPSILON) ?? false),
            );
            if (rejected) continue;
            planes.push(candidate);
            windings.push(null);
          }
        }
      }
    }
  }

  const faceContents = faces.reduce((bits, f) => bits | f.source.contents, 0);
  return { planes, faces, contents: faceContents === 0 ? CONTENTS.SOLID : faceContents, mins, maxs };
}
