// Browser entry point: loads a map, runs the sim at its fixed tick rate, and
// renders between ticks.
//
// URL options: ?map=<name> (default test_movement), &lighting=off to draw the
// unlit .map instead of the compiled .bsp, &brightness=<n> to try another lightmap scale,
// &rawinput=off for the OS's accelerated mouse instead of raw input.
// The sim always loads its collision and entities from the .map.

import * as THREE from "three";
import { buildCommand } from "./game/command";
import { FixedStep } from "./game/fixed-step";
import { BrowserInput } from "./game/input";
import { buildBspMeshes, bspTextureNames, DEFAULT_BRIGHTNESS, type LitWorld } from "@hollow-coil/render/bsp-mesh";
import { cameraRotation, toThree, verticalFov } from "@hollow-coil/render/coords";
import type { LightStyleData } from "@hollow-coil/render/light-styles";
import { buildLevelMeshes, loadTextures, textureNames } from "@hollow-coil/render/level-mesh";
import { TICK_RATE } from "@hollow-coil/sim/constants";
import type { PlayerData } from "@hollow-coil/sim/data";
import { angleToRadians, degreesToUnits, wrapYaw } from "@hollow-coil/sim/input";
import { levelFromMap, type Level } from "@hollow-coil/sim/level";
import { readBsp } from "@hollow-coil/sim/map/bsp";
import { vec3, type Vec3 } from "@hollow-coil/sim/math/vec3";
import { createSim, movementContext, step, type SimState } from "@hollow-coil/sim/sim";

const GAME = "/game"; // served from the repo root by vite.config.ts
const HORIZONTAL_FOV = 90;
const BRIGHTNESS_STEP = 0.1;

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  return response.text();
}

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);

/**
 * The world's meshes: lit from the compiled .bsp when it loads, otherwise
 * unlit from the .map, with the reason. The dev server compiles stale maps on request.
 */
async function loadWorld(
  mapName: string,
  level: Level,
  lightStyles: LightStyleData,
  lighting: boolean,
  brightness: number,
): Promise<{ group: THREE.Group; lit: LitWorld | null; note: string }> {
  let reason = "lighting=off";
  if (lighting) {
    try {
      const response = await fetch(`${GAME}/build/${mapName}.bsp`);
      if (response.ok) {
        const bsp = readBsp(await response.arrayBuffer());
        const textures = await loadTextures(bspTextureNames(bsp), `${GAME}/textures`, THREE.NoColorSpace);
        const lit = buildBspMeshes(bsp, textures, lightStyles, brightness);
        return { group: lit.group, lit, note: "" };
      }
      const report = (await response.text()).trim();
      console.warn(`no lit build of ${mapName}:\n${report}`);
      reason = report.split("\n").find((line) => /FAIL|error|leak|missing|not installed/i.test(line))?.trim() ?? `${response.status} ${response.statusText}`;
    } catch (error) {
      console.warn(error);
      reason = error instanceof Error ? error.message : String(error);
    }
  }
  const group = buildLevelMeshes(level, await loadTextures(textureNames(level), `${GAME}/textures`));
  return { group, lit: null, note: `unlit (${reason})` };
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const mapName = params.get("map") ?? "test_movement";
  const overlay = document.getElementById("overlay")!;
  overlay.textContent = `loading ${mapName}...`;

  const [mapText, playerText, lightStylesText] = await Promise.all([
    fetchText(`${GAME}/maps/${mapName}.map`),
    fetchText(`${GAME}/data/player.json`),
    fetchText(`${GAME}/data/lightstyles.json`),
  ]);
  const level = levelFromMap(mapText);
  const config = { player: JSON.parse(playerText) as PlayerData };
  const lightStyles = JSON.parse(lightStylesText) as LightStyleData;
  const ctx = movementContext(level, config);

  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(window.devicePixelRatio);
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101014);
  const brightness = Number(params.get("brightness") ?? DEFAULT_BRIGHTNESS);
  const world = await loadWorld(mapName, level, lightStyles, params.get("lighting") !== "off", Number.isFinite(brightness) ? brightness : DEFAULT_BRIGHTNESS);
  scene.add(world.group);
  // Brightness keys, for calibrating lightmaps by eye.
  window.addEventListener("keydown", (e) => {
    if (!world.lit || (e.code !== "BracketLeft" && e.code !== "BracketRight")) return;
    const b = world.lit.brightness;
    b.value = Math.max(0, Math.round((b.value + (e.code === "BracketRight" ? BRIGHTNESS_STEP : -BRIGHTNESS_STEP)) * 10) / 10);
  });
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
  const preferRawInput = params.get("rawinput") !== "off";
  const input = new BrowserInput(renderer.domElement, preferRawInput);
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
    world.lit?.animate(current.tick);
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
      world.lit ? `lit  brightness ${world.lit.brightness.value.toFixed(1)}  ([ and ] adjust)` : world.note,
      input.locked
        ? `mouse ${input.rawInput ? "raw" : preferRawInput ? "accelerated (raw input unavailable)" : "accelerated (rawinput=off)"}`
        : "click to play  (WASD, mouse, space)",
    ].join("\n");
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((error: unknown) => {
  document.getElementById("overlay")!.textContent = `failed to start: ${error instanceof Error ? error.message : String(error)}`;
  console.error(error);
});
