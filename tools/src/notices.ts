// Third-party license notices for what ships to players. Building minifies
// the client and drops license comments, but licenses such as Three.js's (MIT)
// require their notice to travel with every copy. This Vite plugin lists each
// npm package bundled into a build, with its license text, in
// THIRD-PARTY-NOTICES.txt next to the build's index.html.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";

export const NOTICES_FILE = "THIRD-PARTY-NOTICES.txt";
const LICENSE_FILES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md", "COPYING"];

export interface BundledPackage {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  /** The package's license file, or "" if it has none. */
  readonly text: string;
}

/** The npm package a bundled module came from, or null for our own code. Takes the outermost package under node_modules. */
function packageOf(moduleId: string): BundledPackage | null {
  const path = moduleId.replace(/\\/g, "/").split("?")[0]!;
  const at = path.lastIndexOf("/node_modules/");
  if (at < 0) return null;
  const rest = path.slice(at + "/node_modules/".length).split("/");
  const root = join(path.slice(0, at), "node_modules", ...(rest[0]!.startsWith("@") ? rest.slice(0, 2) : rest.slice(0, 1)));
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as { name: string; version: string; license?: string };
  const file = LICENSE_FILES.map((name) => join(root, name)).find((candidate) => existsSync(candidate));
  return { name: pkg.name, version: pkg.version, license: pkg.license ?? "unknown", text: file === undefined ? "" : readFileSync(file, "utf-8").trim() };
}

/** The packages bundled from these module ids, once each, by name. */
export function bundledPackages(moduleIds: Iterable<string>): BundledPackage[] {
  const found = new Map<string, BundledPackage>();
  const seen = new Set<string>();
  for (const id of moduleIds) {
    const dir = id.includes("node_modules") ? dirname(id) : null;
    if (dir === null || seen.has(dir)) continue;
    seen.add(dir);
    const pkg = packageOf(id);
    if (pkg !== null && !found.has(pkg.name)) found.set(pkg.name, pkg);
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The notices file's text. */
export function noticesText(packages: readonly BundledPackage[], what: string): string {
  const header = `Third-party software in ${what}, and its licenses.\n`;
  if (packages.length === 0) return `${header}\n(none)\n`;
  const sections = packages.map((pkg) => `${"=".repeat(72)}\n${pkg.name} ${pkg.version} (${pkg.license})\n${"=".repeat(72)}\n\n${pkg.text || "(no license file in the package)"}\n`);
  return `${header}\n${sections.join("\n")}`;
}

/** Writes THIRD-PARTY-NOTICES.txt into a build: every npm package bundled into it, with its license. */
export function thirdPartyNotices(what: string): Plugin {
  return {
    name: "mandreljs-third-party-notices",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: NOTICES_FILE, source: noticesText(bundledPackages(this.getModuleIds()), what) });
    },
  };
}
