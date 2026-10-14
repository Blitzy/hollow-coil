// Three.js meshes for a compiled .bsp's world, lit by its baked lightmaps.
// bspSurfaces() turns faces into per-texture triangle batches as plain arrays;
// buildBspMeshes() uploads them with the lightmap atlas and a world shader.
//
// Lighting is done in gamma space, as Quake's renderers did: the texture's
// stored color times the lightmap's, times a brightness factor, written to the
// screen as is. Doing it in Three's linear color pipeline instead would wash the
// result out compared with the era.

import * as THREE from "three";
import { SURF, texelCoords, type Bsp } from "@mandreljs/sim/map/bsp";
import { cross, length, sub } from "@mandreljs/sim/math/vec3";
import { toThree } from "./coords.ts";
import { LightStyleAnimator, type LightStyleData } from "./light-styles.ts";
import { lightmapUv, packLightmaps, type LightmapAtlas } from "./lightmap-atlas.ts";

/** Faces that are never drawn as world surfaces. Sky gets its own pass later. */
const HIDDEN = SURF.NODRAW | SURF.SKY;
/** Twice the area, in square units, below which a fan triangle is dropped as degenerate. */
const MIN_DOUBLE_AREA = 1e-3;

export interface SurfaceBatch {
  readonly texture: string;
  /** False for faces with no lightmap (such as warping liquids), which draw at full brightness. */
  readonly lit: boolean;
  /** Three.js coordinates, three per vertex, in counterclockwise triangles. */
  readonly positions: number[];
  /** Texture UVs, two per vertex. */
  readonly uvs: number[];
  /** Lightmap atlas UVs, two per vertex (zero for unlit batches). */
  readonly lightUvs: number[];
}

/**
 * Triangles for the world model's visible faces, batched by texture and lit
 * or unlit. textureSize gives each texture's size in pixels, for its UVs.
 */
export function bspSurfaces(bsp: Bsp, atlas: LightmapAtlas, textureSize: (name: string) => readonly [number, number]): SurfaceBatch[] {
  const batches = new Map<string, SurfaceBatch>();
  const world = bsp.models[0];
  if (!world) return [];
  for (let index = world.firstFace; index < world.firstFace + world.numFaces; index++) {
    const face = bsp.faces[index]!;
    const info = bsp.texinfo[face.texinfo]!;
    if (info.flags & HIDDEN) continue;
    const block = atlas.blocks.get(index);
    const key = `${info.texture}\n${block ? "lit" : "unlit"}`;
    let batch = batches.get(key);
    if (!batch) batches.set(key, (batch = { texture: info.texture, lit: block !== undefined, positions: [], uvs: [], lightUvs: [] }));

    // Quake winds faces clockwise seen from the front; Three's front faces are counterclockwise.
    const w = [...face.vertices].reverse();
    const [width, height] = textureSize(info.texture);
    for (let i = 1; i + 1 < w.length; i++) {
      // qbsp keeps extra vertices along edges where neighboring faces meet, so some fan triangles have no area.
      if (length(cross(sub(w[i]!, w[0]!), sub(w[i + 1]!, w[0]!))) < MIN_DOUBLE_AREA) continue;
      for (const p of [w[0]!, w[i]!, w[i + 1]!]) {
        batch.positions.push(...toThree(p));
        const [s, t] = texelCoords(info, p);
        batch.uvs.push(s / width, t / height);
        batch.lightUvs.push(...(block ? lightmapUv(bsp, atlas, block, p) : [0, 0]));
      }
    }
  }
  return [...batches.values()];
}

const VERTEX_SHADER = /* glsl */ `
attribute vec2 lightUv;
varying vec2 vUv;
varying vec2 vLightUv;
void main() {
  vUv = uv;
  vLightUv = lightUv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D map;
uniform sampler2D lightmap;
uniform float brightness;
varying vec2 vUv;
varying vec2 vLightUv;
void main() {
  vec3 color = texture2D(map, vUv).rgb;
#ifdef LIT
  color *= texture2D(lightmap, vLightUv).rgb * brightness;
#endif
  gl_FragColor = vec4(color, 1.0);
}
`;

export interface LitWorld {
  readonly group: THREE.Group;
  readonly atlas: LightmapAtlas;
  readonly lightmap: THREE.DataTexture;
  /** Multiplies every lightmap; shared by all world materials. */
  readonly brightness: { value: number };
  /** Steps animated light styles to a sim tick, re-uploading the lightmap if it changed. */
  animate(tick: number): void;
}

/**
 * Lightmap brightness: a lightmap value of 255 / BRIGHTNESS shows a texture at
 * its true colors, and brighter values up to 255 brighten past it. Between
 * Quake 2's 1x and Quake's 2x overbright GL renderers, chosen by eye on the
 * test maps. Keep it fixed so light values mean the same in every map.
 */
export const DEFAULT_BRIGHTNESS = 1.5;

/**
 * Meshes for the world model. Textures should be loaded with no color space
 * conversion (see loadTextures), so the shader sees their stored values.
 */
export function buildBspMeshes(
  bsp: Bsp,
  textures: ReadonlyMap<string, THREE.Texture>,
  lightStyles: LightStyleData,
  brightness = DEFAULT_BRIGHTNESS,
): LitWorld {
  const atlas = packLightmaps(bsp);
  const image = new Uint8Array(atlas.width * atlas.height * 4);
  const animator = new LightStyleAnimator(bsp, atlas, lightStyles, image);
  const lightmap = new THREE.DataTexture(image, atlas.width, atlas.height, THREE.RGBAFormat);
  lightmap.magFilter = THREE.LinearFilter;
  lightmap.minFilter = THREE.LinearFilter;
  lightmap.generateMipmaps = false;
  lightmap.needsUpdate = true;

  const shared = { brightness: { value: brightness }, lightmap: { value: lightmap } };
  const size = (name: string): [number, number] => {
    const image = textures.get(name)?.image as { width?: number; height?: number } | undefined;
    return [image?.width ?? 64, image?.height ?? 64];
  };

  const group = new THREE.Group();
  for (const batch of bspSurfaces(bsp, atlas, size)) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(batch.positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(batch.uvs, 2));
    geometry.setAttribute("lightUv", new THREE.Float32BufferAttribute(batch.lightUvs, 2));
    geometry.computeBoundingSphere();
    const material = new THREE.ShaderMaterial({
      uniforms: { ...shared, map: { value: textures.get(batch.texture) ?? null } },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      defines: batch.lit ? { LIT: "" } : {},
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = batch.texture;
    group.add(mesh);
  }
  return {
    group,
    atlas,
    lightmap,
    brightness: shared.brightness,
    animate(tick) {
      if (animator.update(tick)) lightmap.needsUpdate = true;
    },
  };
}

/** Names of the textures the world model draws, for loading. */
export function bspTextureNames(bsp: Bsp): string[] {
  const world = bsp.models[0];
  const names = new Set<string>();
  if (world) {
    for (let i = world.firstFace; i < world.firstFace + world.numFaces; i++) {
      const info = bsp.texinfo[bsp.faces[i]!.texinfo]!;
      if (!(info.flags & HIDDEN)) names.add(info.texture);
    }
  }
  return [...names].sort();
}
