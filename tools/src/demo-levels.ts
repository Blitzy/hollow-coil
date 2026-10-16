// What demos replay on in Node: a game's current data, and its levels, loaded
// from a map's .map, or from its .bsp compiled with the pinned ericw-tools into a
// scratch folder (the two collide alike, but not to the last bit, so a replay
// uses the file the demo was recorded on).

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Demo } from "@mandreljs/sim/demo";
import type { EnemiesData, PlayerData, WeaponsData } from "@mandreljs/sim/data";
import type { SimConfig } from "@mandreljs/sim/sim";
import { levelFromBsp, levelFromMap, type Level } from "@mandreljs/sim/level";
import { readBsp } from "@mandreljs/sim/map/bsp";
import { compileMap, compileOk } from "./compile.ts";
import { EXAMPLE_GAME } from "./layout.ts";
import { toolsInstalled } from "./setup.ts";

export class DemoLevels {
  private readonly game: string;
  private readonly levels = new Map<string, Level>();
  private scratch: string | null = null;

  constructor(game: string = EXAMPLE_GAME) {
    this.game = game;
  }

  /** The game's current player, weapon, and enemy data. */
  data(): SimConfig {
    const read = <T>(name: string): T => JSON.parse(readFileSync(join(this.game, "data", `${name}.json`), "utf-8")) as T;
    return { player: read<PlayerData>("player"), weapons: read<WeaponsData>("weapons"), enemies: read<EnemiesData>("enemies") };
  }

  /** True if this computer can load a demo's level: a .bsp needs ericw-tools to compile it. */
  canLoad(demo: Pick<Demo, "level">): boolean {
    return demo.level === "map" || toolsInstalled();
  }

  /** The level a demo was recorded on. Compiles a .bsp the first time it's asked for. */
  async level(demo: Pick<Demo, "map" | "level">): Promise<Level> {
    const key = `${demo.map}.${demo.level}`;
    if (!this.levels.has(key)) {
      const mapPath = join(this.game, "maps", `${demo.map}.map`);
      if (demo.level === "map") {
        this.levels.set(key, levelFromMap(readFileSync(mapPath, "utf-8")));
      } else {
        this.scratch ??= mkdtempSync(join(tmpdir(), "mandreljs-demos-"));
        const result = await compileMap(mapPath, this.scratch, "check", this.game);
        if (!compileOk(result)) throw new Error(`${demo.map} didn't compile: ${result.problems.join("; ")}`);
        this.levels.set(key, levelFromBsp(readBsp(readFileSync(join(this.scratch, `${demo.map}.bsp`)))));
      }
    }
    return this.levels.get(key)!;
  }

  /** Removes the scratch folder of compiled maps. */
  close(): void {
    if (this.scratch !== null) rmSync(this.scratch, { recursive: true, force: true });
    this.scratch = null;
  }
}
