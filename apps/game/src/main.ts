// Browser entry point: loads a map, runs the sim at its fixed tick rate, and
// renders between ticks.
//
// URL options: ?map=<name> (default test_movement), &lighting=off to load the
// unlit .map instead of the compiled .bsp, &brightness=<n> to try another lightmap scale,
// &rawinput=off for the OS's accelerated mouse instead of raw input.
// Everything comes from one file: the .bsp (drawing, collision, and entities),
// or the .map when there's no usable .bsp or lighting is off.

import * as THREE from "three";
import { buildCommand } from "./game/command.ts";
import { FixedStep } from "./game/fixed-step.ts";
import { BrowserInput } from "./game/input.ts";
import { cycleSlot } from "./game/weapon-select.ts";
import { buildBspMeshes, bspTextureNames, DEFAULT_BRIGHTNESS, type LitWorld } from "@mandreljs/render/bsp-mesh";
import { cameraRotation, toThree, verticalFov } from "@mandreljs/render/coords";
import { EnemyFigures } from "@mandreljs/render/enemies";
import { ImpactMarks } from "@mandreljs/render/impacts";
import type { LightStyleData } from "@mandreljs/render/light-styles";
import { buildLevelMeshes, loadTextures, textureNames } from "@mandreljs/render/level-mesh";
import { TICK_RATE } from "@mandreljs/sim/constants";
import type { EnemiesData, PlayerData, WeaponsData } from "@mandreljs/sim/data";
import { enemySpawns } from "@mandreljs/sim/enemy/enemy";
import { angleToRadians, degreesToUnits, wrapYaw } from "@mandreljs/sim/input";
import { levelFromBsp, levelFromMap, type Level } from "@mandreljs/sim/level";
import { readBsp } from "@mandreljs/sim/map/bsp";
import { vec3, type Vec3 } from "@mandreljs/sim/math/vec3";
import { createSim, simContext, step, type SimConfig, type SimState } from "@mandreljs/sim/sim";

const GAME = "/game"; // served from the repo root by vite.config.ts
const HORIZONTAL_FOV = 90;
const BRIGHTNESS_STEP = 0.1;

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  return response.text();
}

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);

interface LoadedLevel {
  readonly level: Level;
  readonly group: THREE.Group;
  readonly lit: LitWorld | null;
  /** The file everything came from, for the overlay. */
  readonly file: string;
  /** Why the level is unlit, or "" if it's lit. */
  readonly note: string;
}

/**
 * The level and its meshes, from the compiled .bsp when it loads, otherwise
 * unlit from the .map, with the reason. The dev server compiles stale maps on request.
 */
