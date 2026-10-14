// Node-only helpers for tests: repo paths and the example game's data files (the sim itself never reads files).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EnemiesData, PlayerData, WeaponsData } from "@mandreljs/sim/data";
import type { SimConfig } from "@mandreljs/sim/sim";

export const REPO_ROOT = join(import.meta.dirname, "../../..");

/** The example game's directory, relative to the repo root: the content the engine's tests use. */
export const EXAMPLE_GAME = "example";

export const readRepoFile = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf-8");

export const readRepoBytes = (path: string): Uint8Array => new Uint8Array(readFileSync(join(REPO_ROOT, path)));

export const loadPlayerData = (): PlayerData => JSON.parse(readRepoFile(`${EXAMPLE_GAME}/data/player.json`)) as PlayerData;

export const loadWeaponsData = (): WeaponsData => JSON.parse(readRepoFile(`${EXAMPLE_GAME}/data/weapons.json`)) as WeaponsData;

export const loadEnemiesData = (): EnemiesData => JSON.parse(readRepoFile(`${EXAMPLE_GAME}/data/enemies.json`)) as EnemiesData;

/** The sim's config from the example game's data files. */
export const loadSimConfig = (): SimConfig => ({ player: loadPlayerData(), weapons: loadWeaponsData(), enemies: loadEnemiesData() });
