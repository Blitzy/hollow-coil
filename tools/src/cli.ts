// Shared by the command-line tools.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** True when the module at metaUrl is the script node was asked to run, not an import. */
export const isMain = (metaUrl: string): boolean =>
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(metaUrl);
