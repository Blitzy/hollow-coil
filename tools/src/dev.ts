// Plays a game in the browser, compiling maps as you save them. The game is the
// folder this runs in if it's a game directory, or --game, or, inside this repo,
// the example game.
//
// From this repo's source it runs Vite on apps/game-client, so engine code
// reloads as you edit it; Vite's options pass through, such as --port 5199.
// With --built, or where there's no client source (an installed engine), it
// serves the built client with plain Node instead (see dev-server.ts).
//
// Usage: node tools/src/dev.ts [--game dir] [--built] [--port n] [--host name] [vite options]
//        (or mandrel dev, npm run dev)

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { parseArgs, styleText } from "node:util";
import { isMain } from "./cli.ts";
import { GAME_ENV, gameName, isBuiltClient, singleGame, startServer } from "./dev-server.ts";
import { displayPath, findGame, repoPath } from "./layout.ts";

/** The game client's source, which Vite serves. */
const CLIENT_SOURCE = repoPath("apps", "game-client");
/** The built client (npm run build). */
export const CLIENT_BUILD = join(CLIENT_SOURCE, "dist");
const DEFAULT_PORT = 5173;

/** Vite's command-line script, from the installed vite package, or null without one. */
function viteScript(): string | null {
  try {
    const pkg = createRequire(import.meta.url).resolve("vite/package.json");
    return join(dirname(pkg), "bin", "vite.js");
  } catch {
    return null;
  }
}

/** Splits mandrel's own options (--game, --built) from the rest, which go to Vite or the plain server. */
export function splitOptions(argv: readonly string[]): { game?: string; built: boolean; rest: string[] } {
  let game: string | undefined;
  let built = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--built") built = true;
    else if (arg === "--game") game = argv[++i];
    else if (arg.startsWith("--game=")) game = arg.slice("--game=".length);
    else rest.push(arg);
  }
  return { game, built, rest };
}

function runVite(vite: string, game: string, argv: string[]): Promise<number> {
  console.log(`${styleText("bold", gameName(game))}  ${styleText("dim", displayPath(game))}`);
  return new Promise((done) => {
    const child = spawn(process.execPath, [vite, ...argv], { cwd: CLIENT_SOURCE, stdio: "inherit", env: { ...process.env, [GAME_ENV]: game } });
    child.on("error", (error) => {
      console.error(`dev: could not start Vite: ${error.message}`);
      done(1);
    });
    child.on("exit", (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
}

async function runBuilt(game: string, argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { port: { type: "string" }, host: { type: "string" } } });
  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`dev: --port must be a port number, not '${values.port}'`);
    return 2;
  }
  if (!isBuiltClient(CLIENT_BUILD)) {
    console.error(`dev: no built client in ${displayPath(CLIENT_BUILD)}; run: npm run build`);
    return 1;
  }
  const { url } = await startServer({
    clientDir: CLIENT_BUILD,
    games: singleGame(game),
    port,
    host: values.host ?? "localhost",
    tryNextPorts: values.port === undefined,
    log: (message) => console.log(`${styleText("dim", new Date().toLocaleTimeString())} ${message}`),
  });
  console.log(
    [
      "",
      `  ${styleText("bold", gameName(game))}  ${styleText("dim", displayPath(game))}`,
      "",
      `  play  ${styleText("cyan", url)}`,
      "",
      "  Maps compile as you save them. Press Ctrl+C to stop.",
      "",
    ].join("\n"),
  );
  return new Promise(() => {}); // serves until the process is stopped
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { game: option, built, rest } = splitOptions(argv);
  const game = findGame(option);
  const vite = existsSync(join(CLIENT_SOURCE, "index.html")) ? viteScript() : null;
  return built || vite === null ? runBuilt(game, rest) : runVite(vite, game, rest);
}

if (isMain(import.meta.url)) process.exitCode = await main();
