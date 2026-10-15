// Builds a release of a game in its dist/ folder, ready for any static web host:
//
//   dist/index.html, assets/        the game client
//   dist/games/index.json           names the game to play
//   dist/games/<game>/data/         the game's data files
//   dist/games/<game>/textures/     its textures
//   dist/games/<game>/build/        its maps, compiled at release quality (the .map sources stay out)
//
// It validates the game first and stops at any problem, as it does if a map
// fails to compile. Inside this repo it builds the client from source first,
// so the release has the current engine.
//
// Usage: node tools/src/build.ts [--game dir] [--mode release|check]   (or mandrel build, npm run build)
//   --mode   map lighting: release (the default) or the faster check, to try a release quickly

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs, styleText } from "node:util";
import { isMain } from "./cli.ts";
import { buildClient, CLIENT_BUILD, isBuiltClient, viteScript } from "./client.ts";
import { main as compile, findMaps, LIGHT_ARGS, type Mode } from "./compile.ts";
import { gameName } from "./dev-server.ts";
import { buildDir, displayPath, findGame } from "./layout.ts";
import { main as validate } from "./validate.ts";

/** Every file under a folder, with its size. */
function filesIn(dir: string): { path: string; size: number }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesIn(path) : [{ path, size: statSync(path).size }];
  });
}

const megabytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** Copies the client and the game's release files into out, replacing what was there. Returns what it wrote, for the summary. */
export function writeRelease(game: string, clientDir: string, out: string): { maps: number; textures: number; data: number; bytes: number } {
  rmSync(out, { recursive: true, force: true });
  cpSync(clientDir, out, { recursive: true });
  const name = basename(game);
  const target = join(out, "games", name);
  mkdirSync(join(target, "data"), { recursive: true });
  writeFileSync(join(out, "games", "index.json"), `${JSON.stringify({ default: name, games: [name] })}\n`);

  const data = readdirSync(join(game, "data")).filter((file) => file.endsWith(".json"));
  for (const file of data) cpSync(join(game, "data", file), join(target, "data", file));
  if (existsSync(join(game, "textures"))) cpSync(join(game, "textures"), join(target, "textures"), { recursive: true });
  const maps = findMaps([], game).map((map) => `${basename(map, ".map")}.bsp`);
  mkdirSync(join(target, "build"), { recursive: true });
  for (const bsp of maps) cpSync(join(buildDir(game), bsp), join(target, "build", bsp));

  const textures = existsSync(join(target, "textures")) ? filesIn(join(target, "textures")).length : 0;
  return { maps: maps.length, textures, data: data.length, bytes: filesIn(out).reduce((sum, file) => sum + file.size, 0) };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { game: { type: "string" }, mode: { type: "string", default: "release" } } });
  const mode = values.mode as Mode;
  if (!Object.hasOwn(LIGHT_ARGS, mode)) {
    console.error(`build: --mode must be one of ${Object.keys(LIGHT_ARGS).join(", ")}`);
    return 2;
  }
  const game = findGame(values.game);
  const out = join(game, "dist");
  const step = (title: string): void => console.log(`\n${styleText("bold", title)}`);
  console.log(`Building ${styleText("bold", gameName(game))} into ${displayPath(out)}/`);

  step("Checking the game");
  if (validate(["--game", game, "--quiet"]) !== 0) {
    console.log("\nbuild stopped: fix the problems above, then build again");
    return 1;
  }

  step("Building the client");
  const vite = viteScript();
  if (vite !== null) {
    const failure = await buildClient(vite);
    if (failure !== null) {
      console.log(`FAIL  client\n${failure}\n\nbuild stopped: the client didn't build`);
      return 1;
    }
    console.log("ok    built from source");
  } else if (isBuiltClient(CLIENT_BUILD)) {
    console.log("ok    using the engine's built client");
  } else {
    console.log(`FAIL  no built client in ${displayPath(CLIENT_BUILD)}`);
    return 1;
  }

  step("Compiling maps");
  if ((await compile(["--game", game, "--mode", mode])) !== 0) {
    console.log("\nbuild stopped: fix the maps above, then build again");
    return 1;
  }

  step("Writing the release");
  const wrote = writeRelease(game, CLIENT_BUILD, out);
  console.log(`ok    ${wrote.maps} maps, ${wrote.textures} textures, ${wrote.data} data files, ${megabytes(wrote.bytes)} in all`);
  console.log(`\nDone. Put ${displayPath(out)}/ on any static web host.${mode === "check" ? " (Maps have fast check lighting; build without --mode check for release lighting.)" : ""}`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = await main();
