// Validates the engine's data, a game directory, and the test scenarios against
// their schemas, then runs the cross-file checks (see packages/data). The
// engine's data/lightstyles.json and each file in the game's data/ are checked
// against data/schemas/<name>.schema.json, and each spec/<name>.json scenario
// against spec/schemas/scenario.schema.json. The game's data is checked against
// its TrenchBroom FGD, which includes the engine's.
//
// Usage: node tools/src/validate.ts [--game dir]   (or npm run validate)
//   --game   the game directory, relative to the repo root; default: example.
//            Scenarios run on the example game, so they're checked only with it.

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
} from "@mandreljs/data/checks";
import type { DataFiles, GameFile, LightStylesFile, ScenarioFile } from "@mandreljs/data/checks";
import { SchemaError, SchemaValidator } from "@mandreljs/data/schema";
import { EXAMPLE_GAME, gameDir, isMain, relativeToRepo, repoPath } from "./repo.ts";

const ENGINE_DATA = ["lightstyles"];
const GAME_DATA = ["game", "player", "weapons", "enemies"];
/** The folder name an engine FGD include starts with: install-trenchbroom links the engine's trenchbroom/ there. */
const ENGINE_INCLUDE = "engine/";

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
 * A game's FGD with its includes resolved. Includes under engine/ come from the engine's
 * trenchbroom/ folder whether or not install-trenchbroom has linked it in; the rest from the game's trenchbroom/.
 */
export function gameFgd(game: string, file: string): { text: string; problems: string[] } {
  const read = (path: string): string | null =>
    readIfFile(path.startsWith(ENGINE_INCLUDE) ? repoPath("trenchbroom", path.slice(ENGINE_INCLUDE.length)) : join(game, "trenchbroom", path));
  const top = read(file);
  if (top === null) return { text: "", problems: [`trenchbroom/${file}: not found (named in trenchbroom/GameConfig.cfg)`] };
  return resolveFgdIncludes(top, read);
}

/** Validates each JSON file in a folder, printing results. Returns the valid files by name, and whether any failed. */
function validateFolder(dir: string, validator: SchemaValidator, schemaFor: (name: string) => string): { valid: Map<string, unknown>; failed: boolean } {
  const valid = new Map<string, unknown>();
  let failed = false;
  const label = relativeToRepo(dir);
  for (const file of existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : []) {
    const name = basename(file, ".json");
    let value: unknown;
    let errors: string[];
    try {
      value = JSON.parse(readFileSync(join(dir, file), "utf-8"));
      errors = validator.validate(value, schemaFor(name));
    } catch (error) {
      if (error instanceof SyntaxError) errors = [`invalid JSON: ${error.message}`];
      else if (error instanceof SchemaError) errors = [`schema problem: ${error.message}`];
      else throw error;
    }
    console.log(`${errors.length === 0 ? "ok  " : "FAIL"}  ${label}/${file}`);
    for (const error of errors) console.log(`        ${error}`);
    if (errors.length === 0) valid.set(name, value);
    else failed = true;
  }
  return { valid, failed };
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const { values } = parseArgs({ args: argv, options: { game: { type: "string" } } });
  const game = gameDir(values.game);
  const withScenarios = resolve(game) === resolve(EXAMPLE_GAME);

  const dataValidator = folderValidator(repoPath("data", "schemas"));
  const schemaFor = (name: string): string => `${name}.schema.json`;
  const engine = validateFolder(repoPath("data"), dataValidator, schemaFor);
  const data = validateFolder(join(game, "data"), dataValidator, schemaFor);
  const spec = withScenarios ? validateFolder(repoPath("spec"), folderValidator(repoPath("spec", "schemas")), () => "scenario.schema.json") : null;
  if (!withScenarios) console.log("skip  spec/ (scenarios run on the example game)");

  const missing = [
    ...ENGINE_DATA.filter((name) => !engine.valid.has(name)).map((name) => `data/${name}.json`),
    ...GAME_DATA.filter((name) => !data.valid.has(name)).map((name) => `${relativeToRepo(join(game, "data"))}/${name}.json`),
  ];
  if (engine.failed || data.failed || spec?.failed || missing.length > 0) {
    if (missing.length > 0) console.log(`FAIL  missing or invalid data files: ${missing.join(", ")}`);
    console.log("cross-file checks skipped until every file is valid");
    return 1;
  }

  const files = { ...Object.fromEntries(data.valid), lightstyles: engine.valid.get("lightstyles") } as unknown as DataFiles & {
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
  for (const [name, scenario] of spec?.valid ?? []) errors.push(...scenarioCheck(name, scenario as ScenarioFile, files, (map) => readGameMap(game, map)));

  console.log(`${errors.length === 0 ? "ok  " : "FAIL"}  cross-file checks`);
  for (const error of errors) console.log(`        ${error}`);
  return errors.length === 0 ? 0 : 1;
}

if (isMain(import.meta.url)) process.exitCode = main();
