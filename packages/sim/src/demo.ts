// Demos: a recorded game's input commands, and what the sim did with them, replayed
// as regression tests. The format is described in demos/README.md. In short:
//
//   - The inputs are what matter: a person played them, and they can't be made
//     again. They're stored by field name, each field its own run-length column,
//     so a demo stays readable as the input command grows: a missing column is
//     that field's neutral value, and an unknown column or action is an error.
//   - The hashes (one per tick) and keyframes (a full state every few seconds) are
//     derived from the inputs. A replay compares them; when behavior changes on
//     purpose, rebaselineDemo makes them again from the inputs.
//
// A demo always starts at the level's start (startLevel), and replays on the
// game's current map and data. Its header holds hashes of the content it was
// recorded on (contentHashes), so a replay can say which content has changed
// since, rather than just where the play first differs.

import { TICK_RATE } from "./constants.ts";
import { NEUTRAL_COMMAND, wrapYaw, type InputCommand } from "./input.ts";
import type { Level } from "./level.ts";
import { hashState, hashValue } from "./snapshot.ts";
import { simContext, startLevel, step, type SimConfig, type SimState } from "./sim.ts";

export const DEMO_FORMAT = "mandreljs-demo";
/** The format's version. Additive changes (new columns, actions, or header fields) don't change it; see upgradeDemo. */
export const DEMO_VERSION = 1;
/** Seconds between keyframes. */
export const KEYFRAME_SECONDS = 5;

/**
 * One input field, as runs: [value, count, value, count, ...]. With "delta-runs" the values are changes from the
 * previous tick (from 0 before the first), which keeps a turning view compact.
 */
export interface DemoColumn {
  readonly encoding: "runs" | "delta-runs";
  readonly runs: readonly number[];
}

/** Something that happened at a tick that isn't part of the input command. There are no types yet; see demos/README.md. */
export interface DemoAction {
  readonly tick: number;
  readonly type: string;
}

/** Where a demo was recorded: everything but the inputs and what the sim did with them. */
export interface DemoHeader {
  /** The game's name, from its data/game.json. */
  readonly game: string;
  readonly map: string;
  /** Which file the level came from. They collide alike, but not to the last bit, so a replay uses the same one. */
  readonly level: "bsp" | "map";
  readonly seed: number;
  /** The engine's version it was recorded with, for people reading the file. */
  readonly engine?: string;
  /** Hashes of the content it was recorded on (see contentHashes). */
  readonly content: DemoContent;
}

/**
 * Hashes of the content a demo plays on, 8 hex digits each: the level as the sim sees it ("map"), and each data file.
 * A demo without a key that a newer engine adds isn't checked for it.
 */
export type DemoContent = Readonly<Record<string, string>>;

export interface Demo extends DemoHeader {
  readonly format: typeof DEMO_FORMAT;
  readonly version: number;
  readonly tick_rate: number;
  /** Ticks recorded: commands for ticks 1 to ticks. */
  readonly ticks: number;
  readonly commands: Readonly<Record<string, DemoColumn>>;
  readonly actions: readonly DemoAction[];
  /** hashState of the state at each tick from 0 (the start) to ticks, 8 hex digits each. */
  readonly hashes: string;
  /** Full states every KEYFRAME_SECONDS from tick 0, and the last. */
  readonly keyframes: readonly { readonly tick: number; readonly state: SimState }[];
}

export class DemoError extends Error {
  override name = "DemoError";
}

/** How each input field is stored. Yaw wraps around a turn, so its changes are taken the short way round. */
const COLUMNS: Readonly<Record<keyof InputCommand, { readonly encoding: DemoColumn["encoding"]; readonly wraps?: boolean }>> = {
  yaw: { encoding: "delta-runs", wraps: true },
  pitch: { encoding: "delta-runs" },
  forward: { encoding: "runs" },
  side: { encoding: "runs" },
  buttons: { encoding: "runs" },
  weapon: { encoding: "runs" },
};
const FIELDS = Object.keys(COLUMNS) as (keyof InputCommand)[];
const HALF_TURN = 32768;
const HASH_LENGTH = 8;

/** A change in yaw taken the short way round, from -32768 to 32767. */
const yawChange = (from: number, to: number): number => wrapYaw(to - from + HALF_TURN) - HALF_TURN;

