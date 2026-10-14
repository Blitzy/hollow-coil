// Node-only helpers for tests: repo paths and the shared /data files (the sim itself never reads files).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PlayerData } from "@hollow-coil/sim/data";

export const REPO_ROOT = join(import.meta.dirname, "../../..");

export const readRepoFile = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf-8");

export const readRepoBytes = (path: string): Uint8Array => new Uint8Array(readFileSync(join(REPO_ROOT, path)));

export const loadPlayerData = (): PlayerData => JSON.parse(readRepoFile("data/player.json")) as PlayerData;
