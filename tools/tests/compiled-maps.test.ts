// Every map in maps/, compiled with the pinned ericw-tools, loads from its .bsp
// as the same level it is as a .map: the same entities, the same brushes, the
// same sweep results, and the same /spec scenario runs (player and enemies),
// tick for tick. The game can then load either file. Skipped when the tools
// aren't installed (npm run setup); CI installs them before testing.

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSimConfig, readRepoFile } from "@mandreljs/testing";
import { brushBounds, brushMismatches, compareSweeps, near } from "@mandreljs/testing/level-parity";
import { hullFromData } from "@mandreljs/sim/data";
import { levelFromBsp, levelFromMap, type Level } from "@mandreljs/sim/level";
import { lightmapExtents, readBsp, type Bsp } from "@mandreljs/sim/map/bsp";
import { PLAYER_MASK } from "@mandreljs/sim/player/movement";
import { runScenario, type Scenario } from "@mandreljs/sim/scenario";
import { compileMap, compileOk, findMaps } from "../src/compile.ts";
import { repoPath } from "../src/repo.ts";
import { toolsInstalled } from "../src/setup.ts";

const MAPS = findMaps([]).map((path) => basename(path, ".map"));
const SCENARIOS = readdirSync(repoPath("spec"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => [f, JSON.parse(readRepoFile(`spec/${f}`)) as Scenario] as const);
const config = loadSimConfig();

/** How far apart the player may be, tick for tick, in a scenario run on the .map and the .bsp. */
const SCENARIO_TOLERANCE = 1e-3;

describe.skipIf(!toolsInstalled())("compiled maps match their .map (needs ericw-tools)", () => {
  const levels = new Map<string, { map: Level; bsp: Level; compiled: Bsp }>();
  let outDir = "";

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), "mandrel-parity-"));
    for (const name of MAPS) {
      const result = await compileMap(repoPath(`maps/${name}.map`), outDir);
      if (!compileOk(result)) throw new Error(`${name} failed to compile: ${result.problems.join("; ")}`);
      levels.set(name, {
        map: levelFromMap(readRepoFile(`maps/${name}.map`)),
        compiled: readBsp(readFileSync(join(outDir, `${name}.bsp`))),
        bsp: levelFromBsp(readBsp(readFileSync(join(outDir, `${name}.bsp`)))),
      });
    }
  }, 60_000);
  afterAll(() => rmSync(outDir, { recursive: true, force: true }));

  describe.each(MAPS)("%s", (name) => {
    // ericw-tools stores each lit face's styles back to back, padded to a multiple of 4 samples, so the
    // gap to the next face's lightmap must be exactly the size we compute. A face sized wrong draws its light smeared.
    it("sizes every lit face's lightmap exactly as ericw-tools laid it out", () => {
      const { compiled } = levels.get(name)!;
      const lit = compiled.faces.map((face, index) => ({ face, index })).filter(({ face }) => face.lightOffset >= 0);
      lit.sort((a, b) => a.face.lightOffset - b.face.lightOffset);
      const wrong = lit.flatMap(({ face, index }, i) => {
        const { width, height } = lightmapExtents(compiled, face);
        const gap = (lit[i + 1]?.face.lightOffset ?? compiled.lighting.byteLength) - face.lightOffset;
        const want = Math.ceil((width * height * face.styles.length) / 4) * 4 * 3;
        return gap === want ? [] : [`face ${index}: ${width} x ${height} x ${face.styles.length} styles is ${want} bytes, ericw-tools left ${gap}`];
      });
      expect(wrong).toEqual([]);
    });

    it("has the same entities, markers, and player start", () => {
      const { map, bsp } = levels.get(name)!;
      expect(bsp.entities).toEqual(map.entities);
      expect(bsp.markers).toEqual(map.markers);
      expect(bsp.playerStart).toEqual(map.playerStart);
    });

    it("has the same brushes, bevels included", () => {
      const { map, bsp } = levels.get(name)!;
      expect(brushMismatches(map, bsp)).toEqual([]);
    });

    it("gives the same results for random sweeps", () => {
      const { map, bsp } = levels.get(name)!;
      const { hits, differences } = compareSweeps(map, bsp, {
        hull: hullFromData(config.player.hull),
        region: brushBounds(map),
        reach: 512,
        mask: PLAYER_MASK,
        count: 5000,
        seed: 1,
      });
      expect(differences).toEqual([]);
      expect(hits).toBeGreaterThan(500);
    });
  });

  describe.each(SCENARIOS)("spec/%s", (_, scenario) => {
    it("runs the same on the .bsp as on the .map, tick for tick", () => {
      const { map, bsp } = levels.get(scenario.map)!;
      const a = runScenario(scenario, map, config);
      const b = runScenario(scenario, bsp, config);
      expect(b.passed).toBe(a.passed);
      expect(b.states).toHaveLength(a.states.length);
      a.states.forEach((sa, tick) => {
        const pa = sa.player;
        const pb = b.states[tick]!.player;
        const where = `tick ${tick}: ${JSON.stringify(pa.origin)} vs ${JSON.stringify(pb.origin)}`;
        expect(near(pa.origin, pb.origin, SCENARIO_TOLERANCE), where).toBe(true);
        expect(pb.onGround, where).toBe(pa.onGround);
        sa.enemies.forEach((ea, i) => {
          const eb = b.states[tick]!.enemies[i]!;
          const enemyWhere = `tick ${tick}, enemy ${i}: ${JSON.stringify(ea.origin)} vs ${JSON.stringify(eb.origin)}`;
          expect(near(ea.origin, eb.origin, SCENARIO_TOLERANCE), enemyWhere).toBe(true);
          expect(eb.mode, enemyWhere).toBe(ea.mode);
        });
      });
    });
  });
});