async function loadLevel(mapName: string, lightStyles: LightStyleData, lighting: boolean, brightness: number): Promise<LoadedLevel> {
  let reason = "lighting=off";
  if (lighting) {
    try {
      const response = await fetch(`${GAME}/build/${mapName}.bsp`);
      if (response.ok) {
        const bsp = readBsp(await response.arrayBuffer());
        const level = levelFromBsp(bsp);
        const textures = await loadTextures(bspTextureNames(bsp), `${GAME}/textures`, THREE.NoColorSpace);
        const lit = buildBspMeshes(bsp, textures, lightStyles, brightness);
        return { level, group: lit.group, lit, file: `${mapName}.bsp`, note: "" };
      }
      const report = (await response.text()).trim();
      console.warn(`no lit build of ${mapName}:\n${report}`);
      reason = report.split("\n").find((line) => /FAIL|error|leak|missing|not installed/i.test(line))?.trim() ?? `${response.status} ${response.statusText}`;
    } catch (error) {
      console.warn(error);
      reason = error instanceof Error ? error.message : String(error);
    }
  }
  const level = levelFromMap(await fetchText(`${GAME}/maps/${mapName}.map`));
  const group = buildLevelMeshes(level, await loadTextures(textureNames(level), `${GAME}/textures`));
  return { level, group, lit: null, file: `${mapName}.map`, note: `unlit (${reason})` };
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const mapName = params.get("map") ?? "test_movement";
  const overlay = document.getElementById("overlay")!;
  overlay.textContent = `loading ${mapName}...`;

  const [playerText, weaponsText, enemiesText, lightStylesText] = await Promise.all([
    fetchText(`${GAME}/data/player.json`),
    fetchText(`${GAME}/data/weapons.json`),
    fetchText(`${GAME}/data/enemies.json`),
    fetchText(`${GAME}/data/lightstyles.json`),
  ]);
  const config: SimConfig = {
    player: JSON.parse(playerText) as PlayerData,
    weapons: JSON.parse(weaponsText) as WeaponsData,
    enemies: JSON.parse(enemiesText) as EnemiesData,
  };
  const lightStyles = JSON.parse(lightStylesText) as LightStyleData;
  const brightness = Number(params.get("brightness") ?? DEFAULT_BRIGHTNESS);
  const world = await loadLevel(mapName, lightStyles, params.get("lighting") !== "off", Number.isFinite(brightness) ? brightness : DEFAULT_BRIGHTNESS);
  const level = world.level;
  const ctx = simContext(level, config);

  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(window.devicePixelRatio);
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101014);
  scene.add(world.group);
  const impacts = new ImpactMarks();
  scene.add(impacts.group);
  const looks = new Map([...ctx.enemies.types].map(([id, type]) => [id, { hull: type.hull, eyeHeight: type.data.eye_height }]));
  const enemyFigures = new EnemyFigures(looks);
  scene.add(enemyFigures.group);
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
  const weaponData = config.weapons.weapons;
  const slots = config.player.weapons.map((id) => weaponData[id]!.slot).sort((a, b) => a - b);

  let previous: SimState = createSim(config, { origin: start.origin, yaw: startYaw }, 0, enemySpawns(level, ctx.enemies));
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
      const held = input.read();
      // A number key wins; otherwise the wheel steps on from the weapon last asked for.
      const steps = input.takeWeaponSteps();
      const weapon = held.weapon || (steps !== 0 ? cycleSlot(slots, weaponData[current.player.weapon.desired]!.slot, steps) : 0);
      const result = step(current, buildCommand({ ...held, weapon }), ctx);
      previous = current;
      current = result.state;
      for (const event of result.events) if (event.type === "hitWall") impacts.add(event.point, event.normal, now / 1000);
    }

    // Interpolate position between the last two ticks; view angles come straight from the mouse for low latency.
    const origin = lerp(previous.player.origin, current.player.origin, stepper.alpha);
    camera.position.set(...toThree(vec3(origin.x, origin.y, origin.z + config.player.eye_height)));
    const rot = cameraRotation(input.yaw, input.pitch);
    camera.rotation.set(rot.x, rot.y, 0);
    world.lit?.animate(current.tick);
    impacts.update(now / 1000);
    enemyFigures.update(previous.enemies, current.enemies, stepper.alpha);
    renderer.render(scene, camera);

    frames++;
    if (now - fpsTime >= 500) {
      fps = Math.round((frames * 1000) / (now - fpsTime));
      frames = 0;
      fpsTime = now;
    }
    const p = current.player;
    overlay.textContent = [
      `${world.file}  ${fps} fps  tick ${current.tick}`,
      `pos ${p.origin.x.toFixed(1)} ${p.origin.y.toFixed(1)} ${p.origin.z.toFixed(1)}`,
      `speed ${Math.hypot(p.velocity.x, p.velocity.y).toFixed(0)}  ${p.onGround ? "ground" : "air"}`,
      p.health > 0 ? `health ${p.health}  ${weaponData[p.weapon.current]!.name}  ${p.weapon.phase}` : "dead  (reload the page to restart)",
      world.lit ? `lit  brightness ${world.lit.brightness.value.toFixed(1)}  ([ and ] adjust)` : world.note,
      input.locked
        ? `mouse ${input.rawInput ? "raw" : preferRawInput ? "accelerated (raw input unavailable)" : "accelerated (rawinput=off)"}`
        : "click to play  (WASD, mouse, space; click to fire; 1-2 or wheel to switch)",
    ].join("\n");
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((error: unknown) => {
  document.getElementById("overlay")!.textContent = `failed to start: ${error instanceof Error ? error.message : String(error)}`;
  console.error(error);
});
