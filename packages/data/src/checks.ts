// Checks that span files, which the schemas can't express. Each assumes its
// files already passed their schemas. No file access: callers pass file text.
//
//   - the player's weapons and starting weapon exist in weapons.json
//   - weapon slots are unique
//   - enemy classnames are defined in the TrenchBroom FGD
//   - the FGD's light style choices match lightstyles.json, number and name
//   - hull mins are below maxs on every axis
//   - each scenario's map exists, and every marker it names is an info_marker in
//     that map (marker names must be unique within a map)
//   - scenario input segments are in order and fit the duration; checks happen
//     within the duration; position, velocity, and last_hit checks have a tolerance
//   - scenario weapon selections are real weapon slots, and weapon checks name real weapons

import { parseMap } from "@hollow-coil/sim/map/parse";
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
export interface LightStylesFile {
  styles: Record<string, { name: string; pattern: string }>;
}
export interface ScenarioFile {
  map: string;
  duration: number;
  start: { marker: string };
  inputs: { until: number; weapon?: number }[];
  expect: { at: number; position?: unknown; velocity?: unknown; last_hit?: unknown; tolerance?: number; near_marker?: { name: string }; weapon?: string }[];
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
export function mapMarkers(text: string, fileName: string): { markers: Map<string, number[]>; problems: string[] } {
  const markers = new Map<string, number[]>();
  const problems: string[] = [];
  let entities;
  try {
    entities = parseMap(text);
  } catch (error) {
    return { markers, problems: [`${fileName}: ${error instanceof Error ? error.message : String(error)}`] };
  }
  for (const { properties } of entities) {
    if (properties.classname !== "info_marker") continue;
    const name = properties.name ?? "";
    if (markers.has(name)) problems.push(`${fileName}: marker name ${show(name)} is used more than once`);
    markers.set(name, (properties.origin ?? "0 0 0").trim().split(/\s+/).map(Number));
  }
  return { markers, problems };
}

/**
 * Checks on one scenario that its schema can't express. readMap returns
 * maps/<name>.map's text, or null if there's no such map.
 */
export function scenarioCheck(
  name: string,
  scenario: ScenarioFile,
  weapons: DataFiles["weapons"]["weapons"],
  readMap: (map: string) => string | null,
): string[] {
  const label = `spec/${name}.json`;
  const mapFile = `${scenario.map}.map`;
  const text = readMap(scenario.map);
  if (text === null) return [`${label}: map ${show(scenario.map)} not found (${mapFile})`];
  const { markers, problems } = mapMarkers(text, mapFile);
  const errors = [...problems];
  const weaponSlots = new Set(Object.values(weapons).map((w) => w.slot));

  const named = [scenario.start.marker, ...scenario.expect.flatMap((e) => (e.near_marker ? [e.near_marker.name] : []))];
  for (const marker of named) {
    if (!markers.has(marker)) errors.push(`${label}: marker ${show(marker)} is not an info_marker in ${mapFile}`);
  }

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
    const measured = expectation.position !== undefined || expectation.velocity !== undefined || expectation.last_hit !== undefined;
    if (measured && expectation.tolerance === undefined) {
      errors.push(`${label}: expect[${i}] checks position, velocity, or last_hit but has no tolerance`);
    }
    if (expectation.weapon !== undefined && !Object.hasOwn(weapons, expectation.weapon)) {
      errors.push(`${label}: expect[${i}].weapon ${show(expectation.weapon)} is not defined in weapons.json`);
    }
  });
  return errors;
}