function encodeColumn(values: readonly number[], spec: (typeof COLUMNS)[keyof InputCommand]): DemoColumn {
  let previous = 0;
  const stored = spec.encoding === "runs" ? values : values.map((v) => {
    const change = spec.wraps ? yawChange(previous, v) : v - previous;
    previous = v;
    return change;
  });
  const runs: number[] = [];
  for (const value of stored) {
    if (runs.length > 0 && runs[runs.length - 2] === value) runs[runs.length - 1]!++;
    else runs.push(value, 1);
  }
  return { encoding: spec.encoding, runs };
}

function decodeColumn(name: string, column: DemoColumn, ticks: number, wraps: boolean): number[] {
  if (column.encoding !== "runs" && column.encoding !== "delta-runs") throw new DemoError(`input "${name}" has an unknown encoding, "${String(column.encoding)}"`);
  if (!Array.isArray(column.runs) || column.runs.length % 2 !== 0) throw new DemoError(`input "${name}" has malformed runs`);
  const values: number[] = [];
  let current = 0;
  for (let i = 0; i < column.runs.length; i += 2) {
    const value = column.runs[i]!;
    const count = column.runs[i + 1]!;
    if (!Number.isInteger(value) || !Number.isInteger(count) || count < 1) throw new DemoError(`input "${name}" has a malformed run at ${i}`);
    for (let n = 0; n < count; n++) {
      if (column.encoding === "runs") current = value;
      else current = wraps ? wrapYaw(current + value) : current + value;
      values.push(current);
    }
  }
  if (values.length !== ticks) throw new DemoError(`input "${name}" has ${values.length} ticks, not ${ticks}`);
  return values;
}

/**
 * A demo read from parsed JSON, upgraded to the current version. Throws a DemoError for a file that isn't a demo or
 * that needs a newer engine. Versions before DEMO_VERSION are upgraded here, so old files keep loading.
 */
export function upgradeDemo(json: unknown): Demo {
  const demo = json as Partial<Demo> | null;
  if (typeof demo !== "object" || demo === null || demo.format !== DEMO_FORMAT) throw new DemoError(`not a demo: its "format" isn't "${DEMO_FORMAT}"`);
  if (typeof demo.version !== "number" || !Number.isInteger(demo.version) || demo.version < 1) throw new DemoError("the demo has no valid version");
  if (demo.version > DEMO_VERSION) throw new DemoError(`the demo is format version ${demo.version}, recorded by a newer engine; this one reads up to ${DEMO_VERSION}`);
  // No older versions yet. A breaking change bumps DEMO_VERSION and adds its upgrade here, oldest first.
  for (const key of ["game", "map", "level", "seed", "tick_rate", "ticks", "content", "commands", "actions", "hashes", "keyframes"] as const) {
    if (demo[key] === undefined) throw new DemoError(`the demo has no "${key}"`);
  }
  return demo as Demo;
}

/** Entity classes that only light the level, which play never reads. */
const LIGHTING = /^light/;

/**
 * Hashes of what the sim plays on: the level's collision brushes and the entities play reads (lights and
 * worldspawn's settings only affect lighting, so changing them doesn't change a demo), and each data file without its
 * $schema. Hashing what the sim uses rather than the files means line endings, formatting, and texture alignment
 * don't matter.
 */
export function contentHashes(level: Level, config: SimConfig): Record<string, string> {
  const entities = level.entities.filter((e, i) => i > 0 && !LIGHTING.test(e.classname ?? ""));
  const withoutSchema = (data: object): object => Object.fromEntries(Object.entries(data).filter(([key]) => key !== "$schema"));
  return {
    map: hashValue({ brushes: level.world.brushes, entities }),
    player: hashValue(withoutSchema(config.player)),
    weapons: hashValue(withoutSchema(config.weapons)),
    enemies: hashValue(withoutSchema(config.enemies)),
  };
}

/** The content a demo was recorded on that has changed since: "map" or a data file's name. Content a demo has no hash for isn't checked. */
export function contentChanges(demo: Demo, level: Level, config: SimConfig): string[] {
  const now = contentHashes(level, config);
  return Object.keys(now).filter((key) => demo.content[key] !== undefined && demo.content[key] !== now[key]);
}

