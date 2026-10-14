// Downloads and installs pinned third-party tools into .tools/, at the
// versions and checksums pinned in tools/versions.json, so every machine and
// CI use the same builds:
//   - ericw-tools (qbsp, light, vis, bsputil, bspinfo)
//
// Usage: node tools/src/setup.ts [tool ...] [--check | --force]   (or npm run setup)
//   no options   install anything missing
//   tool names   only those (ericw-tools)
//   --check      verify installs; exit 1 if anything is missing
//   --force      reinstall even if already installed

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { isMain } from "./cli.ts";
import { relativeToRepo, repoPath } from "./layout.ts";
import { extractZip } from "./zip.ts";

export const VERSIONS_FILE = repoPath("tools", "versions.json");
export const TOOLS_DIR = repoPath(".tools");
export const DOWNLOADS_DIR = join(TOOLS_DIR, "downloads");

/** Written last during install, holding the archive checksum. Its absence means the install is missing or incomplete. */
const MARKER = ".installed";
const ERICW_BINARIES = ["qbsp", "light", "vis", "bsputil", "bspinfo"];

export interface Versions {
  "ericw-tools": {
    version: string;
    url: string;
    platforms: Record<string, { file: string; sha256: string } | undefined>;
  };
}

export class SetupError extends Error {
  override name = "SetupError";
}

export function platformKey(): string {
  if (process.platform === "win32") return "windows";
  if (process.platform === "linux") return "linux";
  if (process.platform === "darwin") return "macos";
  throw new SetupError(`unsupported platform: ${process.platform}`);
}

export const exeName = (name: string): string => (process.platform === "win32" ? `${name}.exe` : name);

export const loadVersions = (): Versions => JSON.parse(readFileSync(VERSIONS_FILE, "utf-8")) as Versions;

/** Directory holding the pinned ericw-tools binaries. */
export const ericwDir = (versions: Versions = loadVersions()): string => join(TOOLS_DIR, "ericw-tools", versions["ericw-tools"].version);

/** Path to one ericw-tools binary, such as "qbsp" or "light". */
export const ericwTool = (name: string, versions?: Versions): string => join(ericwDir(versions), exeName(name));

const sha256Of = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

async function download(url: string, dest: string, expectedSha256: string): Promise<void> {
  if (existsSync(dest) && sha256Of(dest) === expectedSha256) {
    console.log(`  using cached ${dest.split(/[\\/]/).pop()}`);
    return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  console.log(`  downloading ${url}`);
  let bytes: Uint8Array;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    throw new SetupError(`download failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expectedSha256) {
    throw new SetupError(`checksum mismatch for ${url.split("/").pop()}\n  expected ${expectedSha256}\n  got      ${actual}`);
  }
  const partial = `${dest}.partial`;
  writeFileSync(partial, bytes);
  renameSync(partial, dest);
}

/** Checks the binaries exist and that qbsp's banner names the pinned version. */
export function verifyEricw(installDir: string, version: string): void {
  const missing = ERICW_BINARIES.filter((name) => !existsSync(join(installDir, exeName(name))));
  if (missing.length > 0) throw new SetupError(`ericw-tools install is missing: ${missing.join(", ")}`);

  // Run with no arguments, qbsp prints a banner like "---- qbsp / ericw-tools 2.0.0-alpha11 ----".
  const qbsp = join(installDir, exeName("qbsp"));
  const result = spawnSync(qbsp, [], { encoding: "utf-8", timeout: 30_000 });
  if (result.error) throw new SetupError(`could not run ${qbsp}: ${result.error.message}`);
  const banner = `${result.stdout}${result.stderr}`.split(/\r?\n/)[0] || "(no output)";
  const expected = `ericw-tools ${version}`;
  if (!banner.includes(expected)) throw new SetupError(`unexpected qbsp banner '${banner}', expected it to mention '${expected}'`);
}

async function installEricw(versions: Versions, force: boolean): Promise<void> {
  const entry = versions["ericw-tools"];
  const { version } = entry;
  const platform = entry.platforms[platformKey()];
  if (!platform) throw new SetupError(`no ericw-tools build listed for ${platformKey()} in versions.json`);

  const installDir = ericwDir(versions);
  const marker = join(installDir, MARKER);
  if (!force && existsSync(marker) && readFileSync(marker, "utf-8").trim() === platform.sha256) {
    console.log(`ericw-tools ${version}: already installed`);
    return;
  }

  console.log(`ericw-tools ${version}: installing`);
  const archive = join(DOWNLOADS_DIR, platform.file);
  await download(entry.url.replace("{version}", version).replace("{file}", platform.file), archive, platform.sha256);

  // Extract and verify in a staging folder, then swap it in, so an interrupted install never looks complete.
  const staging = `${installDir}.partial`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  extractZip(new Uint8Array(readFileSync(archive)), staging);
  verifyEricw(staging, version);
  writeFileSync(join(staging, MARKER), `${platform.sha256}\n`);
  rmSync(installDir, { recursive: true, force: true });
  renameSync(staging, installDir);
  console.log(`  installed to ${relativeToRepo(installDir)}`);
}

function checkEricw(versions: Versions): boolean {
  const { version } = versions["ericw-tools"];
  const installDir = ericwDir(versions);
  if (!existsSync(join(installDir, MARKER))) {
    console.log(`ericw-tools ${version}: not installed (run npm run setup)`);
    return false;
  }
  try {
    verifyEricw(installDir, version);
  } catch (error) {
    console.log(`ericw-tools ${version}: broken install: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
  console.log(`ericw-tools ${version}: ok`);
  return true;
}

/** True if the pinned qbsp and light are installed. */
export function toolsInstalled(): boolean {
  try {
    return statSync(ericwTool("qbsp")).isFile() && statSync(ericwTool("light")).isFile();
  } catch {
    return false;
  }
}

/** Each tool by its versions.json key. */
const TOOLS: Record<string, { install: (v: Versions, force: boolean) => Promise<void>; check: (v: Versions) => boolean }> = {
  "ericw-tools": { install: installEricw, check: checkEricw },
};

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { check: { type: "boolean" }, force: { type: "boolean" } },
    allowPositionals: true,
  });
  if (values.check && values.force) {
    console.error("setup: --check and --force can't be used together");
    return 2;
  }
  const unknown = positionals.filter((name) => !Object.hasOwn(TOOLS, name));
  if (unknown.length > 0) {
    console.error(`setup: unknown tool(s): ${unknown.join(", ")} (choose from ${Object.keys(TOOLS).join(", ")})`);
    return 2;
  }
  const selected = positionals.length > 0 ? positionals : Object.keys(TOOLS);

  try {
    const versions = loadVersions();
    if (values.check) return selected.map((name) => TOOLS[name]!.check(versions)).every(Boolean) ? 0 : 1;
    for (const name of selected) await TOOLS[name]!.install(versions, values.force ?? false);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`setup failed: ${error.message}`);
    return 1;
  }
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = await main();
