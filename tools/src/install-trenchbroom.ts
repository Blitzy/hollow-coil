// Links a game's TrenchBroom config into TrenchBroom (the example game's by default).
//
// Creates <TrenchBroom user dir>/games/<name> pointing at the game's trenchbroom/
// folder, so TrenchBroom always reads the game's current config and FGD. The link
// is named after the game's FGD, as TrenchBroom's own configs are (games/Quake2
// holds Quake2.fgd): the example's is games/MandrelJSExample. It also links the
// engine's FGD folder (packages/defs/trenchbroom/) into the game's as mandrel/,
// which the game's FGD includes the engine's entities from (TrenchBroom reads
// only files inside a game's config folder). On Windows the links are directory
// junctions (no admin rights needed); elsewhere symlinks. It also removes links
// earlier versions of this tool made: to maps/trenchbroom, where the example's
// config used to be (so TrenchBroom doesn't load the config twice), and the
// game's engine/ link to the old top-level trenchbroom/ folder.
//
// After installing, set the game path in TrenchBroom under
// Preferences > Games > <game name> to the game directory (the folder holding maps/ and textures/).
//
// Usage: node tools/src/install-trenchbroom.ts [--game dir] [--uninstall]   (or npm run install-trenchbroom)
//   --game        the game directory, relative to the repo root; default: example
//   --uninstall   remove the links (the repo files are untouched)

import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmdirSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { trenchbroomConfig } from "@mandreljs/defs/checks";
import { DEFS_DIR, gameDir, repoPath } from "@mandreljs/toolchain/layout";
import { isMain } from "./cli.ts";

/** The engine's TrenchBroom files: the FGD every game's FGD includes. */
export const ENGINE_CONFIG_DIR = join(DEFS_DIR, "trenchbroom");
/** The name of the engine link inside a game's trenchbroom/ folder, as the game's FGD includes it. */
export const ENGINE_LINK_NAME = "mandrel";
/** Where the example's config was before it moved to example/trenchbroom, and the names earlier versions of this tool linked it as. */
const OLD_CONFIG_DIR = repoPath("maps", "trenchbroom");
const OLD_LINK_NAMES = ["MandrelJS", "MandrelJSExample"];
/** The engine link an earlier version made in a game's trenchbroom/ folder, and the folder it pointed at. */
const OLD_ENGINE_LINK_NAME = "engine";
const OLD_ENGINE_CONFIG_DIR = repoPath("trenchbroom");

export class InstallError extends Error {
  override name = "InstallError";
}

export function trenchbroomUserDir(): string {
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "TrenchBroom");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "TrenchBroom");
  return join(homedir(), ".TrenchBroom");
}

/** A path made comparable: no Windows long-path prefix, absolute, and case-folded on Windows. */
function normalize(path: string): string {
  const absolute = resolve(path.startsWith("\\\\?\\") ? path.slice(4) : path);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

/** Where a symlink or junction points, or null if path is not a link. */
function linkTarget(path: string): string | null {
  try {
    return lstatSync(path).isSymbolicLink() ? readlinkSync(path) : null;
  } catch {
    return null;
  }
}

/** Creates the link, or reports that it's already there. Returns the message to print. */
export function install(link: string, target: string): string {
  const current = linkTarget(link);
  if (current !== null) {
    if (normalize(current) === normalize(target)) return `already installed: ${link} -> ${target}`;
    throw new InstallError(`${link} already links to ${current}; run with --uninstall first`);
  }
  if (existsSync(link)) throw new InstallError(`${link} exists and is not a link; move or delete it first`);
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
  return `installed: ${link} -> ${target}`;
}

/** Removes the link, never the files it points to. Returns the message to print. */
export function uninstall(link: string): string {
  if (linkTarget(link) === null) {
    if (existsSync(link)) throw new InstallError(`${link} is not a link; not touching it`);
    return `not installed: ${link} does not exist`;
  }
  // A junction is removed with rmdir, which removes only the link, never its contents.
  if (process.platform === "win32") rmdirSync(link);
  else unlinkSync(link);
  return `removed: ${link}`;
}

/**
 * Removes a link left by an earlier version of this tool, but only if it points at target;
 * anything else is someone else's and stays. Returns the message to print, or null if nothing was removed.
 */
export function removeOldLink(link: string, target: string = OLD_CONFIG_DIR): string | null {
  const current = linkTarget(link);
  if (current === null || normalize(current) !== normalize(target)) return null;
  return `${uninstall(link)} (an earlier link to this config)`;
}

/** The name to link a game's config folder as in TrenchBroom's games/: its FGD's name, the first one its config lists. */
export function gameLinkName(configDir: string): string {
  const fgd = trenchbroomConfig(readFileSync(join(configDir, "GameConfig.cfg"), "utf-8")).definitions[0];
  if (fgd === undefined) throw new InstallError(`${join(configDir, "GameConfig.cfg")} lists no entity definition files`);
  return basename(fgd, extname(fgd));
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const { values } = parseArgs({ args: argv, options: { game: { type: "string" }, uninstall: { type: "boolean" } } });
  const game = gameDir(values.game);
  const configDir = join(game, "trenchbroom");
  const games = join(trenchbroomUserDir(), "games");
  const engineLink = join(configDir, ENGINE_LINK_NAME);
  try {
    const link = join(games, gameLinkName(configDir));
    const oldLinks: [string, string][] = [
      ...OLD_LINK_NAMES.map((name): [string, string] => [join(games, name), OLD_CONFIG_DIR]),
      [join(configDir, OLD_ENGINE_LINK_NAME), OLD_ENGINE_CONFIG_DIR],
    ];
    for (const [old, target] of oldLinks) {
      const message = removeOldLink(old, target);
      if (message !== null) console.log(message);
    }
    if (values.uninstall) {
      console.log(uninstall(link));
      console.log(uninstall(engineLink));
    } else {
      console.log(install(engineLink, ENGINE_CONFIG_DIR));
      const message = install(link, configDir);
      console.log(message);
      if (message.startsWith("installed")) {
        const name = trenchbroomConfig(readFileSync(join(configDir, "GameConfig.cfg"), "utf-8")).name;
        console.log(`Next, in TrenchBroom: Preferences > Games > ${name}, set the game path to ${game}`);
      }
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`error: ${error.message}`);
    return 1;
  }
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main();
