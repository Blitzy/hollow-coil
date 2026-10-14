// Paths and process helpers shared by the command-line tools.

import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The repo root, which is also the game root (maps/, textures/, data/). */
export const REPO_ROOT = join(import.meta.dirname, "../..");

/** A path inside the repo, from slash-separated parts. */
export const repoPath = (...parts: string[]): string => join(REPO_ROOT, ...parts);

/** A path relative to the repo root, with forward slashes, for messages; paths outside the repo stay absolute. */
export const relativeToRepo = (path: string): string => {
  const rel = relative(REPO_ROOT, resolve(path));
  return rel.startsWith("..") || isAbsolute(rel) ? resolve(path) : rel.split("\\").join("/");
};

/** True when the module at metaUrl is the script node was asked to run, not an import. */
export const isMain = (metaUrl: string): boolean =>
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(metaUrl);
