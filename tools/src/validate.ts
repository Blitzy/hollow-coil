// Validates the engine's light styles, a game directory, and the test scenarios
// against their schemas, then runs the cross-file checks (see packages/defs).
// packages/defs/lightstyles.json and each file in the game's data/ are checked
// against packages/defs/schemas/<name>.schema.json, and each scenarios/<name>.json
// scenario against scenarios/schemas/scenario.schema.json. The game's data is
// checked against its TrenchBroom FGD, which includes the engine's.
//
// Usage: node tools/src/validate.ts [--game dir] [--quiet]   (or npm run validate)
//   --game   the game directory; default: the folder it runs in if that's a game,
//            otherwise example.
//            Scenarios run on the example game, so they're checked only with it.
//   --quiet  print only problems, and the final line

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  crossCheck,
  fgdClassnames,
  fgdStyleChoices,
  gameCheck,
  lightStyleCheck,
  resolveFgdIncludes,
  scenarioCheck,
  trenchbroomConfig,
} from "@mandreljs/defs/checks";
import type { DataFiles, GameFile, LightStylesFile, ScenarioFile } from "@mandreljs/defs/checks";
import { SchemaError, SchemaValidator } from "@mandreljs/defs/schema";
import { DEFS_DIR, displayPath, EXAMPLE_GAME, findGame, GameNotFoundError, IN_REPO, repoPath } from "./layout.ts";
import { isMain } from "./cli.ts";

const GAME_DATA = ["game", "player", "weapons", "enemies"];
/** The folder an engine FGD include starts with: install-trenchbroom links packages/defs/trenchbroom/ there. */
const ENGINE_INCLUDE = "mandreljs/";

/** A schema validator reading schema files from a folder. */
export function folderValidator(dir: string): SchemaValidator {
  return new SchemaValidator((name) => {
    const path = join(dir, name);
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : undefined;
  });
}

const readIfFile = (path: string): string | null => (existsSync(path) ? readFileSync(path, "utf-8") : null);

/** A game's maps/<name>.map text, or null if it doesn't exist. */
export const readGameMap = (game: string, name: string): string | null => readIfFile(join(game, "maps", `${name}.map`));

/** Every map in a game's maps/, by name. */
function gameMaps(game: string): Map<string, string> {
  const dir = join(game, "maps");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".map")).sort() : [];
  return new Map(files.map((f) => [basename(f, ".map"), readFileSync(join(dir, f), "utf-8")]));
}

/**
 * A game's FGD with its includes resolved. Includes under mandreljs/ come from packages/defs/trenchbroom/
 * whether or not install-trenchbroom has linked it in; the rest from the game's trenchbroom/.
 */
export function gameFgd(game: string, file: string): { text: string; problems: string[] } {
  const read = (path: string): string | null =>
    readIfFile(path.startsWith(ENGINE_INCLUDE) ? join(DEFS_DIR, "trenchbroom", path.slice(ENGINE_INCLUDE.length)) : join(game, "trenchbroom", path));
  const top = read(file);
  if (top === null) return { text: "", problems: [`trenchbroom/${file}: not found (named in trenchbroom/GameConfig.cfg)`] };
  return resolveFgdIncludes(top, read);
}

/** False with --quiet: print only problems and the final line. */
let showOk = true;

/** Validates one JSON file against a schema, printing the result. Returns the file's value, or undefined if it isn't valid. */
function validateFile(path: string, validator: SchemaValidator, schema: string, show: boolean = showOk): unknown {
  let value: unknown;
  let errors: string[];
  try {
    value = JSON.parse(readFileSync(path, "utf-8"));
    errors = validator.validate(value, schema);
  } catch (error) {
    if (error instanceof SyntaxError) errors = [`invalid JSON: ${error.message}`];
    else if (error instanceof SchemaError) errors = [`schema problem: ${error.message}`];
    else throw error;
  }
  if (errors.length > 0 || show) console.log(`${errors.length === 0 ? "ok  " : "FAIL"}  ${displayPath(path)}`);
  for (const error of errors) console.log(`        ${error}`);
  return errors.length === 0 ? value : undefined;
}

