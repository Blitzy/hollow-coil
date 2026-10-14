// Texture coordinates for .map faces, matching how qbsp and TrenchBroom project
// textures. Valve 220 faces carry their axes; standard faces derive them from the
// face normal, then apply rotation. Adapted from ericw-tools qbsp/map.cc and
// Quake's TextureAxisFromPlane (GPLv2 or later).

import type { MapFace } from "@mandreljs/sim/map/parse";
import { dot, vec3, type Vec3 } from "@mandreljs/sim/math/vec3";

export interface TextureAxes {
  /** Texels per unit along each axis already include the face's scale. */
  readonly s: Vec3;
  readonly t: Vec3;
  readonly sOffset: number;
  readonly tOffset: number;
}

// Quake's base axes: (normal, s axis, t axis), chosen by the face normal.
const BASE_AXES: readonly [Vec3, Vec3, Vec3][] = [
  [vec3(0, 0, 1), vec3(1, 0, 0), vec3(0, -1, 0)],
  [vec3(0, 0, -1), vec3(1, 0, 0), vec3(0, -1, 0)],
  [vec3(1, 0, 0), vec3(0, 1, 0), vec3(0, 0, -1)],
  [vec3(-1, 0, 0), vec3(0, 1, 0), vec3(0, 0, -1)],
  [vec3(0, 1, 0), vec3(1, 0, 0), vec3(0, 0, -1)],
  [vec3(0, -1, 0), vec3(1, 0, 0), vec3(0, 0, -1)],
];

const nonZeroAxis = (v: Vec3): number => (v.x !== 0 ? 0 : v.y !== 0 ? 1 : 2);

function withComponent(v: Vec3, axis: number, value: number): Vec3 {
  return vec3(axis === 0 ? value : v.x, axis === 1 ? value : v.y, axis === 2 ? value : v.z);
}

function standardAxes(face: MapFace, normal: Vec3, offset: readonly [number, number]): TextureAxes {
  let best = 0;
  let bestDot = 0;
  BASE_AXES.forEach(([n], i) => {
    const d = dot(normal, n);
    if (d > bestDot) {
      bestDot = d;
      best = i;
    }
  });
  let [, s, t] = BASE_AXES[best]!;

  // Rotate both axes in their plane, with exact values for right angles.
  const r = face.rotation;
  const [sin, cos] =
    r === 0 ? [0, 1] : r === 90 ? [1, 0] : r === 180 ? [0, -1] : r === 270 ? [-1, 0] : [Math.sin((r * Math.PI) / 180), Math.cos((r * Math.PI) / 180)];
  const sv = nonZeroAxis(s);
  const tv = nonZeroAxis(t);
  const rotate = (v: Vec3): Vec3 => {
    const a = [v.x, v.y, v.z];
    return withComponent(withComponent(v, sv, cos * a[sv]! - sin * a[tv]!), tv, sin * a[sv]! + cos * a[tv]!);
  };
  s = rotate(s);
  t = rotate(t);

  const sx = face.scale[0] || 1;
  const sy = face.scale[1] || 1;
  return { s: vec3(s.x / sx, s.y / sx, s.z / sx), t: vec3(t.x / sy, t.y / sy, t.z / sy), sOffset: offset[0], tOffset: offset[1] };
}

export function textureAxes(face: MapFace, normal: Vec3): TextureAxes {
  const p = face.projection;
  if (p.kind === "standard") return standardAxes(face, normal, p.offset);
  const sx = face.scale[0] || 1;
  const sy = face.scale[1] || 1;
  return {
    s: vec3(p.u[0] / sx, p.u[1] / sx, p.u[2] / sx),
    t: vec3(p.v[0] / sy, p.v[1] / sy, p.v[2] / sy),
    sOffset: p.u[3],
    tOffset: p.v[3],
  };
}

/** Texture coordinates in texels for a point; divide by the texture size for UVs (t increases downward in the image). */
export const texelCoords = (axes: TextureAxes, p: Vec3): [number, number] => [dot(p, axes.s) + axes.sOffset, dot(p, axes.t) + axes.tOffset];
