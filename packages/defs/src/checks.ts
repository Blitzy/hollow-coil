// Checks that span files, which the schemas can't express. Each assumes its
// files already passed their schemas. No file access: callers pass file text.
//
//   - the player's weapons and starting weapon exist in weapons.json
//   - weapon slots are unique
//   - enemy classnames are defined in the game's TrenchBroom FGD (with the engine's, which it includes)
//   - the FGD's light style choices match lightstyles.json, number and name
//   - a game's TrenchBroom config and its maps' // Game: headers have the game's name,
//     and its start map exists
//   - hull mins are below maxs on every axis
//   - each scenario's map exists, and every marker it names is an info_marker in
//     that map (marker names must be unique within a map)
//   - scenario input segments are in order and fit the duration; checks happen
//     within the duration; position, velocity, and last_hit checks have a tolerance
//   - scenario weapon selections are real weapon slots, and weapon checks name real weapons
//   - scenario enemies are real enemy types, placed at a marker or a position (not
//     both), and enemy checks name an enemy the scenario has

import { parseMap } from "@mandreljs/sim/map/parse";
import { show } from "./schema.ts";

// Loose shapes of the files, enough for these checks (the schemas guarantee the rest).
interface Hull {
  mins: number[];
  maxs: number[];
}
export interface DataFiles {
  player: { weapons: string[]; starting_weapon: string; hull: Hull };
  weapons: { weapons: Record<string, { slot: number }> };
  enemies: { enemies: Record<string, { classname: string; hull: Hull }> };
}
export interface GameFile {
  name: string;
  start_map: string;
}
export interface LightStylesFile {
  styles: Record<string, { name: string; pattern: string }>;
}
export interface ScenarioFile {
  map: string;
  duration: number;
  start: { marker: string };
  map_enemies?: boolean;
  enemies?: { type: string; marker?: string; position?: number[]; yaw: number }[];
  inputs: { until: number; weapon?: number }[];
  expect: {
    at: number;
    position?: unknown;
    velocity?: unknown;
    last_hit?: unknown;
    tolerance?: number;
    near_marker?: { name: string };
    weapon?: string;
    enemy?: { index: number; position?: unknown };
  }[];
}

/**
 * The FGD's text with each `@include "file"` replaced by that file's text, recursively, as
 * TrenchBroom reads it. readFile gets an included file's path relative to the top FGD's folder,
 * with forward slashes, and returns null if there's no such file.
 */
export function resolveFgdIncludes(fgd: string, readFile: (path: string) => string | null): { text: string; problems: string[] } {
  const problems: string[] = [];
  const expand = (text: string, dir: string, seen: readonly string[]): string =>
    text.replace(/^[ \t]*@include[ \t]+"([^"]+)"[ \t]*\r?$/gm, (_, file: string) => {
      const path = dir + file;
      if (seen.includes(path)) {
        problems.push(`FGD: ${path} includes itself`);
        return "";
      }
      const included = readFile(path);
      if (included === null) {
        problems.push(`FGD: included file ${show(path)} not found`);
        return "";
      }
      return expand(included, path.slice(0, path.lastIndexOf("/") + 1), [...seen, path]);
    });
  return { text: expand(fgd, "", []), problems };
}

/** JSON text with // comments removed, leaving strings alone. */
function withoutLineComments(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inString = false;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i + 1 < text.length && text[i + 1] !== "\n") i++;
    } else {
      inString = c === '"';
      out += c;
    }
  }
  return out;
}

/** A TrenchBroom game config's name and entity definition files. The config is JSON with // comments. Throws if it isn't. */
export function trenchbroomConfig(text: string): { name: string; definitions: string[] } {
  const config = JSON.parse(withoutLineComments(text)) as { name?: unknown; entities?: { definitions?: unknown } };
  const definitions = config.entities?.definitions;
  if (typeof config.name !== "string") throw new Error("the config has no name");
  if (!Array.isArray(definitions) || !definitions.every((d) => typeof d === "string")) throw new Error("the config has no entity definitions list");
  return { name: config.name, definitions };
}

/** The game a map belongs to, from the `// Game: <name>` line TrenchBroom writes at its top, or null if it has none. */
export function mapGameName(text: string): string | null {
  for (const line of text.split("\n")) {
    if (!line.startsWith("//")) break;
    const game = /^\/\/ Game: (.*?)\s*$/.exec(line);
    if (game) return game[1]!;
  }
  return null;
}

