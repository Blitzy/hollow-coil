// Placeholder enemies until real models (M5): a box the size of each enemy's
// hull, colored by what it's doing, with a small block at eye height on the
// side it faces. The dead lie flat. Positions are interpolated between ticks.

import * as THREE from "three";
import type { Hull } from "@mandreljs/sim/data";
import type { EnemyMode, EnemyState } from "@mandreljs/sim/enemy/enemy";
import { angleToRadians } from "@mandreljs/sim/input";
import { vec3, type Vec3 } from "@mandreljs/sim/math/vec3";
import { toThree } from "./coords.ts";

export const MODE_COLORS: Readonly<Record<EnemyMode, number>> = {
  idle: 0x8c8c8c,
  chase: 0xe07020,
  attack: 0xe02020,
  pain: 0xffffff,
  dead: 0x3a1c1c,
};

/** How tall a dead enemy's flattened box is, in Quake units. */
export const CORPSE_HEIGHT = 6;
const NOSE_SIZE = 8;

export interface EnemyLook {
  readonly hull: Hull;
  readonly eyeHeight: number;
}

interface Figure {
  /** At the enemy's origin, turned to its facing. */
  readonly root: THREE.Group;
  readonly body: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  readonly nose: THREE.Mesh;
  readonly look: EnemyLook;
}

/** Angle units to radians, along the shorter way from a to b, a fraction t of the way. */
function lerpYaw(a: number, b: number, t: number): number {
  const turn = 65536;
  const delta = ((((b - a) % turn) + turn * 1.5) % turn) - turn / 2;
  return angleToRadians(a + delta * t);
}

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);

export class EnemyFigures {
  readonly group = new THREE.Group();
  private readonly figures = new Map<number, Figure>();
  private readonly looks: ReadonlyMap<string, EnemyLook>;
  private readonly noseGeometry = new THREE.BoxGeometry(NOSE_SIZE, NOSE_SIZE, NOSE_SIZE);
  private readonly noseMaterial = new THREE.MeshBasicMaterial({ color: 0x202020 });

  /** looks: each enemy type's hull and eye height. */
  constructor(looks: ReadonlyMap<string, EnemyLook>) {
    this.looks = looks;
  }

  private figure(enemy: EnemyState): Figure {
    const existing = this.figures.get(enemy.id);
    if (existing) return existing;
    const look = this.looks.get(enemy.type)!;
    const { mins, maxs } = look.hull;
    // Box sizes in Three's axes: Quake x, z, y.
    const body = new THREE.Mesh(new THREE.BoxGeometry(maxs.x - mins.x, maxs.z - mins.z, maxs.y - mins.y), new THREE.MeshBasicMaterial());
    body.add(new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), new THREE.LineBasicMaterial({ color: 0x000000 })));
    const nose = new THREE.Mesh(this.noseGeometry, this.noseMaterial);
    nose.position.set(...toThree(vec3(maxs.x, 0, look.eyeHeight)));
    const root = new THREE.Group();
    root.add(body, nose);
    this.group.add(root);
    const figure = { root, body, nose, look };
    this.figures.set(enemy.id, figure);
    return figure;
  }

  /** Shows each enemy between its state at the previous tick and the current one (alpha 0 to 1). */
  update(previous: readonly EnemyState[], current: readonly EnemyState[], alpha: number): void {
    for (const enemy of current) {
      const before = previous.find((e) => e.id === enemy.id) ?? enemy;
      const { root, body, nose, look } = this.figure(enemy);
      const { mins, maxs } = look.hull;
      root.position.set(...toThree(lerp(before.origin, enemy.origin, alpha)));
      root.rotation.y = lerpYaw(before.yaw, enemy.yaw, alpha); // Quake yaw turns about Three's +y the same way
      const dead = enemy.mode === "dead";
      const height = dead ? CORPSE_HEIGHT : maxs.z - mins.z;
      body.scale.y = height / (maxs.z - mins.z);
      body.position.set(...toThree(vec3((mins.x + maxs.x) / 2, (mins.y + maxs.y) / 2, mins.z + height / 2)));
      body.material.color.setHex(MODE_COLORS[enemy.mode]);
      nose.visible = !dead;
    }
  }
}
