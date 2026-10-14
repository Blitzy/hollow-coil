// Links the Hollow Coil game config into TrenchBroom.
//
// Creates <TrenchBroom user dir>/games/HollowCoil pointing at maps/trenchbroom,
// so TrenchBroom always reads the repo's current config and FGD. On Windows
// this is a directory junction (no admin rights needed); elsewhere a symlink.
//
// After installing, set the game path in TrenchBroom under
// Preferences > Games > Hollow Coil to the repo root (the folder holding maps/ and textures/).
//
// Usage: node tools/src/install-trenchbroom.ts [--uninstall]   (or npm run install-trenchbroom)
//   --uninstall   remove the link (the repo files are untouched)

import { existsSync, lstatSync, mkdirSync, readlinkSync, rmdirSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { isMain, REPO_ROOT, repoPath } from "./repo.ts";

export const CONFIG_DIR = repoPath("maps", "trenchbroom");
const LINK_NAME = "HollowCoil";

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
export function install(link: string, target: string = CONFIG_DIR): string {
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

export function main(argv: string[] = process.argv.slice(2)): number {
  const { values } = parseArgs({ args: argv, options: { uninstall: { type: "boolean" } } });
  const link = join(trenchbroomUserDir(), "games", LINK_NAME);
  try {
    if (values.uninstall) {
      console.log(uninstall(link));
    } else {
      const message = install(link);
      console.log(message);
      if (message.startsWith("installed")) console.log(`Next, in TrenchBroom: Preferences > Games > Hollow Coil, set the game path to ${REPO_ROOT}`);
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`error: ${error.message}`);
    return 1;
  }
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main();