/** Validates each JSON file in a folder, printing results. Returns the valid files by name, and whether any failed. */
function validateFolder(dir: string, validator: SchemaValidator, schemaFor: (name: string) => string): { valid: Map<string, unknown>; failed: boolean } {
  const valid = new Map<string, unknown>();
  let failed = false;
  for (const file of existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : []) {
    const name = basename(file, ".json");
    const value = validateFile(join(dir, file), validator, schemaFor(name));
    if (value === undefined) failed = true;
    else valid.set(name, value);
  }
  return { valid, failed };
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const { values } = parseArgs({ args: argv, options: { game: { type: "string" }, quiet: { type: "boolean" } } });
  showOk = !values.quiet;
  let game: string;
  try {
    game = findGame(values.game);
  } catch (error) {
    if (!(error instanceof GameNotFoundError)) throw error;
    console.log(`FAIL  ${error.message}`);
    return 1;
  }
  const withScenarios = IN_REPO && resolve(game) === resolve(EXAMPLE_GAME);

  const dataValidator = folderValidator(join(DEFS_DIR, "schemas"));
  // The engine's own file: listed inside this repo, where it's edited; elsewhere only if it fails.
  const lightstyles = validateFile(join(DEFS_DIR, "lightstyles.json"), dataValidator, "lightstyles.schema.json", showOk && IN_REPO);
  const data = validateFolder(join(game, "data"), dataValidator, (name) => `${name}.schema.json`);
  const scenarios = withScenarios ? validateFolder(repoPath("scenarios"), folderValidator(repoPath("scenarios", "schemas")), () => "scenario.schema.json") : null;
  if (IN_REPO && !withScenarios && showOk) console.log("skip  scenarios/ (they run on the example game)");

  const missing = GAME_DATA.filter((name) => !data.valid.has(name)).map((name) => `${displayPath(join(game, "data"))}/${name}.json`);
  if (lightstyles === undefined || data.failed || scenarios?.failed || missing.length > 0) {
    if (missing.length > 0) console.log(`FAIL  missing or invalid data files: ${missing.join(", ")}`);
    console.log("cross-file checks skipped until every file is valid");
    return 1;
  }

  const files = { ...Object.fromEntries(data.valid), lightstyles } as unknown as DataFiles & {
    game: GameFile;
    lightstyles: LightStylesFile;
  };
  const errors: string[] = [];
  let config: { name: string; definitions: string[] } | null = null;
  try {
    config = trenchbroomConfig(readFileSync(join(game, "trenchbroom", "GameConfig.cfg"), "utf-8"));
  } catch (error) {
    errors.push(`trenchbroom/GameConfig.cfg: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (config !== null) {
    errors.push(...gameCheck(files.game, config.name, gameMaps(game)));
    // A config can offer several FGDs to choose from; the first is the game's own.
    const fgd = config.definitions[0] === undefined ? { text: "", problems: ["trenchbroom/GameConfig.cfg: no entity definition files"] } : gameFgd(game, config.definitions[0]);
    errors.push(...fgd.problems, ...crossCheck(files, fgdClassnames(fgd.text)), ...lightStyleCheck(files.lightstyles, fgdStyleChoices(fgd.text)));
  }
  for (const [name, scenario] of scenarios?.valid ?? []) errors.push(...scenarioCheck(name, scenario as ScenarioFile, files, (map) => readGameMap(game, map)));

  console.log(`${errors.length === 0 ? "ok  " : "FAIL"}  cross-file checks`);
  for (const error of errors) console.log(`        ${error}`);
  return errors.length === 0 ? 0 : 1;
}

if (isMain(import.meta.url)) process.exitCode = main();
