// Browser entry point: loads a game's map, runs the sim at its fixed tick rate,
// and renders between ticks.
//
// URL options: ?game=<dir> (a game directory the server offers; default: the
// one it was started for, from /games/index.json),
// &map=<name> (default: the game's start map), &lighting=off to load the
// unlit .map instead of the compiled .bsp, &brightness=<n> to try another lightmap scale,
// &rawinput=off for the OS's accelerated mouse instead of raw input.
// The backquote key opens the console (see game/console.ts), whose commands load
// maps in place and record demos (see demos/README.md).
// Dropping a demo on the page plays it, on the map and level file it was recorded on.
// Everything comes from one file: the .bsp (drawing, collision, and entities),
// or the .map when there's no usable .bsp or lighting is off.

import * as THREE from "three";
import { clientCommands } from "./game/client-commands.ts";
import { buildCommand } from "./game/command.ts";
import { Console } from "./game/console.ts";
import { ConsoleView } from "./game/console-view.ts";
import { DEAD_EYE_HEIGHT, DEAD_ROLL, RespawnWait } from "./game/death.ts";
import { DemoPlayback, lerpYaw, placeDemo, speedLabel, type PageLevel } from "./game/demo-playback.ts";
import { Effects } from "./game/effects.ts";
import { failureLine, levelProblem, levelUrl } from "./game/level-files.ts";
import { FixedStep } from "./game/fixed-step.ts";
import { BrowserInput } from "./game/input.ts";
import { cycleSlot } from "./game/weapon-select.ts";
import { buildBspMeshes, bspTextureNames, DEFAULT_BRIGHTNESS, type LitWorld } from "@mandreljs/render/bsp-mesh";
import { cameraRotation, toThree, verticalFov } from "@mandreljs/render/coords";
import { disposeTree } from "@mandreljs/render/dispose";
import { EnemyFigures } from "@mandreljs/render/enemies";
import { Layer2D } from "@mandreljs/render/layer2d";
import { LIGHT_STYLES, type LightStyleData } from "@mandreljs/render/light-styles";
import { buildLevelMeshes, loadTextures, textureNames } from "@mandreljs/render/level-mesh";
import { TICK_RATE } from "@mandreljs/sim/constants";
import { contentHashes, DemoRecorder, formatDemo, upgradeDemo, type Demo, type DemoHeader } from "@mandreljs/sim/demo";
import type { EnemiesData, PlayerData, WeaponsData } from "@mandreljs/sim/data";
import { angleToRadians } from "@mandreljs/sim/input";
import { levelFromBsp, levelFromMap, type Level } from "@mandreljs/sim/level";
import { readBsp } from "@mandreljs/sim/map/bsp";
import { vec3, type Vec3 } from "@mandreljs/sim/math/vec3";
import { levelSpawn, playerAlive, simContext, startLevel, step, type SimConfig, type SimContext, type SimState } from "@mandreljs/sim/sim";

// Game directories, relative to the page so a release works wherever it's hosted:
// served by the dev server (tools/src/dev-server.ts), or copied next to the page
// by mandreljs build. Their index.json names the game to play when the URL doesn't, and each game's maps.
const GAMES = "games";
const HORIZONTAL_FOV = 90;
const BRIGHTNESS_STEP = 0.1;
/** The RNG seed every game starts with. */
const SEED = 0;
/** Where a dropped demo waits while the page reloads on its map. */
const PENDING_DEMO = "mandreljs.pending-demo";
/** What the console shows in its corner. */
const VERSION = `Mandrel.js ${__MANDRELJS_VERSION__}`;

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

/** The server's /games/index.json: the games it serves with their maps, and the one to play when the URL names none. */
interface GameIndex {
  readonly default: string;
  readonly games: readonly { readonly name: string; readonly maps: readonly string[] }[];
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
      const response = await fetch(levelUrl(game, mapName, "bsp"));
      if (response.ok) {
        const bsp = readBsp(await response.arrayBuffer());
        const level = levelFromBsp(bsp);
        const textures = await loadTextures(bspTextureNames(bsp), `${game}/textures`, THREE.NoColorSpace);
        const lit = buildBspMeshes(bsp, textures, lightStyles, brightness);
        return { level, group: lit.group, lit, file: `${mapName}.bsp`, note: "" };
      }
      const report = (await response.text()).trim();
      console.warn(`no lit build of ${mapName}:\n${report}`);
      reason = failureLine(report, response);
    } catch (error) {
      console.warn(error);
      reason = error instanceof Error ? error.message : String(error);
    }
  }
  const level = levelFromMap(await fetchText(levelUrl(game, mapName, "map")));
  const group = buildLevelMeshes(level, await loadTextures(textureNames(level), `${game}/textures`));
  return { level, group, lit: null, file: `${mapName}.map`, note: `unlit (${reason})` };
}

