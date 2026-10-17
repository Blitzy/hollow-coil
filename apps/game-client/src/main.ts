// Browser entry point: loads a game's map, runs the sim at its fixed tick rate,
// and renders between ticks.
//
// URL options: ?game=<dir> (a game directory the server offers; default: the
// one it was started for, from /games/index.json),
// &map=<name> (default: the game's start map), &lighting=off to load the
// unlit .map instead of the compiled .bsp, &brightness=<n> to try another lightmap scale,
// &rawinput=off for the OS's accelerated mouse instead of raw input. R records a demo
// (see demos/README.md): it starts the level over, and R again or starting over saves it.
// Dropping a demo on the page plays it, on the map and level file it was recorded on.
// Everything comes from one file: the .bsp (drawing, collision, and entities),
// or the .map when there's no usable .bsp or lighting is off.

import * as THREE from "three";
import { buildCommand } from "./game/command.ts";
import { DamageView } from "./game/damage-view.ts";
import { DEAD_EYE_HEIGHT, DEAD_ROLL, RespawnWait } from "./game/death.ts";
import { DemoPlayback, lerpYaw, placeDemo, speedLabel, type PageLevel } from "./game/demo-playback.ts";
import { FixedStep } from "./game/fixed-step.ts";
import { BrowserInput } from "./game/input.ts";
import { cycleSlot } from "./game/weapon-select.ts";
import { buildBspMeshes, bspTextureNames, DEFAULT_BRIGHTNESS, type LitWorld } from "@mandreljs/render/bsp-mesh";
import { cameraRotation, toThree, verticalFov } from "@mandreljs/render/coords";
import { EnemyFigures } from "@mandreljs/render/enemies";
import { ImpactMarks } from "@mandreljs/render/impacts";
import { LIGHT_STYLES, type LightStyleData } from "@mandreljs/render/light-styles";
import { buildLevelMeshes, loadTextures, textureNames } from "@mandreljs/render/level-mesh";
import { TICK_RATE } from "@mandreljs/sim/constants";
import { contentHashes, DemoRecorder, formatDemo, upgradeDemo, type Demo, type DemoHeader } from "@mandreljs/sim/demo";
import type { EnemiesData, PlayerData, WeaponsData } from "@mandreljs/sim/data";
import { angleToRadians } from "@mandreljs/sim/input";
import { levelFromBsp, levelFromMap, type Level } from "@mandreljs/sim/level";
import { readBsp } from "@mandreljs/sim/map/bsp";
import { normalize, sub, vec3, type Vec3 } from "@mandreljs/sim/math/vec3";
import { levelSpawn, playerAlive, simContext, startLevel, step, type SimConfig, type SimEvent, type SimState } from "@mandreljs/sim/sim";

// Game directories, relative to the page so a release works wherever it's hosted:
// served by the dev server (tools/src/dev-server.ts), or copied next to the page
// by mandreljs build. Their index.json names the game to play when the URL doesn't.
const GAMES = "games";
const HORIZONTAL_FOV = 90;
const BRIGHTNESS_STEP = 0.1;
/** The RNG seed every game starts with. */
const SEED = 0;
/** Where a dropped demo waits while the page reloads on its map. */
const PENDING_DEMO = "mandreljs.pending-demo";

/** The demo left for this page by the one before it, if any, taken so a later reload doesn't play it again. */
function takePendingDemo(): string | null {
  try {
    const text = sessionStorage.getItem(PENDING_DEMO);
    sessionStorage.removeItem(PENDING_DEMO);
    return text;
  } catch {
    return null; // storage blocked: nothing was left
  }
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Hands the player a text file to save. */
function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  return response.text();
}

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);

/** The server's /games/index.json: the games it serves, and the one to play when the URL names none. */
interface GameIndex {
  readonly default: string;
  readonly games: readonly string[];
}

