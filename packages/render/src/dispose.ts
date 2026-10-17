// Frees what a tree of Three.js objects holds on the GPU (geometry, materials,
// and their textures), for a level being replaced by another.

import * as THREE from "three";

/** Disposes every geometry, material, and texture (a material's own or a shader uniform's) under object, which it removes from its parent. */
export function disposeTree(object: THREE.Object3D): void {
  object.removeFromParent();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.LineSegments)) return;
    child.geometry.dispose();
    for (const material of [child.material].flat() as THREE.Material[]) {
      const values = material instanceof THREE.ShaderMaterial ? Object.values(material.uniforms).map((u) => u.value as unknown) : Object.values(material);
      for (const value of values) if (value instanceof THREE.Texture) value.dispose();
      material.dispose();
    }
  });
}