/** Every tick's input command, from the demo's columns. Throws a DemoError for inputs or actions this engine doesn't know. */
export function demoCommands(demo: Demo): InputCommand[] {
  for (const name of Object.keys(demo.commands)) {
    if (!Object.hasOwn(COLUMNS, name)) throw new DemoError(`the demo has an input this engine doesn't know, "${name}": it was recorded by a newer engine`);
  }
  for (const action of demo.actions) {
    throw new DemoError(`the demo has an action this engine doesn't know, "${action.type}" at tick ${action.tick}: it was recorded by a newer engine`);
  }
  const columns = new Map(
    FIELDS.map((field) => {
      const column = demo.commands[field];
      // A field the demo doesn't have keeps its neutral value: what an engine before that field did.
      return [field, column === undefined ? null : decodeColumn(field, column, demo.ticks, COLUMNS[field].wraps === true)] as const;
    }),
  );
  return Array.from({ length: demo.ticks }, (_, i) => {
    const cmd: Record<string, number> = {};
    for (const field of FIELDS) cmd[field] = columns.get(field)?.[i] ?? NEUTRAL_COMMAND[field];
    return cmd as unknown as InputCommand;
  });
}

/** Records a demo tick by tick, from the state a level starts in (startLevel). */
export class DemoRecorder {
  private readonly header: DemoHeader;
  private readonly commands: InputCommand[] = [];
  private readonly hashes: string[];
  private readonly keyframes: { tick: number; state: SimState }[];
  private last: SimState;
  private readonly keyframeTicks = KEYFRAME_SECONDS * TICK_RATE;

  constructor(header: DemoHeader, start: SimState) {
    if (start.tick !== 0) throw new DemoError("a demo starts at a level's start, tick 0");
    this.header = header;
    this.hashes = [hashState(start)];
    this.keyframes = [{ tick: 0, state: start }];
    this.last = start;
  }

  /** Ticks recorded so far. */
  get ticks(): number {
    return this.commands.length;
  }

  /** Records one tick: the command it ran with, and the state it ended in. */
  record(cmd: InputCommand, state: SimState): void {
    this.commands.push(cmd);
    this.hashes.push(hashState(state));
    if (state.tick % this.keyframeTicks === 0) this.keyframes.push({ tick: state.tick, state });
    this.last = state;
  }

  finish(): Demo {
    const keyframes = this.keyframes.at(-1)!.tick === this.last.tick ? this.keyframes : [...this.keyframes, { tick: this.last.tick, state: this.last }];
    const { game, map, level, seed, engine, content } = this.header;
    return {
      format: DEMO_FORMAT,
      version: DEMO_VERSION,
      game,
      map,
      level,
      seed,
      ...(engine === undefined ? {} : { engine }),
      tick_rate: TICK_RATE,
      ticks: this.commands.length,
      content,
      commands: Object.fromEntries(FIELDS.map((field) => [field, encodeColumn(this.commands.map((c) => c[field]), COLUMNS[field])])),
      actions: [],
      hashes: this.hashes.join(""),
      // A state's JSON form, as a file holds it.
      keyframes: keyframes.map(({ tick, state }) => ({ tick, state: JSON.parse(JSON.stringify(state)) as SimState })),
    };
  }
}

/** Where a replay first differs from the recording. */
export interface Divergence {
  readonly tick: number;
  /** The keyframe compared to say what differs: the first after tick where something still does (none if it all evened out). */
  readonly keyframe: number;
  /** What differs at that keyframe, as "path: recorded -> replayed" lines (the first few). */
  readonly differences: readonly string[];
}

export interface ReplayResult {
  readonly divergence: Divergence | null;
  /** The state at every tick, from 0. */
  readonly states: readonly SimState[];
}

/** The recorded hashState at a tick, from 0 to the demo's ticks. */
export const demoHash = (demo: Demo, tick: number): string => demo.hashes.slice(tick * HASH_LENGTH, (tick + 1) * HASH_LENGTH);

/** Throws a DemoError unless the demo has a hash for every tick from 0 to its last. */
export function checkDemoHashes(demo: Demo): void {
  if (demo.hashes.length !== (demo.ticks + 1) * HASH_LENGTH) throw new DemoError(`the demo has ${demo.hashes.length / HASH_LENGTH} hashes for ${demo.ticks} ticks`);
}