/** A game directory's data/game.json. */
interface GameInfo {
  readonly name: string;
  readonly start_map: string;
}

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
async function loadLevel(game: string, mapName: string, lightStyles: LightStyleData, lighting: boolean, brightness: number): Promise<LoadedLevel> {
  let reason = "lighting=off";
  if (lighting) {
    try {
      const response = await fetch(`${game}/build/${mapName}.bsp`);
      if (response.ok) {
        const bsp = readBsp(await response.arrayBuffer());
        const level = levelFromBsp(bsp);
        const textures = await loadTextures(bspTextureNames(bsp), `${game}/textures`, THREE.NoColorSpace);
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
  const level = levelFromMap(await fetchText(`${game}/maps/${mapName}.map`));
  const group = buildLevelMeshes(level, await loadTextures(textureNames(level), `${game}/textures`));
  return { level, group, lit: null, file: `${mapName}.map`, note: `unlit (${reason})` };
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const pendingDemo = takePendingDemo();
  const overlay = document.getElementById("overlay")!;
  overlay.textContent = "loading...";
  const gameDir = params.get("game") ?? (JSON.parse(await fetchText(`${GAMES}/index.json`)) as GameIndex).default;
  const game = `${GAMES}/${encodeURIComponent(gameDir)}`;

  const [gameText, playerText, weaponsText, enemiesText] = await Promise.all([
    fetchText(`${game}/data/game.json`),
    fetchText(`${game}/data/player.json`),
    fetchText(`${game}/data/weapons.json`),
    fetchText(`${game}/data/enemies.json`),
  ]);
  const info = JSON.parse(gameText) as GameInfo;
  document.title = info.name;
  const mapName = params.get("map") ?? info.start_map;
  overlay.textContent = `loading ${mapName}...`;
  const config: SimConfig = {
    player: JSON.parse(playerText) as PlayerData,
    weapons: JSON.parse(weaponsText) as WeaponsData,
    enemies: JSON.parse(enemiesText) as EnemiesData,
  };
  const brightness = Number(params.get("brightness") ?? DEFAULT_BRIGHTNESS);
  const world = await loadLevel(game, mapName, LIGHT_STYLES, params.get("lighting") !== "off", Number.isFinite(brightness) ? brightness : DEFAULT_BRIGHTNESS);
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
  // Where shots hit someone: placeholder blood, facing the player, until real effects (M5).
  const blood = new ImpactMarks({ color: 0xb01010, size: 4, lifetime: 0.5 });
  scene.add(blood.group);
  const flash = document.getElementById("flash")!;
  const damageView = new DamageView();
  const respawn = new RespawnWait();
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

  const startYaw = levelSpawn(level).yaw;
  const preferRawInput = params.get("rawinput") !== "off";
  const input = new BrowserInput(renderer.domElement, preferRawInput);
  input.yaw = angleToRadians(startYaw);
  const weaponData = config.weapons.weapons;
  const slots = config.player.weapons.map((id) => weaponData[id]!.slot).sort((a, b) => a - b);

  let previous = startLevel(level, config, SEED);
  let current = previous;
  /** Starts the level over, as Quake's single player restarts the map when you respawn. */
  const restart = (): void => {
    previous = current = startLevel(level, config, SEED);
    input.yaw = angleToRadians(startYaw);
    input.pitch = 0;
    damageView.reset();
    impacts.clear();
    blood.clear();
  };

  // Recording a demo: R starts the level over and records from its start; R again, or starting over, saves it.
  let recorder: DemoRecorder | null = null;
  const page: PageLevel = { game: info.name, map: mapName, level: world.lit ? "bsp" : "map", lightingOff: params.get("lighting") === "off", note: world.note };
  const header: DemoHeader = { game: info.name, map: mapName, level: page.level, seed: SEED, engine: __MANDRELJS_VERSION__, content: contentHashes(level, config) };
  const saveDemo = (): void => {
    if (recorder === null) return;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    download(`${mapName}-${stamp}.demo.json`, formatDemo(recorder.finish()));
    recorder = null;
  };

  // Watching a demo: dropped on the page, or left by the page before, which reloaded on the demo's map.
  // Space pauses, the left and right arrows change speed, and Escape goes back to playing.
  let playback: DemoPlayback | null = null;
  /** Why the last demo couldn't play, for the overlay. */
  let message = "";
  /** What's been said in the browser console about where the playback differs from the recording. */
  let logged = { divergence: false, differences: false };
  const playDemo = (text: string, reloaded: boolean): void => {
    let demo: Demo;
    try {
      demo = upgradeDemo(JSON.parse(text));
    } catch (error) {
      message = `can't play that demo: ${errorText(error)}`;
      return;
    }
    const place = placeDemo(demo, page, location.search, reloaded);
    if (place.kind === "unplayable") {
      message = `can't play the demo: ${place.reason}`;
      return;
    }
    if (place.kind === "reload") {
      try {
        sessionStorage.setItem(PENDING_DEMO, text);
      } catch {
        message = `can't carry the demo to ${demo.map}: open ${place.search} and drop it there`;
        return;
      }
      location.search = place.search;
      return;
    }
    try {
      playback = new DemoPlayback(demo, level, config);
    } catch (error) {
      message = `can't play the demo: ${errorText(error)}`;
      return;
    }
    saveDemo();
    message = "";
    logged = { divergence: false, differences: false };
    if (playback.changes.length > 0) console.warn(`${playback.changes.join(", ")} changed since the demo was recorded, so it may not play as recorded`);
    previous = current = playback.state;
    damageView.reset();
    impacts.clear();
    blood.clear();
    input.lockable = false;
    document.exitPointerLock();
  };
  const stopPlayback = (): void => {
    playback = null;
    input.lockable = true;
    restart();
  };
  window.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (file === undefined) return;
    file.text().then((text) => playDemo(text, false), (error: unknown) => (message = `can't read ${file.name}: ${errorText(error)}`));
  });

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (playback !== null) {
      if (e.code === "Space") playback.togglePause();
      else if (e.code === "ArrowLeft") playback.slower();
      else if (e.code === "ArrowRight") playback.faster();
      else if (e.code === "Escape") stopPlayback();
      return;
    }
    if (e.code !== "KeyR") return;
    if (recorder !== null) return saveDemo();
    restart();
    recorder = new DemoRecorder(header, current);
  });

  /** Presents what happened in a tick: marks where shots hit, and the player getting hurt, facing yaw (radians). */
  const present = (events: readonly SimEvent[], state: SimState, now: number, yaw: number): void => {
    const player = state.player;
    const eye = vec3(player.origin.x, player.origin.y, player.origin.z + config.player.eye_height);
    for (const event of events) {
      if (event.type === "hitWall") impacts.add(event.point, event.normal, now);
      else if (event.type === "hitEntity" && event.target !== player.id) blood.add(event.point, normalize(sub(eye, event.point)), now);
      else if (event.type === "damaged" && event.entity === player.id) {
        const attacker = state.enemies.find((e) => e.id === event.attacker);
        damageView.hurt(event.amount, player.origin, yaw, attacker?.origin ?? null);
      }
    }
  };
  /** Says in the browser console where the playback first differs from the recording, and what differs. */
  const logDivergence = (watched: DemoPlayback): void => {
    if (watched.divergedAt !== null && !logged.divergence) {
      console.warn(`the demo differs from the recording from tick ${watched.divergedAt}`);
      logged.divergence = true;
    }
    if (watched.differences !== null && !logged.differences) {
      console.warn(`at tick ${watched.differences.tick} (recorded -> played):\n${watched.differences.lines.join("\n")}`);
      logged.differences = true;
    }
  };
  const stepper = new FixedStep(TICK_RATE);
  let lastTime = performance.now();
  /** Seconds of play shown so far, for fading effects: real time in play, and playback's own time when watching. */
  let clock = 0;
  let frames = 0;
  let fps = 0;
  let fpsTime = lastTime;

  const frame = (now: number): void => {
    const real = (now - lastTime) / 1000;
    lastTime = now;
    const seconds = playback?.scale(real) ?? real;
    clock += seconds;
    const ticks = stepper.advance(seconds);
    if (playback !== null) {
      input.read(); // presses while watching don't carry over into play
      input.takeWeaponSteps();
    }
    for (let i = 0; i < ticks; i++) {
      if (playback !== null) {
        const result = playback.step();
        if (result === null) break;
        previous = current;
        current = result.state;
        present(result.events, current, clock, angleToRadians(current.player.yaw));
        continue;
      }
      const held = input.read();
      // A number key wins; otherwise the wheel steps on from the weapon last asked for.
      const steps = input.takeWeaponSteps();
      const weapon = held.weapon || (steps !== 0 ? cycleSlot(slots, weaponData[current.player.weapon.desired]!.slot, steps) : 0);
      const cmd = buildCommand({ ...held, weapon });
      const result = step(current, cmd, ctx);
      previous = current;
      current = result.state;
      recorder?.record(cmd, current);
      present(result.events, current, clock, input.yaw);
      if (respawn.update(current.tick, playerAlive(current.player), cmd.buttons)) {
        saveDemo(); // a demo is one life, from the level's start
        restart();
      }
    }
    if (playback !== null) {
      logDivergence(playback);
      if (playback.finished) previous = current; // hold the last tick rather than easing toward it
    }

    // Interpolate position between the last two ticks. In play, view angles come straight from the mouse for low
    // latency; a demo's come from its ticks, eased between them like position.
    // The dead see from the floor, rolled over; getting hurt flashes the screen and kicks the view.
    const alive = playerAlive(current.player);
    damageView.update(seconds);
    const origin = lerp(previous.player.origin, current.player.origin, stepper.alpha);
    camera.position.set(...toThree(vec3(origin.x, origin.y, origin.z + (alive ? config.player.eye_height : DEAD_EYE_HEIGHT))));
    const yaw = playback === null ? input.yaw : lerpYaw(previous.player.yaw, current.player.yaw, stepper.alpha);
    const pitch = playback === null ? input.pitch : angleToRadians(previous.player.pitch + (current.player.pitch - previous.player.pitch) * stepper.alpha);
    const rot = cameraRotation(yaw, pitch + damageView.pitch);
    camera.rotation.set(rot.x, rot.y, -((alive ? 0 : DEAD_ROLL) + damageView.roll)); // three.js rolls counterclockwise; ours is right side down
    flash.style.opacity = damageView.flash.toFixed(3);
    world.lit?.animate(current.tick);
    impacts.update(clock);
    blood.update(clock);
    enemyFigures.update(previous.enemies, current.enemies, stepper.alpha);
    renderer.render(scene, camera);

    frames++;
    if (now - fpsTime >= 500) {
      fps = Math.round((frames * 1000) / (now - fpsTime));
      frames = 0;
      fpsTime = now;
    }
    const p = current.player;
    const status = alive ? `health ${p.health}  ${weaponData[p.weapon.current]!.name}  ${p.weapon.phase}` : "dead";
    const lighting = world.lit ? `lit  brightness ${world.lit.brightness.value.toFixed(1)}  ([ and ] adjust)` : world.note;
    const lines = [
      `${world.file}  ${fps} fps  tick ${current.tick}`,
      `pos ${p.origin.x.toFixed(1)} ${p.origin.y.toFixed(1)} ${p.origin.z.toFixed(1)}`,
      `speed ${Math.hypot(p.velocity.x, p.velocity.y).toFixed(0)}  ${p.onGround ? "ground" : "air"}`,
    ];
    if (playback !== null) {
      const state = playback.finished ? "ended" : playback.paused ? "paused" : "playing";
      const diverged = playback.divergedAt;
      lines.push(
        status,
        `demo  ${playback.seconds.toFixed(1)} / ${playback.length.toFixed(1)}s  ${speedLabel(playback.speed)}  ${state}`,
        diverged === null ? "every tick matches the recording" : `differs from the recording from tick ${diverged} (${(diverged / TICK_RATE).toFixed(2)}s)`,
        ...(playback.differences === null ? [] : [`  at tick ${playback.differences.tick}: ${playback.differences.lines[0]!}  (more in the console)`]),
        ...(playback.changes.length > 0 ? [`${playback.changes.join(", ")} changed since it was recorded, so it may not play as recorded`] : []),
        lighting,
        playback.finished ? "space to play again, escape to leave" : `space to ${playback.paused ? "play" : "pause"}, left and right arrows for speed, escape to leave`,
      );
    } else {
      lines.push(
        alive || !respawn.ready ? status : "dead  (click or jump to start over)",
        recorder !== null ? `recording  ${(recorder.ticks / TICK_RATE).toFixed(1)}s  (R to stop and save)` : "R to record a demo, or drop one here to watch it",
        lighting,
        input.locked
          ? `mouse ${input.rawInput ? "raw" : preferRawInput ? "accelerated (raw input unavailable)" : "accelerated (rawinput=off)"}`
          : "click to play  (WASD, mouse, space; click to fire; 1-2 or wheel to switch)",
      );
    }
    if (message !== "") lines.push(message);
    overlay.textContent = lines.join("\n");
    requestAnimationFrame(frame);
  };
  if (pendingDemo !== null) playDemo(pendingDemo, true);
  requestAnimationFrame(frame);
}

main().catch((error: unknown) => {
  document.getElementById("overlay")!.textContent = `failed to start: ${error instanceof Error ? error.message : String(error)}`;
  console.error(error);
});
