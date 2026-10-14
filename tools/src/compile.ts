// Compiles a game's maps with the pinned ericw-tools: every .map in its maps/
// (or the ones named) to build/<game>/<name>.bsp. A map fails if it leaks,
// references a missing texture, or if qbsp or light fails. See
// packages/toolchain/src/compile.ts.
//
// Modes:
//   check    fast lighting; the default, used by CI and for quick iteration
//   release  full-quality lighting (-extra4)
//
// Usage: node tools/src/compile.ts [map ...] [--mode check|release] [--game dir]   (or npm run compile)
//   map names (as in maps/<name>.map) or paths; default: every map
//   --game   the game directory, relative to the repo root; default: example

import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { compileMap, compileOk, findMaps, LIGHT_ARGS, type Mode } from "@mandreljs/toolchain/compile";
import { buildDir, gameDir, relativeToRepo } from "@mandreljs/toolchain/layout";
import { toolsInstalled } from "@mandreljs/toolchain/setup";
import { isMain } from "./cli.ts";

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, options: { mode: { type: "string", default: "check" }, game: { type: "string" } }, allowPositionals: true });
  const mode = values.mode as Mode;
  if (!Object.hasOwn(LIGHT_ARGS, mode)) {
    console.error(`compile: --mode must be one of ${Object.keys(LIGHT_ARGS).join(", ")}`);
    return 2;
  }
  if (!toolsInstalled()) {
    console.error("ericw-tools is not installed; run: npm run setup");
    return 1;
  }
  const game = gameDir(values.game);
  const outDir = buildDir(game);
  let maps: string[];
  try {
    maps = findMaps(positionals, game);
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (maps.length === 0) {
    console.log(`no maps found in ${relativeToRepo(join(game, "maps"))}/`);
    return 0;
  }

  console.log(`compiling ${maps.length} map(s) in ${mode} mode -> ${relativeToRepo(outDir)}/`);
  const width = Math.max(...maps.map((m) => basename(m, ".map").length));
  let failed = 0;
  for (const map of maps) {
    const result = await compileMap(map, outDir, mode, game);
    const n = result.warnings.length;
    const note = n > 0 ? `  (${n} warning${n === 1 ? "" : "s"})` : "";
    console.log(`  ${compileOk(result) ? "ok  " : "FAIL"}  ${result.name.padEnd(width)}  ${result.seconds.toFixed(1).padStart(5)}s${note}`);
    for (const problem of result.problems) console.log(`        ${problem}`);
    for (const warning of result.warnings) console.log(`        warning: ${warning}`);
    if (!compileOk(result)) failed++;
  }
  console.log(`${maps.length - failed} ok, ${failed} failed`);
  return failed > 0 ? 1 : 0;
}

if (isMain(import.meta.url)) process.exitCode = await main();
