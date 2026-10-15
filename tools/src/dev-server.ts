// A Vite plugin for development, shared by every app: serves the repo's game
// directories, the same files the tools use.
//
//   /games/<game>/{maps,textures,data}/...  a game directory: a folder in the repo root holding data/game.json
//   /games/<game>/build/...                 the game's build/, where its maps compile to
//
// A request for /games/<game>/build/<name>.bsp compiles the map first when it
// has changed, so saving in TrenchBroom and reloading shows new lighting.

import { createReadStream, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { compileMap, compileOk } from "./compile.ts";
import { buildDir, isGameDir, REPO_ROOT } from "./layout.ts";
import { toolsInstalled } from "./setup.ts";
import type { Plugin } from "vite";

const GAME_FOLDERS = ["maps", "textures", "data", "build"]; // served at /games/<game>/<folder>/...
const GAME_NAME = /^[\w-]+$/;
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

/** A request URL's path as folder parts, or null if it tries to climb out with "..". */
function pathParts(url: string | undefined): string[] | null {
  const path = normalize(decodeURIComponent((url ?? "/").split("?")[0]!)).replace(/^[\\/]+/, "");
  const parts = path.split(sep);
  return parts.includes("..") ? null : parts;
}

/** Sends a file, or a 404 if there's none; next() for a folder. */
function send(file: string, res: ServerResponse, next: () => void): void {
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
}

/** Compiles needed for each map, by .bsp path, so simultaneous requests share one run. */
const compiling = new Map<string, Promise<string | null>>();

/**
 * Brings outDir/<name>.bsp up to date with game/maps/<name>.map, compiling in
 * check mode if the .map is newer. Resolves to null when the .bsp is ready, or
 * to the compiler's report when it isn't.
 */
function ensureBsp(game: string, outDir: string, name: string, log: (message: string) => void): Promise<string | null> {
  const mapPath = join(game, "maps", `${name}.map`);
  const bspPath = join(outDir, `${name}.bsp`);
  const map = modified(mapPath);
  if (map < 0 || modified(bspPath) >= map) return Promise.resolve(null);
  if (!toolsInstalled()) return Promise.resolve("ericw-tools is not installed; run: npm run setup");
  let pending = compiling.get(bspPath);
  if (!pending) {
    pending = compileMap(mapPath, outDir, "check", game).then((result) => {
      compiling.delete(bspPath);
      if (compileOk(result)) {
        log(`compiled ${name} (${result.seconds.toFixed(1)}s)`);
        return null;
      }
      const report = result.problems.join("\n");
      log(`compile failed: ${name}\n${report}`);
      return report;
    });
    compiling.set(bspPath, pending);
  }
  return pending;
}

/** Serves the repo's game directories, and compiles stale maps on request. */
export function gameFiles(root: string = REPO_ROOT): Plugin {
  return {
    name: "mandreljs-game-files",
    configureServer(server) {
      const log = (message: string): void => server.config.logger.info(`[mandreljs] ${message}`, { timestamp: true });

      server.middlewares.use("/games", (req, res, next) => {
        const parts = pathParts(req.url);
        if (parts === null || parts.length < 3) return next();
        const [name, folder, ...rest] = parts as [string, string, ...string[]];
        const game = join(root, name);
        if (!GAME_NAME.test(name) || !GAME_FOLDERS.includes(folder) || !isGameDir(game)) return next();
        if (folder !== "build") return send(join(game, folder, ...rest), res, next);

        const outDir = buildDir(game);
        const bsp = rest.length === 1 ? /^([\w-]+)\.bsp$/.exec(rest[0]!) : null;
        if (!bsp) return send(join(outDir, ...rest), res, next);
        void ensureBsp(game, outDir, bsp[1]!, log).then((failure) => {
          if (failure === null) return send(join(outDir, ...rest), res, next);
          res.statusCode = 422;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(failure);
        });
      });
    },
  };
}
