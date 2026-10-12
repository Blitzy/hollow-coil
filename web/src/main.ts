// Browser entry point: loads a map, runs the sim at its fixed tick rate, and
// renders between ticks. Pick a map with ?map=<name> (default test_movement).

import * as THREE from "three";
import { buildCommand } from "./game/command";
import { FixedStep } from "./game/fixed-step";
import { BrowserInput } from "./game/input";
import { cameraRotation, toThree, verticalFov } from "./render/coords";
import { buildLevelMeshes, loadTextures, textureNames } from "./render/level-mesh";
import { TICK_RATE } from "./sim/constants";
import type { PlayerData } from "./sim/data";
import { angleToRadians, degreesToUnits, wrapYaw } from "./sim/input";
import { levelFromMap } from "./sim/level";
import { vec3, type Vec3 } from "./sim/math/vec3";
import { createSim, movementContext, step, type SimState } from "./sim/sim";

const GAME = "/game"; // served from the repo root by vite.config.ts
const HORIZONTAL_FOV = 90;

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  return response.text();
}

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);

async function main(): Promise<void> {
  const mapName = new URLSearchParams(location.search).get("map") ?? "test_movement";
  const overlay = document.getElementById("overlay")!;
  overlay.textContent = `loading ${mapName}...`;

  const [mapText, playerText] = await Promise.all([fetchText(`${GAME}/maps/${mapName}.map`), fetchText(`${GAME}/data/player.json`)]);
  const level = levelFromMap(mapText);
  const config = { player: JSON.parse(playerText) as PlayerData };
  const ctx = movementContext(level, config);

  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(window.devicePixelRatio);
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101014);
  scene.add(buildLevelMeshes(level, await loadTextures(textureNames(level), `${GAME}/textures`)));
  const camera = new THREE.PerspectiveCamera(70, 1, 1, 8192);
  camera.rotation.order = "YXZ";

  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.fov = verticalFov(HORIZONTAL_FOV, camera.aspect);
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
  resize();

  const start = level.playerStart ?? { origin: vec3(0, 0, 24), angle: 0 };
  const startYaw = wrapYaw(degreesToUnits(start.angle));
  const input = new BrowserInput(renderer.domElement);
  input.yaw = angleToRadians(startYaw);

  let previous: SimState = createSim(config, { origin: start.origin, yaw: startYaw });
  let current = previous;
  const stepper = new FixedStep(TICK_RATE);
  let lastTime = performance.now();
  let frames = 0;
  let fps = 0;
  let fpsTime = lastTime;

  const frame = (now: number): void => {
    const ticks = stepper.advance((now - lastTime) / 1000);
    lastTime = now;
    for (let i = 0; i < ticks; i++) {
      previous = current;
      current = step(current, buildCommand(input.read()), ctx).state;
    }

    // Interpolate position between the last two ticks; view angles come straight from the mouse for low latency.
    const origin = lerp(previous.player.origin, current.player.origin, stepper.alpha);
    camera.position.set(...toThree(vec3(origin.x, origin.y, origin.z + config.player.eye_height)));
    const rot = cameraRotation(input.yaw, input.pitch);
    camera.rotation.set(rot.x, rot.y, 0);
    renderer.render(scene, camera);

    frames++;
    if (now - fpsTime >= 500) {
      fps = Math.round((frames * 1000) / (now - fpsTime));
      frames = 0;
      fpsTime = now;
    }
    const p = current.player;
    overlay.textContent = [
      `${mapName}  ${fps} fps  tick ${current.tick}`,
      `pos ${p.origin.x.toFixed(1)} ${p.origin.y.toFixed(1)} ${p.origin.z.toFixed(1)}`,
      `speed ${Math.hypot(p.velocity.x, p.velocity.y).toFixed(0)}  ${p.onGround ? "ground" : "air"}`,
      input.locked ? "" : "click to play  (WASD, mouse, space)",
    ].join("\n");
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((error: unknown) => {
  document.getElementById("overlay")!.textContent = `failed to start: ${error instanceof Error ? error.message : String(error)}`;
  console.error(error);
});
