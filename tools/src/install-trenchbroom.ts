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
// It then checks the game path TrenchBroom has for the game (Preferences > Games
// > <game name>), which must be the game directory, the folder holding maps/
// and textures/ (not its trenchbroom/ folder), and says what to set if it isn't.
//
// Usage: node tools/src/install-trenchbroom.ts [--game dir] [--uninstall]   (or npm run install-trenchbroom)
//   --game        the game directory, relative to the repo root; default: example
//   --uninstall   remove the links (the repo files are untouched)

import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmdirSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseArgs, styleText } from "node:util";
import { trenchbroomConfig } from "@mandreljs/defs/checks";
import { DEFS_DIR, gameDir, relativeToRepo, repoPath } from "./layout.ts";
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

/** Creates the link: "new" if it made it, "ok" if it was already there. */
export function install(link: string, target: string): "new" | "ok" {
  const current = linkTarget(link);
  if (current !== null) {
    if (normalize(current) === normalize(target)) return "ok";
    throw new InstallError(`${link} already links to ${current}; run with --uninstall first`);
  }
  if (existsSync(link)) throw new InstallError(`${link} exists and is not a link; move or delete it first`);
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
  return "new";
}

/** Removes the link, never the files it points to: "gone" if it removed it, "skip" if there was none. */
export function uninstall(link: string): "gone" | "skip" {
  if (linkTarget(link) === null) {
    if (existsSync(link)) throw new InstallError(`${link} is not a link; not touching it`);
    return "skip";
  }
  // A junction is removed with rmdir, which removes only the link, never its contents.
  if (process.platform === "win32") rmdirSync(link);
  else unlinkSync(link);
  return "gone";
}

/**
 * Removes a link left by an earlier version of this tool, but only if it points at target;
 * anything else is someone else's and stays. Returns whether it removed one.
 */
export function removeOldLink(link: string, target: string = OLD_CONFIG_DIR): boolean {
  const current = linkTarget(link);
  if (current === null || normalize(current) !== normalize(target)) return false;
  uninstall(link);
  return true;
}

/** The name to link a game's config folder as in TrenchBroom's games/: its FGD's name, the first one its config lists. */
export function gameLinkName(configDir: string): string {
  const fgd = trenchbroomConfig(readFileSync(join(configDir, "GameConfig.cfg"), "utf-8")).definitions[0];
  if (fgd === undefined) throw new InstallError(`${join(configDir, "GameConfig.cfg")} lists no entity definition files`);
  return basename(fgd, extname(fgd));
}

/** The game path TrenchBroom has set for a game (Preferences > Games), or null if none is set or there are no preferences yet. */
export function trenchbroomGamePath(userDir: string, gameName: string): string | null {
  try {
    const preferences = JSON.parse(readFileSync(join(userDir, "Preferences.json"), "utf-8")) as Record<string, unknown>;
    const path = preferences[`Games/${gameName}/Path`];
    return typeof path === "string" ? path : null;
  } catch {
    return null;
  }
}

/** One line of the report: a status, what it's about, and the detail. */
export interface Row {
  readonly status: "new" | "ok" | "gone" | "skip" | "todo";
  readonly what: string;
  readonly detail: string;
}

/** The game path row: ok when TrenchBroom's game path is the game directory (the folder holding maps/ and textures/). */
export function gamePathRow(game: string, current: string | null): Row {
  if (current !== null && normalize(current) === normalize(game)) return { status: "ok", what: "game path", detail: game };
  return { status: "todo", what: "game path", detail: current === null ? "not set" : `${current} (should be the folder holding maps/ and textures/)` };
}

const STATUS_STYLE: Record<Row["status"], Parameters<typeof styleText>[0]> = { new: "green", ok: "green", gone: "yellow", skip: "dim", todo: "yellow" };
type Style = (format: Parameters<typeof styleText>[0], text: string) => string;
/** Colors in a terminal; plain text when piped, or with NO_COLOR set. */
const terminalStyle: Style = (format, text) => styleText(format, text);

/** The report: a title, a row per step, and what's left to do in TrenchBroom, if anything. */
export function report(gameName: string, game: string, rows: readonly Row[], style: Style = (_, text) => text): string {
  const width = Math.max(...rows.map((row) => row.what.length));
  const lines = [style("bold", `${gameName} in TrenchBroom`), ""];
  for (const row of rows) lines.push(`  ${style(STATUS_STYLE[row.status], row.status.padEnd(4))}  ${row.what.padEnd(width)}  ${row.detail}`);
  if (rows.some((row) => row.status === "todo")) {
    lines.push("", `To finish, in TrenchBroom open Preferences > Games > ${gameName} and set the game path to:`, "", `  ${style("bold", game)}`);
  }
  return lines.join("\n");
}

/** A link for the report: repo paths relative to the repo, TrenchBroom's as TrenchBroom/... */
function showLink(link: string, target?: string): string {
  const show = (path: string): string => {
    const userDir = trenchbroomUserDir();
    return normalize(path).startsWith(normalize(userDir)) ? `TrenchBroom${path.slice(userDir.length).split("\\").join("/")}` : relativeToRepo(path);
  };
  return target === undefined ? show(link) : `${show(link)} -> ${show(target)}`;
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const { values } = parseArgs({ args: argv, options: { game: { type: "string" }, uninstall: { type: "boolean" } } });
  const game = gameDir(values.game);
  const configDir = join(game, "trenchbroom");
  const games = join(trenchbroomUserDir(), "games");
  const engineLink = join(configDir, ENGINE_LINK_NAME);
  try {
    const name = trenchbroomConfig(readFileSync(join(configDir, "GameConfig.cfg"), "utf-8")).name;
    const link = join(games, gameLinkName(configDir));
    const oldLinks: [string, string][] = [
      ...OLD_LINK_NAMES.map((oldName): [string, string] => [join(games, oldName), OLD_CONFIG_DIR]),
      [join(configDir, OLD_ENGINE_LINK_NAME), OLD_ENGINE_CONFIG_DIR],
    ];
    const rows: Row[] = oldLinks.filter(([old, target]) => removeOldLink(old, target)).map(([old]) => ({ status: "gone", what: "old link", detail: showLink(old) }));
    if (values.uninstall) {
      rows.push({ status: uninstall(link), what: "game config", detail: showLink(link) });
      rows.push({ status: uninstall(engineLink), what: "engine entities", detail: showLink(engineLink) });
    } else {
      rows.push({ status: install(link, configDir), what: "game config", detail: showLink(link, configDir) });
      rows.push({ status: install(engineLink, ENGINE_CONFIG_DIR), what: "engine entities", detail: showLink(engineLink, ENGINE_CONFIG_DIR) });
      rows.push(gamePathRow(game, trenchbroomGamePath(trenchbroomUserDir(), name)));
    }
    console.log(report(name, game, rows, terminalStyle));
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`error: ${error.message}`);
    return 1;
  }
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main();
