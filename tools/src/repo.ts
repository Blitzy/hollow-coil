// Paths and process helpers shared by the command-line tools.

import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The repo root: the engine, with game directories (example/ and any others) inside it. */
export const REPO_ROOT = join(import.meta.dirname, "../..");

/** A path inside the repo, from slash-separated parts. */
export const repoPath = (...parts: string[]): string => join(REPO_ROOT, ...parts);

/** The example game's directory, holding maps/, textures/, data/, and trenchbroom/ (the standard Quake layout). */
export const EXAMPLE_GAME = repoPath("example");

/** A game directory from a --game option, relative to the repo root; the example game without one. */
export const gameDir = (option?: string): string => (option === undefined ? EXAMPLE_GAME : resolve(REPO_ROOT, option));

/** Where a game's maps compile to: build/<game directory name>/. */
export const buildDir = (game: string): string => repoPath("build", basename(game));

/** A path relative to the repo root, with forward slashes, for messages; paths outside the repo stay absolute. */
export const relativeToRepo = (path: string): string => {
  const rel = relative(REPO_ROOT, resolve(path));
  return rel.startsWith("..") || isAbsolute(rel) ? resolve(path) : rel.split("\\").join("/");
};

/** True when the module at metaUrl is the script node was asked to run, not an import. */
export const isMain = (metaUrl: string): boolean =>
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(metaUrl);
