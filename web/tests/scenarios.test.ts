// Runs every engine-neutral scenario in /spec against the web sim.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { levelFromMap, type Level } from "../src/sim/level";
import { runScenario, type Scenario } from "../src/sim/scenario";
import { loadPlayerData, readRepoFile, REPO_ROOT } from "./helpers/data";

const config = { player: loadPlayerData() };
const levels = new Map<string, Level>();
const level = (name: string): Level => {
  if (!levels.has(name)) levels.set(name, levelFromMap(readRepoFile(`maps/${name}.map`)));
  return levels.get(name)!;
};

const files = readdirSync(join(REPO_ROOT, "spec")).filter((f) => f.endsWith(".json"));

describe("spec scenarios", () => {
  it.each(files)("%s", (file) => {
    const scenario = JSON.parse(readRepoFile(`spec/${file}`)) as Scenario;
    const result = runScenario(scenario, level(scenario.map), config);
    const report = result.checks
      .filter((c) => !c.passed)
      .map((c) => `at ${c.at}s (tick ${c.tick})${c.note ? ` [${c.note}]` : ""}:\n  ${c.failures.join("\n  ")}`)
      .join("\n");
    expect(result.passed, `${scenario.status} scenario failed:\n${report}`).toBe(true);
  });
});
