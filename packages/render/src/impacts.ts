// Marks where shots hit: small squares that fade out, lying on a wall's surface,
// or facing the shooter where a shot hits an entity.
// Placeholder feedback for playtesting until real impact effects (M5). A fixed
// pool of marks is reused, oldest first, so constant firing allocates nothing.

import * as THREE from "three";
import { add, type Vec3 } from "@mandreljs/sim/math/vec3";
import { toThree } from "./coords.ts";

export interface ImpactOptions {
  /** How many marks can show at once; the oldest is reused past this. */
  readonly capacity: number;
  /** Seconds a mark takes to fade out. */
  readonly lifetime: number;
  /** Width of a mark in Quake units. */
  readonly size: number;
  readonly color: THREE.ColorRepresentation;
}

const DEFAULTS: ImpactOptions = { capacity: 64, lifetime: 1.5, size: 3, color: 0xffd080 };

interface Mark {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  born: number;
}

export class ImpactMarks {
  readonly group = new THREE.Group();
  private readonly marks: Mark[] = [];
  private next = 0;
  private readonly options: ImpactOptions;

  constructor(options: Partial<ImpactOptions> = {}) {
    this.options = { ...DEFAULTS, ...options };
    const geometry = new THREE.PlaneGeometry(this.options.size, this.options.size);
    for (let i = 0; i < this.options.capacity; i++) {
      // Drawn just in front of the surface (shots stop 1/32 short of it), and pulled
      // further forward in depth so it never flickers into the wall.
      const material = new THREE.MeshBasicMaterial({
        color: this.options.color,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.marks.push({ mesh, born: 0 });
    }
  }

  /** Adds a mark at a hit point (sim coordinates), lying on the surface with this normal, at time now (seconds). */
  add(point: Vec3, normal: Vec3, now: number): void {
    const mark = this.marks[this.next]!;
    this.next = (this.next + 1) % this.marks.length;
    mark.mesh.position.set(...toThree(point));
    mark.mesh.lookAt(...toThree(add(point, normal))); // a plane faces its +z, here along the normal
    mark.mesh.material.opacity = 1;
    mark.mesh.visible = true;
    mark.born = now;
  }

  /** Hides every mark, such as when the level starts over. */
  clear(): void {
    for (const { mesh } of this.marks) mesh.visible = false;
  }

  /** Fades marks by age and hides the ones that have faded out. Call once a frame. */
  update(now: number): void {
    for (const { mesh, born } of this.marks) {
      if (!mesh.visible) continue;
      const fade = 1 - (now - born) / this.options.lifetime;
      mesh.visible = fade > 0;
      mesh.material.opacity = Math.max(0, fade);
    }
  }
}
