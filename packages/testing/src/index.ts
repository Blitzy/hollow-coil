// Node-only helpers for tests: repo paths and the example game's data files (the sim itself never reads files).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXAMPLE_GAME, REPO_ROOT } from "@mandreljs/toolchain/layout";
import type { EnemiesData, PlayerData, WeaponsData } from "@mandreljs/sim/data";
import type { SimConfig } from "@mandreljs/sim/sim";

export { REPO_ROOT };

export const readRepoFile = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf-8");

export const readRepoBytes = (path: string): Uint8Array => new Uint8Array(readFileSync(join(REPO_ROOT, path)));

export const loadPlayerData = (): PlayerData => JSON.parse(readFileSync(join(EXAMPLE_GAME, "data", "player.json"), "utf-8")) as PlayerData;

export const loadWeaponsData = (): WeaponsData => JSON.parse(readFileSync(join(EXAMPLE_GAME, "data", "weapons.json"), "utf-8")) as WeaponsData;

export const loadEnemiesData = (): EnemiesData => JSON.parse(readFileSync(join(EXAMPLE_GAME, "data", "enemies.json"), "utf-8")) as EnemiesData;

/** The sim's config from the example game's data files. */
export const loadSimConfig = (): SimConfig => ({ player: loadPlayerData(), weapons: loadWeaponsData(), enemies: loadEnemiesData() });
