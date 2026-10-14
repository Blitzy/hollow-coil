// Compiles maps with the pinned ericw-tools (qbsp, then light).
//
// Compiles every .map in a game's maps/ (or the ones named) to
// build/<game>/<name>.bsp in the Quake 2 formats. A map fails if it leaks, references a texture that doesn't
// exist, or if qbsp or light exits with an error. A failed map leaves no .bsp
// behind, so a stale or broken build is never mistaken for a good one.
//
// Modes:
//   check    fast lighting; the default, used by CI and for quick iteration
//   release  full-quality lighting (-extra4)
//
// Run from the command line with npm run compile (tools/src/compile.ts); the dev
// server compiles stale maps with it too.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { buildDir, EXAMPLE_GAME, relativeToRepo, REPO_ROOT } from "./layout.ts";
import { ericwTool } from "./setup.ts";

const QBSP_ARGS = ["-q2bsp", "-leaktest", "-noverbose"];
// For Quake 2 maps, light bounces light once by default and keeps each light's
// style on its bounced light, so a flickering light's bounce flickers in rooms
// it doesn't reach. -bouncestyled 0 keeps the bounce but bounces only steady
// light, as Quake 2's own qrad3 did.
const LIGHT_COMMON = ["-bouncestyled", "0"];
export const LIGHT_ARGS = { check: [...LIGHT_COMMON], release: ["-extra4", ...LIGHT_COMMON] } as const satisfies Record<string, string[]>;
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

/**
 * Compiles one map to outDir/<name>.bsp. Side files (logs, .prt, .pts) land next to it.
 * Textures come from game/textures/: the game directory holds maps/ and textures/ side by side, the standard Quake layout.
 */
export async function compileMap(mapPath: string, outDir: string = buildDir(EXAMPLE_GAME), mode: Mode = "check", game: string = EXAMPLE_GAME): Promise<CompileResult> {
  const name = basename(mapPath, ".map");
  const result: CompileResult = { name, problems: [], warnings: [], seconds: 0 };
  const start = performance.now();
  mkdirSync(outDir, { recursive: true });
  for (const suffix of OUTPUT_SUFFIXES) rmSync(join(outDir, `${name}${suffix}`), { force: true });
  const bsp = join(outDir, `${name}.bsp`);
  // Passed explicitly because outDir is not the maps/ folder qbsp would infer them from.
  const paths = ["-basedir", game, "-gamedir", game];

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

/** Map files for names (as in game/maps/<name>.map) or paths; every map in game/maps/ if none. Throws for a map that doesn't exist. */
export function findMaps(names: readonly string[], game: string = EXAMPLE_GAME): string[] {
  const mapsDir = join(game, "maps");
  if (names.length === 0) return readdirSync(mapsDir).filter((f) => f.endsWith(".map")).sort().map((f) => join(mapsDir, f));
  return names.map((name) => {
    const path = name.endsWith(".map") ? resolve(name) : join(mapsDir, `${name}.map`);
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`no such map: ${path}`);
    return path;
  });
}