/**
 * A game directory agrees on the game's name: its TrenchBroom config has it (TrenchBroom
 * shows the game by that name) and each map's `// Game:` header names it (TrenchBroom
 * picks a map's config by that header). Its start map must exist too. maps holds each
 * map's text by name, as in maps/<name>.map.
 */
export function gameCheck(game: GameFile, configName: string, maps: ReadonlyMap<string, string>): string[] {
  const errors: string[] = [];
  if (configName !== game.name) errors.push(`trenchbroom/GameConfig.cfg: name ${show(configName)} is not the game's name, ${show(game.name)} (data/game.json)`);
  for (const [name, text] of maps) {
    const header = mapGameName(text);
    if (header !== game.name) {
      const found = header === null ? "has no // Game: line" : `says // Game: ${header}`;
      errors.push(`maps/${name}.map: ${found}, but the game is ${show(game.name)}`);
    }
  }
  if (!maps.has(game.start_map)) errors.push(`data/game.json: start_map ${show(game.start_map)} not found (maps/${game.start_map}.map)`);
  return errors;
}

/** Entity classnames the FGD defines. */
export function fgdClassnames(fgd: string): Set<string> {
  return new Set([...fgd.matchAll(/^@\w+Class\b[^=]*=\s*(\w+)/gm)].map((m) => m[1]!));
}

