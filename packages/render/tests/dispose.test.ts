import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { disposeTree } from "@mandreljs/render/dispose";

describe("disposeTree", () => {
  it("frees every geometry, material, and texture under an object, and takes it out of the scene", () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    scene.add(group);
    const map = new THREE.Texture();
    const lightmap = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const basic = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ map }));
    const shader = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial({ uniforms: { lightmap: { value: lightmap }, brightness: { value: 1 } } }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(basic.geometry), new THREE.LineBasicMaterial());
    basic.add(edges);
    group.add(basic, shader);

    const disposed: unknown[] = [];
    for (const thing of [basic.geometry, basic.material, map, shader.geometry, shader.material, lightmap, edges.geometry, edges.material]) {
      thing.addEventListener("dispose", () => disposed.push(thing));
    }
    disposeTree(group);
    expect(disposed).toHaveLength(8);
    expect(scene.children).toEqual([]);
  });
});
