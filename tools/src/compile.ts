// Compiles maps with the pinned ericw-tools (qbsp, then light).
//
// Compiles every .map in maps/ (or the ones named) to build/<name>.bsp in the
// Quake 2 formats. A map fails if it leaks, references a texture that doesn't
// exist, or if qbsp or light exits with an error. A failed map leaves no .bsp
// behind, so a stale or broken build is never mistaken for a good one.
//
// Modes:
//   check    fast lighting; the default, used by CI and for quick iteration
//   release  full-quality lighting (-extra4)
//
// Usage: node tools/src/compile.ts [map ...] [--mode check|release]   (or npm run compile)
//   map names (as in maps/<name>.map) or paths; default: every map

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { isMain, relativeToRepo, REPO_ROOT, repoPath } from "./repo.ts";
import { ericwTool, toolsInstalled } from "./setup.ts";

/** The game root holds maps/ and textures/ side by side, the standard Quake layout. */
export const GAME_DIR = REPO_ROOT;
export const MAPS_DIR = repoPath("maps");
export const BUILD_DIR = repoPath("build");

const QBSP_ARGS = ["-q2bsp", "-leaktest", "-noverbose"];
export const LIGHT_ARGS = { check: [], release: ["-extra4"] } as const satisfies Record<string, string[]>;
export type Mode = keyof typeof LIGHT_ARGS;

const LEAK = /Reached occupant "([^"]+)" at \(([^)]*)\)/;
const MISSING_TEXTURE = /Couldn't locate texture for (\S+)/g;
const WARNING = /^WARNING: (.*)$/gm;

/** Everything qbsp and light write next to the .bsp, cleared before each compile. */
const OUTPUT_SUFFIXES = [".bsp", ".log", "-light.log", ".prt", ".leak.prt", ".pts", ".texinfo.json", ".content.json"];

/** qbsp adds a "skip" texture internally and warns about it on every compile. */
const IGNORED_MISSING_TEXTURES = new Set(["skip"]);
/** Warnings that are expected and say nothing about the map's health. */
const IGNORED_WARNINGS = [
  /^Couldn't locate texture for /, // reported as problems instead
  /^Reached occupant /, // reported as a leak instead
  /can't find meta data for /, // optional .wal_json files
];

export interface CompileResult {
  readonly name: string;
  readonly problems: string[];
  readonly warnings: string[];
  seconds: number;
}

export const compileOk = (result: CompileResult): boolean => result.problems.length === 0;

/** Runs a program, resolving to its exit code and combined output (never rejecting on a non-zero exit). */
function run(command: string, args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((done) => {
    execFile(command, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      done({ code, output: `${stdout}${stderr}${error && typeof error.code !== "number" ? `\n${error.message}` : ""}` });
    });
  });
}

/** The most useful line from a failed tool run: the one after an ERROR banner, if any. */
export function errorLine(output: string): string {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.includes("ERROR")) return lines[i]!.includes("****") && i + 1 < lines.length ? lines[i + 1]! : lines[i]!;
  }
  return lines.at(-1) ?? "(no output)";
}

const warningsIn = (output: string): string[] =>
  [...output.matchAll(WARNING)].map((m) => m[1]!.trimEnd()).filter((w) => !IGNORED_WARNINGS.some((p) => p.test(w)));

/** Compiles one map to outDir/<name>.bsp. Side files (logs, .prt, .pts) land next to it. */
export async function compileMap(mapPath: string, outDir: string = BUILD_DIR, mode: Mode = "check", gameDir: string = GAME_DIR): Promise<CompileResult> {
  const name = basename(mapPath, ".map");
  const result: CompileResult = { name, problems: [], warnings: [], seconds: 0 };
  const start = performance.now();
  mkdirSync(outDir, { recursive: true });
  for (const suffix of OUTPUT_SUFFIXES) rmSync(join(outDir, `${name}${suffix}`), { force: true });
  const bsp = join(outDir, `${name}.bsp`);
  // Passed explicitly because outDir is not the maps/ folder qbsp would infer them from.
  const paths = ["-basedir", gameDir, "-gamedir", gameDir];

  const qbsp = await run(ericwTool("qbsp"), [...QBSP_ARGS, ...paths, mapPath, bsp]);
  const leak = LEAK.exec(qbsp.output);
  if (leak) {
    const pts = join(outDir, `${name}.pts`);
    const shown = resolve(pts).startsWith(resolve(REPO_ROOT)) ? relativeToRepo(pts) : pts;
    result.problems.push(`leak: "${leak[1]}" at (${leak[2]}) can reach the outside of the map. Load ${shown} in TrenchBroom (File > Load Point File) to see the path.`);
  }
  for (const [, texture] of qbsp.output.matchAll(MISSING_TEXTURE)) {
    if (!IGNORED_MISSING_TEXTURES.has(texture!)) result.problems.push(`missing texture: ${texture}`);
  }
  if (qbsp.code !== 0 && !leak) result.problems.push(`qbsp failed (exit ${qbsp.code}): ${errorLine(qbsp.output)}`);
  result.warnings.push(...warningsIn(qbsp.output));

  if (compileOk(result)) {
    const light = await run(ericwTool("light"), [...LIGHT_ARGS[mode], ...paths, bsp]);
    if (light.code !== 0) result.problems.push(`light failed (exit ${light.code}): ${errorLine(light.output)}`);
    result.warnings.push(...warningsIn(light.output));
  }

  if (!compileOk(result)) rmSync(bsp, { force: true });
  result.seconds = (performance.now() - start) / 1000;
  return result;
}

/** Map files for names (as in maps/<name>.map) or paths; every map in maps/ if none. Throws for a map that doesn't exist. */
export function findMaps(names: readonly string[]): string[] {
  if (names.length === 0) return readdirSync(MAPS_DIR).filter((f) => f.endsWith(".map")).sort().map((f) => join(MAPS_DIR, f));
  return names.map((name) => {
    const path = name.endsWith(".map") ? resolve(name) : join(MAPS_DIR, `${name}.map`);
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`no such map: ${path}`);
    return path;
  });
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, options: { mode: { type: "string", default: "check" } }, allowPositionals: true });
  const mode = values.mode as Mode;
  if (!Object.hasOwn(LIGHT_ARGS, mode)) {
    console.error(`compile: --mode must be one of ${Object.keys(LIGHT_ARGS).join(", ")}`);
    return 2;
  }
  if (!toolsInstalled()) {
    console.error("ericw-tools is not installed; run: npm run setup");
    return 1;
  }
  let maps: string[];
  try {
    maps = findMaps(positionals);
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (maps.length === 0) {
    console.log(`no maps found in ${relativeToRepo(MAPS_DIR)}/`);
    return 0;
  }

  console.log(`compiling ${maps.length} map(s) in ${mode} mode -> ${relativeToRepo(BUILD_DIR)}/`);
  const width = Math.max(...maps.map((m) => basename(m, ".map").length));
  let failed = 0;
  for (const map of maps) {
    const result = await compileMap(map, BUILD_DIR, mode);
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
