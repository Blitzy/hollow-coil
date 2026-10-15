// Where the engine's own files are, when the tools run from this repo's source.
// The mandreljs package bundles the tools with engine-files.package.ts in this
// module's place (see package.ts), so the same code finds the same files there.
// Both files export the same names with the same types.

import { join } from "node:path";

/** The engine's root: this repo. */
export const ENGINE_ROOT = join(import.meta.dirname, "../..");
/** True inside this repo, which holds the example game, the client's source, and the scenarios. */
export const IN_REPO = true;
/** The definitions every game is checked against: schemas, light styles, and the shared FGD in trenchbroom/. */
export const DEFS_DIR = join(ENGINE_ROOT, "packages", "defs");
/** The pinned versions and checksums of third-party tools. */
export const VERSIONS_FILE = join(ENGINE_ROOT, "tools", "versions.json");
/** The game client's source, which Vite serves and builds, or null where there's none. */
export const CLIENT_SOURCE: string | null = join(ENGINE_ROOT, "apps", "game-client");
/** The built client: index.html and its assets. */
export const CLIENT_BUILD = join(ENGINE_ROOT, "apps", "game-client", "dist");
/** False when running from source, where each tool is its own file and can run as a command. */
export const BUNDLED = false;
