// The 2D layer over the scene: text in the engine's font and filled rectangles,
// laid out in virtual pixels, as Quake drew its console and status bar (see
// DECISIONS.md, "The game's UI is drawn by the engine"). It's immediate mode:
// each frame clears it, adds what to show, and draws it after the scene.
//
// A virtual pixel is a whole number of screen pixels, the most that keeps the
// layer at least MIN_HEIGHT virtual pixels tall, so the font stays crisp and
// grows with the window. Colors are drawn as given, in gamma space like the world.

import * as THREE from "three";
import { CELL_HEIGHT, CELL_WIDTH, cellOf, cellPosition, fontImage, fontText, SOLID } from "./font.ts";

/** The fewest virtual pixels the layer is tall: 36 lines of text. */
export const MIN_HEIGHT = 360;
const FIRST_CAPACITY = 1024;

const VERTEX_SHADER = /* glsl */ `
attribute vec4 tint;
varying vec2 vUv;
varying vec4 vTint;
void main() {
  vUv = uv;
  vTint = tint;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D font;
varying vec2 vUv;
varying vec4 vTint;
void main() {
  gl_FragColor = vec4(vTint.rgb, vTint.a * texture2D(font, vUv).a);
}
`;

export class Layer2D {
  /** Screen pixels per virtual pixel. */
  scale = 1;
  /** The layer's size in whole virtual pixels, for layout. */
  width = 0;
  height = 0;
  /** What the layer draws: its geometry holds the quads added since the last clear. */
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera();
  private readonly fontSize: { width: number; height: number };
  private quads = 0;
  private capacity = 0;
  private positions = new Float32Array(0);
  private uvs = new Float32Array(0);
  private tints = new Float32Array(0);

  constructor() {
    const image = fontImage();
    this.fontSize = { width: image.width, height: image.height };
    const font = new THREE.DataTexture(image.data, image.width, image.height, THREE.RGBAFormat);
    font.magFilter = THREE.NearestFilter;
    font.minFilter = THREE.NearestFilter;
    font.generateMipmaps = false;
    font.needsUpdate = true;
    const material = new THREE.ShaderMaterial({
      uniforms: { font: { value: font } },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide, // y runs down the screen, which flips the winding
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.grow(FIRST_CAPACITY);
    this.resize(1, 1);
  }

  /** Fits the layer to a drawing buffer's size, in screen pixels. */
  resize(pixelWidth: number, pixelHeight: number): void {
    this.scale = Math.max(1, Math.floor(pixelHeight / MIN_HEIGHT));
    this.width = Math.floor(pixelWidth / this.scale);
    this.height = Math.floor(pixelHeight / this.scale);
    // y runs down from the top, and the right and bottom edges land exactly on the buffer's, so every virtual pixel
    // covers whole screen pixels.
    Object.assign(this.camera, { left: 0, right: pixelWidth / this.scale, top: 0, bottom: pixelHeight / this.scale, near: -1, far: 1 });
    this.camera.updateProjectionMatrix();
  }

  /** How many quads have been added since the last clear. */
  get quadCount(): number {
    return this.quads;
  }

  /** Empties the layer, for the next frame. */
  clear(): void {
    this.quads = 0;
  }

  /** A filled rectangle, in virtual pixels from the top left. */
  rect(x: number, y: number, width: number, height: number, color: number, alpha = 1): void {
    const solid = cellPosition(SOLID);
    const u = solid.x + CELL_WIDTH / 2;
    const v = solid.y + CELL_HEIGHT / 2;
    this.quad(x, y, width, height, u, v, u, v, color, alpha);
  }

  /** One line of text with its cells' top left at x, y, as fontText gives it. Returns where it ends. */
  text(x: number, y: number, text: string, color: number, alpha = 1): number {
    for (const char of fontText(text)) {
      const code = char.codePointAt(0)!;
      if (code !== 32) {
        const cell = cellPosition(cellOf(code));
        this.quad(x, y, CELL_WIDTH, CELL_HEIGHT, cell.x, cell.y, cell.x + CELL_WIDTH, cell.y + CELL_HEIGHT, color, alpha);
      }
      x += CELL_WIDTH;
    }
    return x;
  }

  /** Draws the layer over what the renderer has drawn this frame. */
  draw(renderer: THREE.WebGLRenderer): void {
    const geometry = this.mesh.geometry;
    for (const name of ["position", "uv", "tint"]) geometry.getAttribute(name).needsUpdate = true;
    geometry.setDrawRange(0, this.quads * 6);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }

  /** A quad from x, y, sized width by height, showing the font's image from (u0, v0) to (u1, v1) in pixels. */
  private quad(x: number, y: number, width: number, height: number, u0: number, v0: number, u1: number, v1: number, color: number, alpha: number): void {
    if (this.quads === this.capacity) this.grow(this.capacity * 2);
    const i = this.quads++;
    const [x1, y1] = [x + width, y + height];
    this.positions.set([x, y, 0, x1, y, 0, x1, y1, 0, x, y1, 0], i * 12);
    const { width: fw, height: fh } = this.fontSize;
    const [s0, t0, s1, t1] = [u0 / fw, v0 / fh, u1 / fw, v1 / fh];
    this.uvs.set([s0, t0, s1, t0, s1, t1, s0, t1], i * 8);
    const tint = [((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255, alpha];
    for (let corner = 0; corner < 4; corner++) this.tints.set(tint, (i * 4 + corner) * 4);
  }

  /** Room for capacity quads, keeping those already added. */
  private grow(capacity: number): void {
    const keep = (old: Float32Array, size: number): Float32Array<ArrayBuffer> => {
      const array = new Float32Array(capacity * size);
      array.set(old);
      return array;
    };
    this.positions = keep(this.positions, 12);
    this.uvs = keep(this.uvs, 8);
    this.tints = keep(this.tints, 16);
    const index = new Uint32Array(capacity * 6);
    for (let i = 0; i < capacity; i++) index.set([0, 1, 2, 0, 2, 3].map((corner) => i * 4 + corner), i * 6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(this.uvs, 2));
    geometry.setAttribute("tint", new THREE.BufferAttribute(this.tints, 4));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.mesh.geometry.dispose();
    this.mesh.geometry = geometry;
    this.capacity = capacity;
  }
}
