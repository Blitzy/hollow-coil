// A Vite plugin for development, shared by every app: serves the repo's game
// files (maps/, textures/, data/, build/) at /game/, the same files the tools
// use. A request for build/<name>.bsp compiles the map first when it has
// changed, so saving in TrenchBroom and reloading shows new lighting.

import { execFile } from "node:child_process";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
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
const PYTHON = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");

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
  let pending = compiling.get(name);
  if (!pending) {
    pending = new Promise<string | null>((resolve) => {
      execFile(PYTHON, [join("tools", "compile.py"), name], { cwd: root }, (error, stdout, stderr) => {
        compiling.delete(name);
        const report = `${stdout}${stderr}`.trim();
        log(error ? `compile failed: ${name}\n${report}` : `compiled ${name}`);
        resolve(error ? report || error.message : null);
      });
    });
    compiling.set(name, pending);
  }
  return pending;
}

/** Serves the repo's game files at /game/ and compiles stale maps on request. */
export function gameFiles(root: string = REPO_ROOT): Plugin {
  return {
    name: "hollow-coil-game-files",
    configureServer(server) {
      const log = (message: string): void => server.config.logger.info(`[hollow-coil] ${message}`, { timestamp: true });
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
