// Node-only helpers for tests: repo paths and the shared /data files (the sim itself never reads files).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PlayerData, WeaponsData } from "@hollow-coil/sim/data";
import type { SimConfig } from "@hollow-coil/sim/sim";

export const REPO_ROOT = join(import.meta.dirname, "../../..");

export const readRepoFile = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf-8");

export const readRepoBytes = (path: string): Uint8Array => new Uint8Array(readFileSync(join(REPO_ROOT, path)));

export const loadPlayerData = (): PlayerData => JSON.parse(readRepoFile("data/player.json")) as PlayerData;

export const loadWeaponsData = (): WeaponsData => JSON.parse(readRepoFile("data/weapons.json")) as WeaponsData;

/** The sim's config from the repo's /data files. */
export const loadSimConfig = (): SimConfig => ({ player: loadPlayerData(), weapons: loadWeaponsData() });
