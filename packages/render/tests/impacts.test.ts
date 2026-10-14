import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { toThree } from "@mandreljs/render/coords";
import { ImpactMarks } from "@mandreljs/render/impacts";
import { vec3 } from "@mandreljs/sim/math/vec3";

const visible = (marks: ImpactMarks): THREE.Mesh[] => marks.group.children.filter((c): c is THREE.Mesh => c.visible && c instanceof THREE.Mesh);
const opacity = (mesh: THREE.Mesh): number => (mesh.material as THREE.MeshBasicMaterial).opacity;

describe("ImpactMarks", () => {
  it("starts with no marks showing", () => {
    expect(visible(new ImpactMarks({ capacity: 4 }))).toHaveLength(0);
  });

  it("puts a mark at the hit point, lying on the surface", () => {
    const marks = new ImpactMarks({ capacity: 4 });
    const point = vec3(100, -50, 30);
    const normal = vec3(0, 1, 0); // a wall facing +y
    marks.add(point, normal, 0);
    const [mark] = visible(marks);
    expect(mark!.position.toArray()).toEqual(toThree(point));
    // A plane faces its local +z; turned onto the wall, that must point along the wall's normal.
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(mark!.quaternion);
    const want = new THREE.Vector3(...toThree(normal));
    expect(facing.distanceTo(want)).toBeLessThan(1e-9);
  });

  it("fades marks out over their lifetime, then hides them", () => {
    const marks = new ImpactMarks({ capacity: 4, lifetime: 2 });
    marks.add(vec3(0, 0, 0), vec3(0, 0, 1), 10);
    marks.update(11);
    expect(opacity(visible(marks)[0]!)).toBeCloseTo(0.5, 12);
    marks.update(12);
    expect(visible(marks)).toHaveLength(0);
  });

  it("reuses the oldest mark once all are showing", () => {
    const marks = new ImpactMarks({ capacity: 2 });
    marks.add(vec3(1, 0, 0), vec3(0, 0, 1), 0);
    marks.add(vec3(2, 0, 0), vec3(0, 0, 1), 0);
    marks.add(vec3(3, 0, 0), vec3(0, 0, 1), 0);
    expect(marks.group.children).toHaveLength(2);
    expect(visible(marks).map((m) => m.position.x).sort()).toEqual([2, 3]);
  });
});
