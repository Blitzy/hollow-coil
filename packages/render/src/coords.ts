// Quake is Z-up; Three.js is Y-up. Everything crosses between them here.
// The mapping (x, y, z) -> (x, z, -y) is a rotation, so triangle winding is preserved.

import type { Vec3 } from "@hollow-coil/sim/math/vec3";

export const toThree = (v: Vec3): [number, number, number] => [v.x, v.z, -v.y];

/**
 * Camera Euler angles (order "YXZ") for a Quake view direction. A Three camera
 * looks down -Z, which is Quake's +y (yaw 90 degrees), so yaw is offset by a quarter turn.
 */
export const cameraRotation = (yawRadians: number, pitchRadians: number): { x: number; y: number } => ({
  x: pitchRadians,
  y: yawRadians - Math.PI / 2,
});

/** Vertical field of view in degrees that gives the horizontal one at this aspect ratio. */
export const verticalFov = (horizontalDegrees: number, aspect: number): number =>
  (2 * Math.atan(Math.tan((horizontalDegrees * Math.PI) / 360) / aspect) * 180) / Math.PI;