/** The game's index, or null when the URL names the game and the index can't be had (it's only needed for the list of maps then). */
async function gameIndex(urlNamesGame: boolean): Promise<GameIndex | null> {
  try {
    return JSON.parse(await fetchText(`${GAMES}/index.json`)) as GameIndex;
  } catch (error) {
    if (!urlNamesGame) throw error;
    console.warn(error);
    return null;
  }
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const pendingDemo = takePendingDemo();
  const overlay = document.getElementById("overlay")!;
  const crosshair = document.getElementById("crosshair")!;
  overlay.textContent = "loading...";
  // The console comes first, so it hears about everything from the start.
  const con = new Console();
  const conView = new ConsoleView();
  /** Tells the console, and the browser's console, something the engine did. */
  const say = (text: string): void => {
    con.print(text);
    console.log(text);
  };
  const warn = (text: string): void => {
    con.warn(text);
    console.warn(text);
  };

  const index = await gameIndex(params.has("game"));
  const gameDir = params.get("game") ?? index!.default;
  const game = `${GAMES}/${encodeURIComponent(gameDir)}`;
  const maps = index?.games.find((entry) => entry.name === gameDir)?.maps ?? [];

  const [gameText, playerText, weaponsText, enemiesText] = await Promise.all([
    fetchText(`${game}/data/game.json`),
    fetchText(`${game}/data/player.json`),
    fetchText(`${game}/data/weapons.json`),
    fetchText(`${game}/data/enemies.json`),
  ]);
  const info = JSON.parse(gameText) as GameInfo;
  document.title = info.name;
  say(`${VERSION}, playing ${info.name}`);
  const firstMap = params.get("map") ?? info.start_map;
  overlay.textContent = `loading ${firstMap}...`;
  const config: SimConfig = {
    player: JSON.parse(playerText) as PlayerData,
    weapons: JSON.parse(weaponsText) as WeaponsData,
    enemies: JSON.parse(enemiesText) as EnemiesData,
  };
  const lighting = params.get("lighting") !== "off";
  const brightness = Number(params.get("brightness") ?? DEFAULT_BRIGHTNESS);
  const firstWorld = await loadLevel(game, firstMap, LIGHT_STYLES, lighting, Number.isFinite(brightness) ? brightness : DEFAULT_BRIGHTNESS);

  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(window.devicePixelRatio);
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101014);
  const layer = new Layer2D();
  const effects = new Effects(config.player.eye_height);
  scene.add(effects.group);
  const flash = document.getElementById("flash")!;
  const respawn = new RespawnWait();
  const camera = new THREE.PerspectiveCamera(70, 1, 1, 8192);
  camera.rotation.order = "YXZ";

  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.fov = verticalFov(HORIZONTAL_FOV, camera.aspect);
    camera.updateProjectionMatrix();
    const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
    layer.resize(buffer.x, buffer.y);
  };
  window.addEventListener("resize", resize);
  resize();

  /** The map being played, and what's made from it for the sim, drawing, and demos. */
  interface Here {
    readonly map: string;
    readonly world: LoadedLevel;
    readonly ctx: SimContext;
    readonly figures: EnemyFigures;
    readonly startYaw: number;
    readonly page: PageLevel;
    readonly header: DemoHeader;
  }
  const arrive = (map: string, world: LoadedLevel): Here => {
    const ctx = simContext(world.level, config);
    const looks = new Map([...ctx.enemies.types].map(([id, type]) => [id, { hull: type.hull, eyeHeight: type.data.eye_height }]));
    const figures = new EnemyFigures(looks);
    scene.add(world.group, figures.group);
    const level = world.lit ? "bsp" : "map";
    if (world.lit) say(`loaded ${world.file}`);
    else (lighting ? warn : say)(`loaded ${world.file}, ${world.note}`);
    return {
      map,
      world,
      ctx,
      figures,
      startYaw: levelSpawn(world.level).yaw,
      page: { game: info.name, map, level, lightingOff: !lighting, note: world.note },
      header: { game: info.name, map, level, seed: SEED, engine: __MANDRELJS_VERSION__, content: contentHashes(world.level, config) },
    };
  };
  let here = arrive(firstMap, firstWorld);

  // Brightness keys, for calibrating lightmaps by eye.
  window.addEventListener("keydown", (e) => {
    const lit = here.world.lit;
    if (!lit || (e.code !== "BracketLeft" && e.code !== "BracketRight")) return;
    const b = lit.brightness;
    b.value = Math.max(0, Math.round((b.value + (e.code === "BracketRight" ? BRIGHTNESS_STEP : -BRIGHTNESS_STEP)) * 10) / 10);
  });

  const preferRawInput = params.get("rawinput") !== "off";
  const input = new BrowserInput(renderer.domElement, preferRawInput);
  input.yaw = angleToRadians(here.startYaw);
  const weaponData = config.weapons.weapons;
  const slots = config.player.weapons.map((id) => weaponData[id]!.slot).sort((a, b) => a - b);

  let previous = startLevel(here.world.level, config, SEED);
  let current = previous;
  /**
   * Shows a state from scratch: no easing from an earlier tick, and no effects left from before. Every start goes
   * through here (the level starting over, a demo starting or playing again), so a new effect only needs to be in Effects.
   */
  const showFrom = (state: SimState): void => {
    previous = current = state;
    effects.reset();
  };
  /** Starts the level over, as Quake's single player restarts the map when you respawn. */
  const restart = (): void => {
    showFrom(startLevel(here.world.level, config, SEED));
    input.yaw = angleToRadians(here.startYaw);
    input.pitch = 0;
  };

  // Recording a demo: the record command starts the level over and records from its start; stop, or starting over, saves it.
  let recorder: DemoRecorder | null = null;
  /** The recording's file name, without .demo.json, or null to name it after the map and the time it's saved. */
  let recordingName: string | null = null;
  const saveDemo = (): void => {
    if (recorder === null) return;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const file = `${recordingName ?? `${here.map}-${stamp}`}.demo.json`;
    const seconds = recorder.ticks / TICK_RATE;
    download(file, formatDemo(recorder.finish()));
    recorder = null;
    say(`saved ${file} (${seconds.toFixed(1)}s) to your downloads`);
  };

  // Watching a demo: dropped on the page, or left by the page before, which reloaded on the demo's map.
  // Space pauses, the left and right arrows change speed, and Escape goes back to playing.
  let playback: DemoPlayback | null = null;
  /** Why the last demo couldn't play, for the overlay. */
  let message = "";
  /** A problem with a demo, for the overlay and the console. */
  const demoProblem = (text: string): void => {
    message = text;
    warn(text);
  };
  /** What's been said about where the playback differs from the recording. */
  let logged = { divergence: false, differences: false };
  /** The mouse can be captured while playing, but not while watching a demo or using the console. */
  const updateLockable = (): void => {
    input.lockable = playback === null && !conView.open;
  };
  const playDemo = async (text: string, reloaded: boolean): Promise<void> => {
    let demo: Demo;
    try {
      demo = upgradeDemo(JSON.parse(text));
    } catch (error) {
      return demoProblem(`can't play that demo: ${errorText(error)}`);
    }
    const place = placeDemo(demo, here.page, location.search, reloaded);
    if (place.kind === "unplayable") return demoProblem(`can't play the demo: ${place.reason}`);
    if (place.kind === "reload") {
      // Only leave this page for one that will load: a demo for a map that's gone stays here and says so.
      const problem = await levelProblem(game, demo.map, demo.level);
      if (problem !== null) return demoProblem(`can't play the demo: ${problem}`);
      try {
        sessionStorage.setItem(PENDING_DEMO, text);
      } catch {
        return demoProblem(`can't carry the demo to ${demo.map}: open ${place.search} and drop it there`);
      }
      location.search = place.search;
      return;
    }
    try {
      playback = new DemoPlayback(demo, here.world.level, config);
    } catch (error) {
      return demoProblem(`can't play the demo: ${errorText(error)}`);
    }
    saveDemo();
    message = "";
    logged = { divergence: false, differences: false };
    say(`playing a demo of ${demo.map} (${playback.length.toFixed(1)}s)`);
    if (playback.changes.length > 0) warn(`${playback.changes.join(", ")} changed since the demo was recorded, so it may not play as recorded`);
    showFrom(playback.state);
    updateLockable();
    document.exitPointerLock();
  };
  const stopPlayback = (): void => {
    playback = null;
    updateLockable();
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
    file.text().then((text) => playDemo(text, false), (error: unknown) => demoProblem(`can't read ${file.name}: ${errorText(error)}`));
  });

  window.addEventListener("keydown", (e) => {
    if (e.repeat || playback === null) return;
    if (e.code === "Space" && playback.finished) {
      playback.rewind(); // at the end, Space plays it again
      showFrom(playback.state);
    } else if (e.code === "Space") playback.togglePause();
    else if (e.code === "ArrowLeft") playback.slower();
    else if (e.code === "ArrowRight") playback.faster();
    else if (e.code === "Escape") stopPlayback();
  });

  /** Loads a map in place of this one, leaving a demo being watched and saving one being recorded. */
  let loading = false;
  const loadMap = async (map: string): Promise<void> => {
    if (loading) return warn("already loading a map");
    loading = true;
    say(`loading ${map}...`);
    try {
      const world = await loadLevel(game, map, LIGHT_STYLES, lighting, here.world.lit?.brightness.value ?? DEFAULT_BRIGHTNESS);
      playback = null;
      saveDemo();
      message = "";
      disposeTree(here.world.group);
      disposeTree(here.figures.group);
      here = arrive(map, world);
      restart();
      updateLockable();
      // The address names the map, so reloading the page stays on it.
      const url = new URL(location.href);
      url.searchParams.set("map", map);
      history.replaceState(history.state, "", url);
    } catch (error) {
      warn(`can't load ${map}: ${errorText(error)}`);
    } finally {
      loading = false;
    }
  };

  con.register(
    ...clientCommands(
      {
        get map() {
          return here.map;
        },
        maps,
        loadMap,
        restart: () => {
          if (playback !== null) return stopPlayback();
          saveDemo(); // a demo is one life, from the level's start
          restart();
        },
        record: (name) => {
          if (playback !== null) return con.warn("can't record while watching a demo (Escape leaves it)");
          if (recorder !== null) return con.warn("already recording (stop saves it)");
          restart();
          recorder = new DemoRecorder(here.header, current);
          recordingName = name;
          say(`recording ${here.map} from its start (stop, or starting over, saves it)`);
        },
        stop: () => (recorder === null ? con.print("not recording") : saveDemo()),
      },
      con,
    ),
  );

  // The console: backquote opens and closes it, and while it's open it takes the keyboard (listening first, in the
  // capture phase, so the game's keys don't hear it) and lets go of the mouse, and the game pauses.
  /** Whether the mouse was captured when the console opened, to capture it again when it closes. */
  let relock = false;
  const setConsole = (open: boolean, byKey: boolean): void => {
    conView.open = open;
    if (open) {
      relock = input.locked;
      input.release();
      document.exitPointerLock();
    }
    updateLockable();
    // Capturing the mouse needs a key press or click to answer, and Escape doesn't count.
    if (!open && relock && byKey && input.lockable) input.lock();
  };
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.code === "Backquote") {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) setConsole(!conView.open, true);
        return;
      }
      if (!conView.open) return;
      e.stopPropagation();
      if (e.code === "Escape") setConsole(false, false);
      else if (con.key(e)) e.preventDefault();
    },
    { capture: true },
  );
  window.addEventListener("paste", (e) => {
    if (conView.open) con.type(e.clipboardData?.getData("text") ?? "");
  });
  window.addEventListener("wheel", (e) => {
    if (conView.open) con.scrollBy(e.deltaY < 0 ? 3 : -3);
  });

  /** Says where the playback first differs from the recording, and what differs. */
  const logDivergence = (watched: DemoPlayback): void => {
    if (watched.divergedAt !== null && !logged.divergence) {
      warn(`the demo differs from the recording from tick ${watched.divergedAt}`);
      logged.divergence = true;
    }
    if (watched.differences !== null && !logged.differences) {
      warn(`at tick ${watched.differences.tick} (recorded -> played):\n${watched.differences.lines.join("\n")}`);
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
    // Real time, capped after a stall, then run at the playback's speed: the sim seconds this frame shows.
    // The game stands still while the console is open.
    const realSeconds = (now - lastTime) / 1000;
    const ticks = stepper.advance(realSeconds, conView.open ? 0 : (playback?.rate ?? 1));
    lastTime = now;
    const seconds = stepper.elapsed;
    clock += seconds;
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
        effects.present(result.events, current, clock, angleToRadians(current.player.yaw));
        continue;
      }
      const held = input.read();
      // A number key wins; otherwise the wheel steps on from the weapon last asked for.
      const steps = input.takeWeaponSteps();
      const weapon = held.weapon || (steps !== 0 ? cycleSlot(slots, weaponData[current.player.weapon.desired]!.slot, steps) : 0);
      const cmd = buildCommand({ ...held, weapon });
      const result = step(current, cmd, here.ctx);
      previous = current;
      current = result.state;
      recorder?.record(cmd, current);
      effects.present(result.events, current, clock, input.yaw);
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
    effects.update(seconds, clock);
    const origin = lerp(previous.player.origin, current.player.origin, stepper.alpha);
    camera.position.set(...toThree(vec3(origin.x, origin.y, origin.z + (alive ? config.player.eye_height : DEAD_EYE_HEIGHT))));
    const yaw = playback === null ? input.yaw : lerpYaw(previous.player.yaw, current.player.yaw, stepper.alpha);
    const pitch = playback === null ? input.pitch : angleToRadians(previous.player.pitch + (current.player.pitch - previous.player.pitch) * stepper.alpha);
    const rot = cameraRotation(yaw, pitch + effects.view.pitch);
    camera.rotation.set(rot.x, rot.y, -((alive ? 0 : DEAD_ROLL) + effects.view.roll)); // three.js rolls counterclockwise; ours is right side down
    flash.style.opacity = effects.view.flash.toFixed(3);
    here.world.lit?.animate(current.tick);
    here.figures.update(previous.enemies, current.enemies, stepper.alpha);
    renderer.render(scene, camera);

    layer.clear();
    conView.update(realSeconds);
    conView.draw(layer, con, now / 1000, VERSION);
    layer.draw(renderer);
    // The developer overlay and the crosshair stay out of the console's way.
    overlay.style.visibility = crosshair.style.visibility = conView.shown ? "hidden" : "visible";

    frames++;
    if (now - fpsTime >= 500) {
      fps = Math.round((frames * 1000) / (now - fpsTime));
      frames = 0;
      fpsTime = now;
    }
    const p = current.player;
    const lit = here.world.lit;
    const status = alive ? `health ${p.health}  ${weaponData[p.weapon.current]!.name}  ${p.weapon.phase}` : "dead";
    const lightingLine = lit ? `lit  brightness ${lit.brightness.value.toFixed(1)}  ([ and ] adjust)` : here.world.note;
    const lines = [
      `${here.world.file}  ${fps} fps  tick ${current.tick}`,
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
        lightingLine,
        playback.finished ? "space to play again, escape to leave" : `space to ${playback.paused ? "play" : "pause"}, left and right arrows for speed, escape to leave`,
      );
    } else {
      lines.push(
        alive || !respawn.ready ? status : "dead  (click or jump to start over)",
        recorder !== null ? `recording  ${(recorder.ticks / TICK_RATE).toFixed(1)}s  (stop in the console saves it)` : "` opens the console; drop a demo here to watch it",
        lightingLine,
        input.locked
          ? `mouse ${input.rawInput ? "raw" : preferRawInput ? "accelerated (raw input unavailable)" : "accelerated (rawinput=off)"}`
          : "click to play  (WASD, mouse, space; click to fire; 1-2 or wheel to switch)",
      );
    }
    if (message !== "") lines.push(message);
    overlay.textContent = lines.join("\n");
    requestAnimationFrame(frame);
  };
  if (pendingDemo !== null) void playDemo(pendingDemo, true);
  requestAnimationFrame(frame);
}

main().catch((error: unknown) => {
  document.getElementById("overlay")!.textContent = `failed to start: ${error instanceof Error ? error.message : String(error)}`;
  console.error(error);
});
