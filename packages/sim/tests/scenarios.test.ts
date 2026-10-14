// Runs every engine-neutral scenario in /spec against the sim, and checks on
// every tick of every scenario that no enemy is ever inside the world.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { loadSimConfig, readRepoFile, REPO_ROOT } from "@mandreljs/testing";
import { describe, expect, it } from "vitest";
import { trace } from "@mandreljs/sim/collision/trace";
import { CONTENTS } from "@mandreljs/sim/constants";
import { alive, enemyContext } from "@mandreljs/sim/enemy/enemy";
import { levelFromMap, type Level } from "@mandreljs/sim/level";
import { runScenario, type Scenario } from "@mandreljs/sim/scenario";

const config = loadSimConfig();
const levels = new Map<string, Level>();
const level = (name: string): Level => {
  if (!levels.has(name)) levels.set(name, levelFromMap(readRepoFile(`example/maps/${name}.map`)));
  return levels.get(name)!;
};

const enemyTypes = enemyContext(config.enemies).types;
/** The brushes that block enemies (other entities aside). */
const WALLS = CONTENTS.SOLID | CONTENTS.WINDOW | CONTENTS.MONSTERCLIP;

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

    const world = level(scenario.map).world;
    result.states.forEach((state) => {
      for (const enemy of state.enemies.filter(alive)) {
        const { hull } = enemyTypes.get(enemy.type)!;
        const inside = trace(world, enemy.origin, enemy.origin, hull.mins, hull.maxs, WALLS).startSolid;
        expect(inside, `tick ${state.tick}: enemy ${enemy.id} at ${JSON.stringify(enemy.origin)} is inside the world`).toBe(false);
      }
    });
  });
});
