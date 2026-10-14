// Validates data and test scenarios against their schemas, then runs the
// cross-file checks (see packages/data). Each data/<name>.json is checked
// against data/schemas/<name>.schema.json, and each spec/<name>.json scenario
// against spec/schemas/scenario.schema.json.
//
// Usage: node tools/src/validate.ts   (or npm run validate)

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { crossCheck, fgdClassnames, fgdStyleChoices, lightStyleCheck, scenarioCheck } from "@mandreljs/data/checks";
import type { DataFiles, LightStylesFile, ScenarioFile } from "@mandreljs/data/checks";
import { SchemaError, SchemaValidator } from "@mandreljs/data/schema";
import { isMain, repoPath } from "./repo.ts";

const REQUIRED_DATA = ["player", "weapons", "enemies", "lightstyles"];

/** A schema validator reading schema files from a folder. */
export function folderValidator(dir: string): SchemaValidator {
  return new SchemaValidator((name) => {
    const path = join(dir, name);
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : undefined;
  });
}

/** maps/<name>.map's text, or null if it doesn't exist. */
export const readRepoMap = (name: string): string | null => {
  const path = repoPath("maps", `${name}.map`);
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
};

/** Validates each JSON file in a folder, printing results. Returns the valid files by name, and whether any failed. */
function validateFolder(dir: string, label: string, validator: SchemaValidator, schemaFor: (name: string) => string): { valid: Map<string, unknown>; failed: boolean } {
  const valid = new Map<string, unknown>();
  let failed = false;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
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

export function main(): number {
  const data = validateFolder(repoPath("data"), "data", folderValidator(repoPath("data", "schemas")), (name) => `${name}.schema.json`);
  const spec = validateFolder(repoPath("spec"), "spec", folderValidator(repoPath("spec", "schemas")), () => "scenario.schema.json");

  const missing = REQUIRED_DATA.filter((name) => !data.valid.has(name));
  if (data.failed || spec.failed || missing.length > 0) {
    if (missing.length > 0 && !data.failed) console.log(`FAIL  missing data files: ${missing.join(", ")}`);
    console.log("cross-file checks skipped until every file is valid");
    return 1;
  }

  const fgd = readFileSync(repoPath("maps", "trenchbroom", "mandrel.fgd"), "utf-8");
  const files = Object.fromEntries(data.valid) as unknown as DataFiles & { lightstyles: LightStylesFile };
  const errors = [...crossCheck(files, fgdClassnames(fgd)), ...lightStyleCheck(files.lightstyles, fgdStyleChoices(fgd))];
  for (const [name, scenario] of spec.valid) errors.push(...scenarioCheck(name, scenario as ScenarioFile, files, readRepoMap));

  console.log(`${errors.length === 0 ? "ok  " : "FAIL"}  cross-file checks`);
  for (const error of errors) console.log(`        ${error}`);
  return errors.length === 0 ? 0 : 1;
}

if (isMain(import.meta.url)) process.exitCode = main();
