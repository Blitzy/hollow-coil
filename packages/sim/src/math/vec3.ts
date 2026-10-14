// Immutable 3D vectors as plain data, so sim state stays serializable.

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const ZERO: Vec3 = vec3(0, 0, 0);

export const add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);

export const sub = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);

export const scale = (a: Vec3, s: number): Vec3 => vec3(a.x * s, a.y * s, a.z * s);

/** a / s, dividing each component. Unlike scale(a, 1 / s), an axis-aligned a divided by its length is exactly a unit vector. */
export const divide = (a: Vec3, s: number): Vec3 => vec3(a.x / s, a.y / s, a.z / s);

/** a + b * s */
export const addScaled = (a: Vec3, b: Vec3, s: number): Vec3 => vec3(a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 =>
  vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

export const length = (a: Vec3): number => Math.sqrt(dot(a, a));

/** Unit vector in the direction of a, or ZERO if a has no length. */
export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  return len > 0 ? scale(a, 1 / len) : ZERO;
}

export const component = (a: Vec3, axis: number): number => (axis === 0 ? a.x : axis === 1 ? a.y : a.z);

/** The unit vector along an axis (0, 1, 2) in a direction (-1 or +1). */
export const axial = (axis: number, dir: number): Vec3 =>
  vec3(axis === 0 ? dir : 0, axis === 1 ? dir : 0, axis === 2 ? dir : 0);

export const equals = (a: Vec3, b: Vec3): boolean => a.x === b.x && a.y === b.y && a.z === b.z;
