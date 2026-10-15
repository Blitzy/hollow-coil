// Shared by the command-line tools.

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** A path with links resolved, or as given if it doesn't exist. */
const realPath = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

/**
 * True when the module at metaUrl is the script node was asked to run, not an import. Compares real paths,
 * because npm runs a package's command through a link in node_modules while modules know their real location.
 */
export const isMain = (metaUrl: string): boolean =>
  process.argv[1] !== undefined && realPath(process.argv[1]) === realPath(fileURLToPath(metaUrl));
