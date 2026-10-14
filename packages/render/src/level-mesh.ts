// Three.js meshes for a level's world brushes from a .map: one mesh per texture.
// This is the unlit fallback when no compiled .bsp is available (see bsp-mesh.ts);
// faces get a flat shade by direction so shapes read clearly.

import * as THREE from "three";
import type { MapLevel } from "@mandreljs/sim/level";
import { cross, dot, sub, type Vec3 } from "@mandreljs/sim/math/vec3";
import { toThree } from "./coords.ts";
import { texelCoords, textureAxes } from "./uv.ts";

/** Brightness by face direction: floors brightest, ceilings darkest, walls in between. */
export const faceShade = (n: Vec3): number => 0.7 + 0.2 * n.z + 0.08 * Math.abs(n.x);

export function textureNames(level: MapLevel): string[] {
  return [...new Set(level.brushes.flatMap((b) => b.faces.map((f) => f.source.texture)))].sort();
}

/** A magenta and black checkerboard for textures that fail to load. */
export function missingTexture(): THREE.Texture {
  const m = [255, 0, 255, 255];
  const k = [0, 0, 0, 255];
  const tex = new THREE.DataTexture(new Uint8Array([...m, ...k, ...k, ...m]), 2, 2);
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

export function buildLevelMeshes(level: MapLevel, textures: ReadonlyMap<string, THREE.Texture>): THREE.Group {
  const group = new THREE.Group();
  const byTexture = new Map<string, { positions: number[]; uvs: number[]; colors: number[] }>();

  for (const brush of level.brushes) {
    for (const face of brush.faces) {
      const name = face.source.texture;
      const texture = textures.get(name);
      const image = texture?.image as { width?: number; height?: number } | undefined;
      const width = image?.width ?? 64;
      const height = image?.height ?? 64;
      const axes = textureAxes(face.source, face.plane.normal);
      const shade = faceShade(face.plane.normal);

      // Fan-triangulate, wound counterclockwise as seen from the front (Three's front face).
      let w = face.winding;
      if (w.length >= 3 && dot(cross(sub(w[1]!, w[0]!), sub(w[2]!, w[0]!)), face.plane.normal) < 0) w = [...w].reverse();

      let bucket = byTexture.get(name);
      if (!bucket) byTexture.set(name, (bucket = { positions: [], uvs: [], colors: [] }));
      for (let i = 1; i + 1 < w.length; i++) {
        for (const p of [w[0]!, w[i]!, w[i + 1]!]) {
          bucket.positions.push(...toThree(p));
          const [s, t] = texelCoords(axes, p);
          bucket.uvs.push(s / width, t / height);
          bucket.colors.push(shade, shade, shade);
        }
      }
    }
  }

  for (const [name, { positions, uvs, colors }] of byTexture) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    const material = new THREE.MeshBasicMaterial({ map: textures.get(name) ?? null, vertexColors: true });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    group.add(mesh);
  }
  return group;
}

/**
 * Loads textures by name. Use THREE.NoColorSpace for shaders that light in gamma
 * space (the .bsp world shader), and sRGB for Three's built-in materials.
 */
export async function loadTextures(
  names: readonly string[],
  baseUrl: string,
  colorSpace: THREE.ColorSpace = THREE.SRGBColorSpace,
): Promise<Map<string, THREE.Texture>> {
  const loader = new THREE.TextureLoader();
  const entries = await Promise.all(
    names.map(async (name): Promise<[string, THREE.Texture]> => {
      try {
        const tex = await loader.loadAsync(`${baseUrl}/${name}.png`);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestMipmapLinearFilter;
        tex.colorSpace = colorSpace;
        tex.flipY = false; // texel t increases downward, as in the image
        return [name, tex];
      } catch {
        console.warn(`missing texture: ${name}`);
        return [name, missingTexture()];
      }
    }),
  );
  return new Map(entries);
}
