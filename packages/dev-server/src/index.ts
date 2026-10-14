// A Vite plugin for development, shared by every app: serves the repo's game
// files (maps/, textures/, data/, build/) at /game/, the same files the tools
// use. A request for build/<name>.bsp compiles the map first when it has
// changed, so saving in TrenchBroom and reloading shows new lighting.

import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { compileMap, compileOk } from "@mandreljs/tools/compile";
import { toolsInstalled } from "@mandreljs/tools/setup";
import type { Plugin } from "vite";

/** The repo root: the game root holding maps/, textures/, and data/. */
export const REPO_ROOT = join(import.meta.dirname, "../../..");

const SHARED = ["maps", "textures", "data", "build"]; // repo folders served at /game/<folder>/...
const TYPES: Record<string, string> = {
  ".map": "text/plain; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".bsp": "application/octet-stream",
};
const modified = (path: string): number => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return -1;
  }
};

/** Compiles needed for each map, so simultaneous requests share one run. */
const compiling = new Map<string, Promise<string | null>>();

/**
 * Brings build/<name>.bsp up to date with maps/<name>.map, compiling in check
 * mode if the .map is newer. Resolves to null when the .bsp is ready, or to
 * the compiler's report when it isn't.
 */
function ensureBsp(root: string, name: string, log: (message: string) => void): Promise<string | null> {
  const map = modified(join(root, "maps", `${name}.map`));
  if (map < 0 || modified(join(root, "build", `${name}.bsp`)) >= map) return Promise.resolve(null);
  if (!toolsInstalled()) return Promise.resolve("ericw-tools is not installed; run: npm run setup");
  let pending = compiling.get(name);
  if (!pending) {
    pending = compileMap(join(root, "maps", `${name}.map`), join(root, "build"), "check", root).then((result) => {
      compiling.delete(name);
      if (compileOk(result)) {
        log(`compiled ${name} (${result.seconds.toFixed(1)}s)`);
        return null;
      }
      const report = result.problems.join("\n");
      log(`compile failed: ${name}\n${report}`);
      return report;
    });
    compiling.set(name, pending);
  }
  return pending;
}

/** Serves the repo's game files at /game/ and compiles stale maps on request. */
export function gameFiles(root: string = REPO_ROOT): Plugin {
  return {
    name: "mandreljs-game-files",
    configureServer(server) {
      const log = (message: string): void => server.config.logger.info(`[mandreljs] ${message}`, { timestamp: true });
      server.middlewares.use("/game", (req, res, next) => {
        const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]!)).replace(/^[\\/]+/, "");
        const parts = path.split(sep);
        if (!SHARED.includes(parts[0]!) || parts.includes("..")) return next();
        const file = join(root, path);

        const send = (): void => {
          try {
            if (!statSync(file).isFile()) return next();
          } catch {
            res.statusCode = 404;
            res.end("not found");
            return;
          }
          res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
          res.setHeader("Cache-Control", "no-store"); // always serve the latest map save
          createReadStream(file).pipe(res);
        };

        const bsp = parts[0] === "build" && parts.length === 2 ? /^([\w-]+)\.bsp$/.exec(parts[1]!) : null;
        if (!bsp) return send();
        void ensureBsp(root, bsp[1]!, log).then((failure) => {
          if (failure === null) return send();
          res.statusCode = 422;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(failure);
        });
      });
    },
  };
}