/** The light entity's style choices in the FGD, as number to name. */
export function fgdStyleChoices(fgd: string): Map<number, string> {
  const block = /\bstyle\(choices\)[^[]*\[([\s\S]*?)\]/.exec(fgd);
  if (!block) return new Map();
  return new Map([...block[1]!.matchAll(/^\s*(\d+)\s*:\s*"([^"]*)"/gm)].map((m) => [Number(m[1]), m[2]!]));
}

export function checkHull(hull: Hull, where: string): string[] {
  return [0, 1, 2].every((i) => hull.mins[i]! < hull.maxs[i]!) ? [] : [`${where}: hull mins must be below maxs on every axis`];
}

/** Player, weapon, and enemy checks across player.json, weapons.json, enemies.json, and the FGD's classnames. */
export function crossCheck(data: DataFiles, classnames: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  const { player } = data;
  const weapons = data.weapons.weapons;

  for (const id of player.weapons) {
    if (!Object.hasOwn(weapons, id)) errors.push(`player.json: weapon ${show(id)} is not defined in weapons.json`);
  }
  if (!player.weapons.includes(player.starting_weapon)) {
    errors.push(`player.json: starting_weapon ${show(player.starting_weapon)} is not in the player's weapons`);
  }
  errors.push(...checkHull(player.hull, "player.json"));

  const slots = new Map<number, string>();
  for (const [id, weapon] of Object.entries(weapons)) {
    const owner = slots.get(weapon.slot);
    if (owner !== undefined) errors.push(`weapons.json: ${show(id)} and ${show(owner)} both use slot ${weapon.slot}`);
    slots.set(weapon.slot, id);
  }

  for (const [id, enemy] of Object.entries(data.enemies.enemies)) {
    if (!classnames.has(enemy.classname)) {
      errors.push(`enemies.json: ${show(id)} classname ${show(enemy.classname)} is not defined in the FGD`);
    }
    errors.push(...checkHull(enemy.hull, `enemies.json: ${show(id)}`));
  }
  return errors;
}

/** The FGD offers exactly the styles lightstyles.json defines, under the same names. */
export function lightStyleCheck(lightstyles: LightStylesFile, choices: ReadonlyMap<number, string>): string[] {
  const defined = new Map(Object.entries(lightstyles.styles).map(([n, style]) => [Number(n), style.name]));
  const numbers = [...new Set([...defined.keys(), ...choices.keys()])].sort((a, b) => a - b);
  const errors: string[] = [];
  for (const n of numbers) {
    const name = defined.get(n);
    const choice = choices.get(n);
    if (choice === undefined) errors.push(`lightstyles.json: style ${n} (${show(name)}) is not a style choice in the FGD`);
    else if (name === undefined) errors.push(`FGD: light style choice ${n} (${show(choice)}) is not defined in lightstyles.json`);
    else if (name !== choice) errors.push(`lightstyles.json: style ${n} is named ${show(name)} but the FGD calls it ${show(choice)}`);
  }
  return errors;
}

/** info_marker origins by name from .map text, plus any problems (such as duplicate names or a syntax error). */
export function mapMarkers(text: string, fileName: string): { markers: Map<string, number[]>; classnames: string[]; problems: string[] } {
  const markers = new Map<string, number[]>();
  const problems: string[] = [];
  let entities;
  try {
    entities = parseMap(text);
  } catch (error) {
    return { markers, classnames: [], problems: [`${fileName}: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const classnames = entities.map((e) => e.properties.classname ?? "");
  for (const { properties } of entities) {
    if (properties.classname !== "info_marker") continue;
    const name = properties.name ?? "";
    if (markers.has(name)) problems.push(`${fileName}: marker name ${show(name)} is used more than once`);
    markers.set(name, (properties.origin ?? "0 0 0").trim().split(/\s+/).map(Number));
  }
  return { markers, classnames, problems };
}

/**
 * Checks on one scenario that its schema can't express. readMap returns
 * maps/<name>.map's text, or null if there's no such map.
 */
export function scenarioCheck(
  name: string,
  scenario: ScenarioFile,
  data: Pick<DataFiles, "weapons" | "enemies">,
  readMap: (map: string) => string | null,
): string[] {
  const weapons = data.weapons.weapons;
  const enemies = data.enemies.enemies;
  const label = `scenarios/${name}.json`;
  const mapFile = `${scenario.map}.map`;
  const text = readMap(scenario.map);
  if (text === null) return [`${label}: map ${show(scenario.map)} not found (${mapFile})`];
  const { markers, classnames, problems } = mapMarkers(text, mapFile);
  const errors = [...problems];
  const weaponSlots = new Set(Object.values(weapons).map((w) => w.slot));

  const placed = scenario.enemies ?? [];
  const named = [
    scenario.start.marker,
    ...scenario.expect.flatMap((e) => (e.near_marker ? [e.near_marker.name] : [])),
    ...placed.flatMap((e) => (e.marker !== undefined ? [e.marker] : [])),
  ];
  for (const marker of named) {
    if (!markers.has(marker)) errors.push(`${label}: marker ${show(marker)} is not an info_marker in ${mapFile}`);
  }

  placed.forEach((enemy, i) => {
    if (!Object.hasOwn(enemies, enemy.type)) errors.push(`${label}: enemies[${i}].type ${show(enemy.type)} is not defined in enemies.json`);
    if ((enemy.marker === undefined) === (enemy.position === undefined)) {
      errors.push(`${label}: enemies[${i}] needs exactly one of marker and position`);
    }
  });
  const enemyClassnames = new Set(Object.values(enemies).map((e) => e.classname));
  const mapEnemies = scenario.map_enemies ? classnames.filter((c) => enemyClassnames.has(c)).length : 0;
  const enemyCount = mapEnemies + placed.length;

  const { duration } = scenario;
  let previous = 0;
  scenario.inputs.forEach((segment, i) => {
    if (segment.until <= previous) errors.push(`${label}: inputs[${i}].until (${segment.until}) must be after ${previous}`);
    previous = segment.until;
    if (segment.weapon && !weaponSlots.has(segment.weapon)) {
      errors.push(`${label}: inputs[${i}].weapon ${segment.weapon} is not a weapon slot in weapons.json`);
    }
  });
  if (previous > duration) errors.push(`${label}: inputs run until ${previous}, past the duration ${duration}`);

  scenario.expect.forEach((expectation, i) => {
    if (expectation.at > duration) errors.push(`${label}: expect[${i}].at (${expectation.at}) is past the duration ${duration}`);
    const measured =
      expectation.position !== undefined || expectation.velocity !== undefined || expectation.last_hit !== undefined || expectation.enemy?.position !== undefined;
    if (measured && expectation.tolerance === undefined) {
      errors.push(`${label}: expect[${i}] checks a position, velocity, or last_hit but has no tolerance`);
    }
    if (expectation.enemy && expectation.enemy.index >= enemyCount) {
      errors.push(`${label}: expect[${i}].enemy.index ${expectation.enemy.index} is past the scenario's ${enemyCount} enemies`);
    }
    if (expectation.weapon !== undefined && !Object.hasOwn(weapons, expectation.weapon)) {
      errors.push(`${label}: expect[${i}].weapon ${show(expectation.weapon)} is not defined in weapons.json`);
    }
  });
  return errors;
}
