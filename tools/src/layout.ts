// Where things are, for the tools, the dev server, and tests. Two places matter:
//
//   - the engine's own files (schemas, light styles, the shared FGD, pinned tool
//     versions), found from where the tools are, so they work from any folder
//   - the game: a game directory holding data/game.json, maps/, textures/, and
//     trenchbroom/, wherever it is on disk; its maps compile to its own build/
//
// Inside this repo the engine's files are the repo itself, and the game is
// example/ unless another one is named.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

/** The repo root. The engine's files are found from here, and repo-only tools (scenarios, check-files) use it. */
export const REPO_ROOT = join(import.meta.dirname, "../..");

/** A path inside the repo, from slash-separated parts. */
export const repoPath = (...parts: string[]): string => join(REPO_ROOT, ...parts);

/** A path for messages: relative to the folder the command runs in, with forward slashes, if it's inside it; otherwise absolute. */
export const displayPath = (path: string, cwd: string = process.cwd()): string => {
  const rel = relative(cwd, resolve(path));
  return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? resolve(path) : rel.split("\\").join("/");
};

/** The definitions every game is checked against (@mandreljs/defs): schemas, light styles, and the shared FGD in trenchbroom/. */
export const DEFS_DIR = repoPath("packages", "defs");

/** The example game's directory, holding maps/, textures/, data/, and trenchbroom/ (the standard Quake layout). */
export const EXAMPLE_GAME = repoPath("example");

/** True for a game directory: a folder holding data/game.json. */
export const isGameDir = (dir: string): boolean => existsSync(join(dir, "data", "game.json"));

export class GameNotFoundError extends Error {
  override name = "GameNotFoundError";
}

/** True if path is dir or inside it. */
const isInside = (path: string, dir: string): boolean => {
  const rel = relative(dir, resolve(path));
  return !rel.startsWith("..") && !isAbsolute(rel);
};

/**
 * The game a command works on: the --game option (relative to the folder the command runs in), or that folder if
 * it's a game directory, or, inside this repo, the example game. Throws if the result isn't a game directory.
 */
export function findGame(option?: string, cwd: string = process.cwd()): string {
  const here = isGameDir(cwd) ? resolve(cwd) : isInside(cwd, REPO_ROOT) ? EXAMPLE_GAME : cwd;
  const game = option !== undefined ? resolve(cwd, option) : here;
  if (!isGameDir(game)) {
    const why = option !== undefined ? `${game} has no data/game.json` : "run this in a game directory (a folder holding data/game.json), or pass --game <dir>";
    throw new GameNotFoundError(`no game found: ${why}`);
  }
  return game;
}

/** Where a game's maps compile to: its own build/ folder. */
export const buildDir = (game: string): string => join(game, "build");

/**
 * Where pinned third-party tools are installed, shared by every game on this computer: the per-user cache
 * (%LOCALAPPDATA%\mandreljs on Windows, ~/Library/Caches/mandreljs on macOS, ~/.cache/mandreljs elsewhere).
 */
export function toolsCacheDir(): string {
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "mandreljs");
  if (process.platform === "darwin") return join(homedir(), "Library", "Caches", "mandreljs");
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "mandreljs");
}
