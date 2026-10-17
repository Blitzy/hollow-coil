// Watching a demo: its recorded commands run through the sim from the level's
// start, at a speed the viewer picks, while each tick's state is checked against
// the recording's hash. Presentation takes the events each tick gives, as in play.

import { TICK_RATE } from "@mandreljs/sim/constants";
import { checkTickRate, contentChanges, DemoCheck, demoCommands, type Demo, type KeyframeDifferences } from "@mandreljs/sim/demo";
import { ANGLE_UNITS_PER_TURN, angleToRadians, type InputCommand } from "@mandreljs/sim/input";
import type { Level } from "@mandreljs/sim/level";
import { simContext, startLevel, step, type SimConfig, type SimContext, type SimState, type StepResult } from "@mandreljs/sim/sim";

/** Playback speeds, slowest first: the arrow keys step through them. */
export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
const NORMAL_SPEED = PLAYBACK_SPEEDS.indexOf(1);

export class DemoPlayback {
  readonly demo: Demo;
  /** Content changed since the demo was recorded ("map" or a data file's name), so it may not play as recorded. */
  readonly changes: readonly string[];
  /** The state at the playback's current tick. */
  state: SimState;
  paused: boolean;
  /** Compares each tick with the recording, as replayDemo does. */
  private readonly check: DemoCheck;
  private readonly level: Level;
  private readonly config: SimConfig;
  private readonly ctx: SimContext;
  private readonly commands: readonly InputCommand[];
  private speedIndex = NORMAL_SPEED;

  /** Throws a DemoError for a demo this engine can't play. Starts paused when content has changed, so the viewer is told first. */
  constructor(demo: Demo, level: Level, config: SimConfig) {
    checkTickRate(demo);
    this.check = new DemoCheck(demo);
    this.demo = demo;
    this.commands = demoCommands(demo);
    this.level = level;
    this.config = config;
    this.ctx = simContext(level, config);
    this.changes = contentChanges(demo, level, config);
    this.paused = this.changes.length > 0;
    this.state = startLevel(level, config, demo.seed);
    this.check.compare(this.state);
  }

  /** The first tick whose state doesn't match the recording's hash, or null while every tick has. */
  get divergedAt(): number | null {
    return this.check.divergedAt;
  }

  /** What differs at the first keyframe from divergedAt on where something still does, once playback reaches it. */
  get differences(): KeyframeDifferences | null {
    return this.check.differences;
  }

  get speed(): number {
    return PLAYBACK_SPEEDS[this.speedIndex]!;
  }

  get finished(): boolean {
    return this.state.tick >= this.demo.ticks;
  }

  /** Seconds into the demo, and its length. */
  get seconds(): number {
    return this.state.tick / TICK_RATE;
  }

  get length(): number {
    return this.demo.ticks / TICK_RATE;
  }

  faster(): void {
    this.speedIndex = Math.min(this.speedIndex + 1, PLAYBACK_SPEEDS.length - 1);
  }

  slower(): void {
    this.speedIndex = Math.max(this.speedIndex - 1, 0);
  }

  togglePause(): void {
    this.paused = !this.paused;
  }

  /** Goes back to the level's start, playing. Presentation that holds earlier ticks (interpolation, effects) must reset too. */
  rewind(): void {
    this.state = startLevel(this.level, this.config, this.demo.seed);
    this.check.compare(this.state);
    this.paused = false;
  }

  /** How fast sim time passes against real time: the speed, or 0 while paused or after the end. */
  get rate(): number {
    return this.paused || this.finished ? 0 : this.speed;
  }

  /** Plays the next tick and checks it against the recording. Returns null at the end. */
  step(): StepResult | null {
    if (this.finished) return null;
    const result = step(this.state, this.commands[this.state.tick]!, this.ctx);
    this.state = result.state;
    this.check.compare(this.state);
    return result;
  }
}

/** The page a demo is offered to: the game, map, and level file it's showing, and why it's unlit if it is. */
export interface PageLevel {
  readonly game: string;
  readonly map: string;
  readonly level: "bsp" | "map";
  /** The URL's lighting=off, which asks for the .map. */
  readonly lightingOff: boolean;
  /** Why the level is unlit, or "" if it's lit. */
  readonly note: string;
}

/** Whether a demo plays on this page, needs it reloaded on the demo's map and level file first, or can't play here. */
export type DemoPlace =
  | { readonly kind: "here" }
  | { readonly kind: "reload"; readonly search: string }
  | { readonly kind: "unplayable"; readonly reason: string };

/**
 * Where a demo plays: on the map and level file it was recorded on. search is the page's query string, kept but for
 * map and lighting; reloaded says the page was already reloaded for this demo, so it doesn't reload again.
 */
export function placeDemo(demo: Pick<Demo, "game" | "map" | "level">, page: PageLevel, search: string, reloaded: boolean): DemoPlace {
  if (demo.game !== page.game) return { kind: "unplayable", reason: `it was recorded in ${demo.game}, and this is ${page.game}` };
  if (demo.map === page.map && demo.level === page.level) return { kind: "here" };
  if (demo.map === page.map && demo.level === "bsp" && !page.lightingOff) {
    return { kind: "unplayable", reason: `it was recorded on ${demo.map}.bsp, which didn't load: ${page.note}` };
  }
  if (reloaded) return { kind: "unplayable", reason: `${demo.map}.${demo.level} didn't load` };
  const params = new URLSearchParams(search);
  params.set("map", demo.map);
  if (demo.level === "map") params.set("lighting", "off");
  else params.delete("lighting");
  return { kind: "reload", search: `?${params}` };
}

/** A playback speed as the overlay shows it: "1/4x", "1x", "4x". */
export const speedLabel = (speed: number): string => (speed < 1 ? `1/${1 / speed}x` : `${speed}x`);

/** Yaw (angle units) a fraction t of the way from a to b, the short way round, in radians. */
export function lerpYaw(a: number, b: number, t: number): number {
  const turn = ANGLE_UNITS_PER_TURN;
  const change = ((((b - a) % turn) + turn + turn / 2) % turn) - turn / 2;
  return angleToRadians(a + change * t);
}
