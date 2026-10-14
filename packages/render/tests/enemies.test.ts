import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { toThree } from "@mandreljs/render/coords";
import { CORPSE_HEIGHT, EnemyFigures, MODE_COLORS } from "@mandreljs/render/enemies";
import type { EnemyState } from "@mandreljs/sim/enemy/enemy";
import { degreesToUnits } from "@mandreljs/sim/input";
import { vec3, type Vec3 } from "@mandreljs/sim/math/vec3";

const HULL = { mins: vec3(-16, -16, -24), maxs: vec3(16, 16, 32) };
const looks = new Map([["shotgunner", { hull: HULL, eyeHeight: 22 }]]);

const enemy = (overrides: Partial<EnemyState> = {}): EnemyState => ({
  id: 2, type: "shotgunner", origin: vec3(100, 0, 24), yaw: 0, idealYaw: 0, moving: false, health: 40, mode: "idle",
  nextThink: 1, target: 0, oldTarget: 0, attackReadyAt: 0, painUntil: 0, fireAt: 0, ...overrides,
});

/** The figure's body and facing block, after an update. */
function shown(figures: EnemyFigures): { root: THREE.Object3D; body: THREE.Mesh; nose: THREE.Mesh } {
  const root = figures.group.children[0]!;
  const [body, nose] = root.children as [THREE.Mesh, THREE.Mesh];
  root.updateMatrixWorld(true);
  return { root, body, nose };
}

const worldPosition = (o: THREE.Object3D): Vec3 => {
  const p = o.getWorldPosition(new THREE.Vector3());
  return vec3(p.x, -p.z, p.y); // back to Quake axes
};

describe("EnemyFigures", () => {
  it("makes one figure per enemy and keeps it across updates", () => {
    const figures = new EnemyFigures(looks);
    figures.update([], [enemy(), enemy({ id: 3 })], 0);
    figures.update([enemy(), enemy({ id: 3 })], [enemy(), enemy({ id: 3 })], 1);
    expect(figures.group.children).toHaveLength(2);
  });

  it("stands the hull-sized box on the enemy's origin", () => {
    const figures = new EnemyFigures(looks);
    figures.update([], [enemy()], 0);
    const { root, body } = shown(figures);
    expect(root.position.toArray()).toEqual(toThree(vec3(100, 0, 24)));
    const bounds = new THREE.Box3().setFromObject(body);
    expect(bounds.min.y).toBeCloseTo(0, 9); // feet at origin.z + mins.z
    expect(bounds.max.y).toBeCloseTo(56, 9);
  });

  it("moves between the previous and current tick's positions", () => {
    const figures = new EnemyFigures(looks);
    figures.update([enemy({ origin: vec3(100, 0, 24) })], [enemy({ origin: vec3(110, 0, 24) })], 0.25);
    expect(shown(figures).root.position.x).toBeCloseTo(102.5, 9);
  });

  it("puts the facing block on the side it faces, at eye height", () => {
    const figures = new EnemyFigures(looks);
    figures.update([], [enemy({ yaw: degreesToUnits(90) })], 0); // facing +y
    const nose = worldPosition(shown(figures).nose);
    expect(nose.x).toBeCloseTo(100, 9);
    expect(nose.y).toBeCloseTo(16, 9);
    expect(nose.z).toBeCloseTo(24 + 22, 9);
  });

  it("turns the short way between ticks", () => {
    const figures = new EnemyFigures(looks);
    figures.update([enemy({ yaw: degreesToUnits(350) })], [enemy({ yaw: degreesToUnits(10) })], 0.5);
    const nose = worldPosition(shown(figures).nose);
    expect(nose.x).toBeCloseTo(116, 6); // facing +x at the halfway point, not swung round through 180
  });

  it("colors the box by mode", () => {
    const figures = new EnemyFigures(looks);
    for (const mode of ["idle", "chase", "attack", "pain"] as const) {
      figures.update([], [enemy({ mode })], 0);
      expect((shown(figures).body.material as THREE.MeshBasicMaterial).color.getHex()).toBe(MODE_COLORS[mode]);
    }
  });

  it("lays the dead flat, without a facing block", () => {
    const figures = new EnemyFigures(looks);
    figures.update([], [enemy({ mode: "dead" })], 0);
    const { body, nose } = shown(figures);
    const bounds = new THREE.Box3().setFromObject(body);
    expect(bounds.max.y - bounds.min.y).toBeCloseTo(CORPSE_HEIGHT, 9);
    expect(bounds.min.y).toBeCloseTo(0, 9);
    expect(nose.visible).toBe(false);
  });
});
