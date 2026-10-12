import { describe, expect, it } from "vitest";
import type { MapFace } from "../sim/map/parse";
import { vec3 } from "../sim/math/vec3";
import { cameraRotation, toThree, verticalFov } from "./coords";
import { faceShade } from "./level-mesh";
import { texelCoords, textureAxes } from "./uv";

const face = (overrides: Partial<MapFace>): MapFace => ({
  points: [vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 1, 0)],
  texture: "dev/grid_grey",
  projection: { kind: "standard", offset: [0, 0] },
  rotation: 0,
  scale: [1, 1],
  contents: 0,
  surfaceFlags: 0,
  value: 0,
  ...overrides,
});
const UP = vec3(0, 0, 1);

describe("coordinates", () => {
  it("maps Quake z-up to Three y-up", () => {
    expect(toThree(vec3(1, 2, 3))).toEqual([1, 3, -2]);
  });

  it("points the camera along the Quake yaw", () => {
    // A Three camera looks down -Z; rotating by y turns that to (-sin y, 0, -cos y).
    const look = (yaw: number) => {
      const r = cameraRotation(yaw, 0).y;
      return [-Math.sin(r), -Math.cos(r)];
    };
    const [x0, z0] = look(0); // Quake +x is Three +X
    expect(x0).toBeCloseTo(1, 10);
    expect(z0).toBeCloseTo(0, 10);
    const [x90, z90] = look(Math.PI / 2); // Quake +y is Three -Z
    expect(x90).toBeCloseTo(0, 10);
    expect(z90).toBeCloseTo(-1, 10);
  });

  it("converts horizontal field of view to vertical", () => {
    expect(verticalFov(90, 1)).toBeCloseTo(90, 10);
    expect(verticalFov(90, 4 / 3)).toBeCloseTo(73.74, 2); // Quake's classic 90 at 4:3
  });
});

describe("texture coordinates", () => {
  it("uses Valve 220 axes, offsets, and scale", () => {
    const valve = face({ projection: { kind: "valve", u: [1, 0, 0, 8], v: [0, -1, 0, 4] }, scale: [2, 0.5] });
    expect(texelCoords(textureAxes(valve, UP), vec3(16, 32, 0))).toEqual([16 / 2 + 8, -32 / 0.5 + 4]);
  });

  it("derives standard-format axes from the face normal", () => {
    const floor = face({ projection: { kind: "standard", offset: [8, 4] }, scale: [2, 1] });
    expect(texelCoords(textureAxes(floor, UP), vec3(16, 32, 0))).toEqual([16 / 2 + 8, -32 + 4]);
    const eastWall = textureAxes(face({}), vec3(1, 0, 0));
    expect(texelCoords(eastWall, vec3(64, 16, 48))).toEqual([16, -48]);
  });

  it("rotates standard-format axes, exactly for right angles", () => {
    const rotated = textureAxes(face({ rotation: 90 }), UP);
    expect(rotated.s).toEqual(vec3(0, 1, 0));
    expect(rotated.t).toEqual(vec3(1, 0, 0));
  });
});

describe("face shading", () => {
  it("lights floors most and ceilings least", () => {
    expect(faceShade(vec3(0, 0, 1))).toBeGreaterThan(faceShade(vec3(1, 0, 0)));
    expect(faceShade(vec3(1, 0, 0))).toBeGreaterThan(faceShade(vec3(0, 0, -1)));
  });
});
