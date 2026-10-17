// Builds a release of a game in its dist/ folder, ready for any static web host:
//
//   dist/index.html, assets/        the game client (the engine), with THIRD-PARTY-NOTICES.txt
//   dist/LICENSE, LICENSE-EXCEPTION.md, NOTICE.md
//                                   the engine's license, and what's whose: the engine is
//                                   GPL and its source is linked; the game's content is its authors'
//   dist/games/index.json           names the game to play, and its maps
//   dist/games/<game>/data/         the game's data files
//   dist/games/<game>/textures/     its textures
//   dist/games/<game>/build/        its maps, compiled at release quality (the .map sources stay out)
//   dist/games/<game>/LICENSE.md    the game's own notices (LICENSE, NOTICE, CREDITS, or COPYING
//                                   files at the top of its folder), linked from NOTICE.md
//
// It validates the game first and stops at any problem, as it does if a map
// fails to compile. Inside this repo it builds the client from source first,
// so the release has the current engine.
//
// Usage: node tools/src/build.ts [--game dir] [--mode release|check]   (or mandreljs build, npm run build)
//   --mode   map lighting: release (the default) or the faster check, to try a release quickly

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs, styleText } from "node:util";
import { isMain } from "./cli.ts";
import { buildClient, CLIENT_BUILD, isBuiltClient, viteScript } from "./client.ts";
import { main as compile, findMaps, LIGHT_ARGS, type Mode } from "./compile.ts";
import { gameIndex, gameName } from "./dev-server.ts";
import { ENGINE_ROOT } from "./engine-files.ts";
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

/** The engine's version and where its source is, from its package.json (this repo's root, or the installed package's). */
export function engineInfo(root: string = ENGINE_ROOT): { version: string; source: string | null } {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as { version: string; repository?: { url?: string } | string };
  const url = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  return { version: pkg.version, source: url === undefined ? null : url.replace(/^git\+/, "").replace(/\.git$/, "") };
}

/** A game's own notices: LICENSE, NOTICE, CREDITS, or COPYING files (any extension) at the top of its folder, which its releases carry. */
export function gameNotices(game: string): string[] {
  return readdirSync(game, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^(LICEN[CS]E|NOTICE|CREDITS|COPYING)(\..+)?$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/**
 * NOTICE.md for a release: what's the engine's, under which license and where its source is, and what's the game's.
 * contentNotices are the game's own notices, as paths in the release.
 */
export function releaseNotice(game: string, engine: { version: string; source: string | null }, contentNotices: readonly string[] = []): string {
  const source = engine.source === null ? "Its source code is available from its authors." : `Its source code is at ${engine.source} (version ${engine.version}).`;
  const terms = contentNotices.length === 0 ? "under their own terms" : `under their own terms: see ${contentNotices.map((path) => `\`${path}\``).join(" and ")}`;
  return [
    "# Notices",
    "",
    `${game} runs on Mandrel.js ${engine.version}, an open-source game engine.`,
    "",
    `- **The engine** is \`index.html\` and \`assets/\`. It's licensed under the GNU General Public License v3.0 or later, with an additional permission for linking with platform SDKs: see \`LICENSE\` and \`LICENSE-EXCEPTION.md\`. ${source}`,
    "- **Third-party software** in the engine, and its licenses, is listed in `THIRD-PARTY-NOTICES.txt`.",
    `- **The game's content** (\`games/\`: its maps, textures, and data) is by the authors of ${game}, ${terms}.`,
    "",
  ].join("\n");
}

/** Copies the client and the game's release files into out, replacing what was there. Returns what it wrote, for the summary. */
export function writeRelease(game: string, clientDir: string, out: string): { maps: number; textures: number; data: number; bytes: number } {
  rmSync(out, { recursive: true, force: true });
  cpSync(clientDir, out, { recursive: true });
  for (const file of ["LICENSE", "LICENSE-EXCEPTION.md"]) cpSync(join(ENGINE_ROOT, file), join(out, file));
  const name = basename(game);
  const target = join(out, "games", name);
  mkdirSync(join(target, "data"), { recursive: true });
  // The game's own notices travel with its content, such as the credit a CC BY license requires.
  const notices = gameNotices(game);
  for (const file of notices) cpSync(join(game, file), join(target, file));
  writeFileSync(join(out, "NOTICE.md"), releaseNotice(gameName(game), engineInfo(), notices.map((file) => `games/${name}/${file}`)));

  const data = readdirSync(join(game, "data")).filter((file) => file.endsWith(".json"));
  for (const file of data) cpSync(join(game, "data", file), join(target, "data", file));
  if (existsSync(join(game, "textures"))) cpSync(join(game, "textures"), join(target, "textures"), { recursive: true });
  const maps = findMaps([], game).map((map) => `${basename(map, ".map")}.bsp`);
  mkdirSync(join(target, "build"), { recursive: true });
  for (const bsp of maps) cpSync(join(buildDir(game), bsp), join(target, "build", bsp));
  const index = gameIndex(name, [{ name, maps: maps.map((bsp) => basename(bsp, ".bsp")) }]);
  writeFileSync(join(out, "games", "index.json"), `${JSON.stringify(index)}\n`);

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
