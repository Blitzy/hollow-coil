// Loads the shared /data files for tests (Node only; the sim itself never reads files).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PlayerData } from "../../src/sim/data";

export const REPO_ROOT = join(import.meta.dirname, "../../..");

export const readRepoFile = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf-8");

export const loadPlayerData = (): PlayerData => JSON.parse(readRepoFile("data/player.json")) as PlayerData;
