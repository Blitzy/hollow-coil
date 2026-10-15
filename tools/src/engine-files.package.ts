// Where the engine's own files are in the installed mandreljs package; the
// package's bundle uses this in place of engine-files.ts (see package.ts).
//
//   mandreljs/bin/mandrel.js    the bundled command, so ENGINE_ROOT is one folder up
//   mandreljs/defs/             schemas, light styles, and trenchbroom/mandrel.fgd
//   mandreljs/client/           the built client
//   mandreljs/versions.json     pinned third-party tool versions

import { join } from "node:path";

/** The engine's root: the installed package. */
export const ENGINE_ROOT = join(import.meta.dirname, "..");
/** False in the package: there's no example game, client source, or scenarios. */
export const IN_REPO = false;
/** The definitions every game is checked against: schemas, light styles, and the shared FGD in trenchbroom/. */
export const DEFS_DIR = join(ENGINE_ROOT, "defs");
/** The pinned versions and checksums of third-party tools. */
export const VERSIONS_FILE = join(ENGINE_ROOT, "versions.json");
/** The game client's source: none in the package, so the built client is served without Vite. */
export const CLIENT_SOURCE: string | null = null;
/** The built client: index.html and its assets. */
export const CLIENT_BUILD = join(ENGINE_ROOT, "client");
/** True in the package's bundle, where every tool shares one file: only the mandrel command runs as a command. */
export const BUNDLED = true;
