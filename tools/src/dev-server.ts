// The dev server: serves game directories to the game client, the same files
// the tools use, and compiles stale maps on request.
//
//   /games/index.json                       the games served, and which to play when the URL names none
//   /games/<game>/{maps,textures,data}/...  a game directory: a folder holding data/game.json
//   /games/<game>/build/...                 the game's build/, where its maps compile to
//
// A request for /games/<game>/build/<name>.bsp compiles the map first when it
// has changed, so saving in TrenchBroom and reloading shows new lighting.
//
// It runs two ways, with the same request handling: as a Vite plugin
// (gameFiles), when the client runs from this repo's source; and as a plain
// Node server (startServer) for the built client, as an installed engine runs.

import { createReadStream, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { basename, extname, join, normalize, resolve, sep } from "node:path";
import { compileMap, compileOk } from "./compile.ts";
import { buildDir, findGame, isGameDir, REPO_ROOT } from "./layout.ts";
import { toolsInstalled } from "./setup.ts";
import type { Plugin } from "vite";

/** The environment variable mandreljs dev sets for the Vite plugin: the game to play. */
export const GAME_ENV = "MANDRELJS_GAME";

const GAME_FOLDERS = ["maps", "textures", "data", "build"]; // served at /games/<game>/<folder>/...
const GAME_NAME = /^[\w-]+$/;
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
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

/** The games a server offers, by name (their folder name), and which one to play when the URL names none. */
export interface Games {
  readonly list: () => Map<string, string>;
  readonly defaultName: string;
}

/** Every game directory in a folder (such as this repo), plus a chosen game wherever it is, which is the default. */
export function folderGames(root: string, chosen: string): Games {
  return {
    defaultName: basename(chosen),
    list: () => {
      const games = new Map<string, string>();
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        const dir = join(root, entry.name);
        if (entry.isDirectory() && GAME_NAME.test(entry.name) && isGameDir(dir)) games.set(entry.name, dir);
      }
      games.set(basename(chosen), resolve(chosen));
      return games;
    },
  };
}

/** Just one game. */
export function singleGame(game: string): Games {
  const name = basename(game);
  return { defaultName: name, list: () => new Map([[name, resolve(game)]]) };
}

/** A request URL's path as folder parts, or null if it tries to climb out with "..". */
function pathParts(url: string | undefined): string[] | null {
  const path = normalize(decodeURIComponent((url ?? "/").split("?")[0]!)).replace(/^[\\/]+/, "");
  const parts = path.split(sep).filter((part) => part !== "");
  return parts.includes("..") ? null : parts;
}

const isFolder = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const notFound = (res: ServerResponse): void => {
  res.statusCode = 404;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("not found");
};

/** Sends a file, uncached so a reload always gets the latest save, or a 404 if there's none. */
function send(file: string, res: ServerResponse): void {
  try {
    if (!statSync(file).isFile()) return notFound(res);
  } catch {
    return notFound(res);
  }
  res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
  res.setHeader("Cache-Control", "no-store");
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
  if (!toolsInstalled()) return Promise.resolve("ericw-tools is not installed; run: mandreljs setup");
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

/**
 * Handles a request under /games (its URL relative to /games), or calls next() for one it doesn't serve.
 * Connect-style, so Vite's middleware and the plain server share it.
 */
export function gameHandler(games: Games, log: (message: string) => void): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  return (req, res, next) => {
    const parts = pathParts(req.url);
    if (parts === null) return next();
    if (parts.length === 1 && parts[0] === "index.json") {
      res.setHeader("Content-Type", TYPES[".json"]!);
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ default: games.defaultName, games: [...games.list().keys()].sort() }));
      return;
    }
    if (parts.length < 3) return next();
    const [name, folder, ...rest] = parts as [string, string, ...string[]];
    const game = games.list().get(name);
    if (game === undefined || !GAME_FOLDERS.includes(folder)) return next();
    if (folder !== "build") return send(join(game, folder, ...rest), res);

    const outDir = buildDir(game);
    const bsp = rest.length === 1 ? /^([\w-]+)\.bsp$/.exec(rest[0]!) : null;
    if (!bsp) return send(join(outDir, ...rest), res);
    void ensureBsp(game, outDir, bsp[1]!, log).then((failure) => {
      if (failure === null) return send(join(outDir, ...rest), res);
      res.statusCode = 422;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(failure);
    });
  };
}

/**
 * The Vite plugin for apps running from this repo's source: serves every game directory in the repo, plus the game
 * mandreljs dev was asked for (from MANDRELJS_GAME), which is the default; without one, the example game.
 */
export function gameFiles(root: string = REPO_ROOT): Plugin {
  return {
    name: "mandreljs-game-files",
    configureServer(server) {
      const log = (message: string): void => server.config.logger.info(`[mandreljs] ${message}`, { timestamp: true });
      const chosen = process.env[GAME_ENV] ?? findGame(undefined, root);
      server.middlewares.use("/games", gameHandler(folderGames(root, chosen), log));
    },
  };
}

export interface ServerOptions {
  /** The built client: a folder holding index.html and its assets. */
  readonly clientDir: string;
  /** The games to serve at /games, compiling stale maps; without them, /games is served from clientDir like any file (as for a release from mandreljs build). */
  readonly games?: Games;
  readonly port: number;
  readonly host: string;
  /** Try the next ports when this one is taken, as Vite does. */
  readonly tryNextPorts?: boolean;
  readonly log?: (message: string) => void;
}

/** Serves the built client and the games with plain Node, as an installed engine does, or a release as a static host would. Resolves once it's listening. */
export function startServer(options: ServerOptions): Promise<{ server: Server; url: string }> {
  const log = options.log ?? ((message: string): void => console.log(message));
  const games = options.games === undefined ? null : gameHandler(options.games, log);
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0]!;
    if (games !== null && (path === "/games" || path.startsWith("/games/"))) {
      req.url = (req.url ?? "").slice("/games".length) || "/";
      return games(req, res, () => notFound(res));
    }
    const parts = pathParts(req.url);
    if (parts === null) return notFound(res);
    const file = join(options.clientDir, ...parts);
    // A folder's page is its index.html, as on any static host.
    send(isFolder(file) ? join(file, "index.html") : file, res);
  });
  return new Promise((done, fail) => {
    let port = options.port;
    const listen = (): void => void server.listen(port, options.host);
    server.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" && options.tryNextPorts && port < options.port + 10) {
        port++;
        listen();
      } else fail(error);
    });
    server.on("listening", () => {
      const address = server.address();
      const actual = typeof address === "object" && address !== null ? address.port : port;
      done({ server, url: `http://${options.host === "0.0.0.0" ? "localhost" : options.host}:${actual}/` });
    });
    listen();
  });
}

/** A game's name from its data/game.json, or its folder name if that can't be read. */
export function gameName(game: string): string {
  try {
    const name = (JSON.parse(readFileSync(join(game, "data", "game.json"), "utf-8")) as { name?: unknown }).name;
    return typeof name === "string" ? name : basename(game);
  } catch {
    return basename(game);
  }
}