/** Up to max "path: recorded -> replayed" lines where two plain-data values differ. */
export function differences(recorded: unknown, replayed: unknown, max = 10, path = ""): string[] {
  const show = (v: unknown): string => JSON.stringify(v) ?? "undefined";
  if (typeof recorded !== "object" || typeof replayed !== "object" || recorded === null || replayed === null) {
    return recorded === replayed ? [] : [`${path || "(state)"}: ${show(recorded)} -> ${show(replayed)}`];
  }
  const out: string[] = [];
  const keys = [...new Set([...Object.keys(recorded), ...Object.keys(replayed)])];
  for (const key of keys) {
    if (out.length >= max) break;
    const at = Array.isArray(recorded) ? `${path}[${key}]` : path ? `${path}.${key}` : key;
    out.push(...differences((recorded as Record<string, unknown>)[key], (replayed as Record<string, unknown>)[key], max - out.length, at));
  }
  return out;
}

/** Throws a DemoError unless the demo was recorded at the sim's tick rate, the only one it replays at. */
export function checkTickRate(demo: Demo): void {
  if (demo.tick_rate !== TICK_RATE) throw new DemoError(`the demo was recorded at ${demo.tick_rate} ticks a second, and the sim runs at ${TICK_RATE}`);
}

/** Runs a demo's inputs on its level and the game's data, from the level's start: the state at every tick, from 0. */
function runDemo(demo: Demo, level: Level, config: SimConfig): { commands: InputCommand[]; states: SimState[] } {
  checkTickRate(demo);
  const commands = demoCommands(demo);
  const ctx = simContext(level, config);
  const states = [startLevel(level, config, demo.seed)];
  for (const cmd of commands) states.push(step(states.at(-1)!, cmd, ctx).state);
  return { commands, states };
}

/**
 * Replays a demo on its level (loaded from the file its header names) and the game's data, and finds the first tick
 * that differs, if any. Check contentChanges first: on changed content, a difference is expected.
 */
export function replayDemo(demo: Demo, level: Level, config: SimConfig): ReplayResult {
  checkDemoHashes(demo);
  const { states } = runDemo(demo, level, config);
  const first = states.findIndex((state) => hashState(state) !== demoHash(demo, state.tick));
  if (first === -1) return { divergence: null, states };
  // Say what differs at the first keyframe after it where something still does (a tiny difference can even out).
  const later = demo.keyframes.filter((k) => k.tick >= first);
  const compared = later.map((k) => ({ tick: k.tick, differences: differences(k.state, JSON.parse(JSON.stringify(states[k.tick])) as unknown) }));
  const shown = compared.find((k) => k.differences.length > 0) ?? compared[0] ?? { tick: first, differences: [] };
  return { divergence: { tick: first, keyframe: shown.tick, differences: shown.differences }, states };
}

/**
 * The demo with its hashes and keyframes made again from its inputs, on the current level and data, and its content
 * hashes updated: for when behavior or content changes on purpose.
 */
export function rebaselineDemo(demo: Demo, level: Level, config: SimConfig): Demo {
  const { commands, states } = runDemo(demo, level, config);
  const { game, map, level: source, seed, engine } = demo;
  const recorder = new DemoRecorder({ game, map, level: source, seed, engine, content: contentHashes(level, config) }, states[0]!);
  commands.forEach((cmd, i) => recorder.record(cmd, states[i + 1]!));
  return recorder.finish();
}

/** A demo as file text: one line per header field and input column, so a diff shows what changed. */
export function formatDemo(demo: Demo): string {
  const lines = Object.entries(demo).filter(([, value]) => value !== undefined).map(([key, value]) => {
    if (key === "commands") {
      const columns = Object.entries(value as Record<string, DemoColumn>).map(([name, column]) => `    ${JSON.stringify(name)}: ${JSON.stringify(column)}`);
      return `  "commands": {\n${columns.join(",\n")}\n  }`;
    }
    if (key === "keyframes") {
      const frames = (value as Demo["keyframes"]).map((k) => `    ${JSON.stringify(k)}`);
      return `  "keyframes": [\n${frames.join(",\n")}\n  ]`;
    }
    return `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`;
  });
  return `{\n${lines.join(",\n")}\n}\n`;
}
