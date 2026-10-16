// Prepares a release on develop: bumps the engine's version (the root
// package.json's, which the mandreljs package and the game client both carry, and
// the lockfile's copy of it) and stamps CHANGELOG.md's "## TBD" section with it.
// Merging develop into main then releases it: once CI passes there, the release
// workflow (.github/workflows/release.yml) publishes mandreljs to npm and makes the
// GitHub release and its tag.
//
// Usage: node tools/src/release.ts prepare <bump> [--date YYYY-MM-DD]   (or npm run release -- prepare <bump>)
//   bump     major, minor, patch, or a version such as 1.2.3 or a pre-release such as 1.2.0-rc.1
//   --date   the release date; default: today, in UTC

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { bumpVersion, CHANGELOG_PATH, ChangelogError, stampChangelog, today } from "./changelog.ts";
import { isMain } from "./cli.ts";
import { repoPath } from "./layout.ts";

const PACKAGE_PATH = repoPath("package.json");
const LOCK_PATH = repoPath("package-lock.json");

/** The engine's version, from the root package.json. */
export const readVersion = (path: string = PACKAGE_PATH): string => (JSON.parse(readFileSync(path, "utf-8")) as { version: string }).version;

/** package.json's text with its own "version" changed, and nothing else (its formatting and key order stay). */
export function withVersion(packageText: string, version: string): string {
  const updated = packageText.replace(/^(\s*"version"\s*:\s*)"[^"]*"/m, `$1"${version}"`);
  if (updated === packageText) throw new ChangelogError('package.json has no "version" to update');
  return updated;
}

/** package-lock.json's text with the root package's version changed, in both places the lockfile records it. */
export function lockWithVersion(lockText: string, version: string): string {
  const lock = JSON.parse(lockText) as { version: string; packages: Record<string, { version?: string }> };
  lock.version = version;
  lock.packages[""]!.version = version;
  return `${JSON.stringify(lock, null, 2)}\n`;
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { date: { type: "string" } } });
  const [command, bump] = positionals;
  if (command !== "prepare" || bump === undefined || positionals.length !== 2) {
    console.error("usage: release prepare <major|minor|patch|X.Y.Z> [--date YYYY-MM-DD]");
    return 2;
  }
  const date = values.date ?? today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`release: --date must be YYYY-MM-DD, not "${date}"`);
    return 2;
  }
  try {
    const current = readVersion();
    const next = bumpVersion(current, bump);
    // Work everything out before writing anything, so a problem leaves no file half-changed.
    const changelog = stampChangelog(readFileSync(CHANGELOG_PATH, "utf-8"), next, date);
    const pkg = withVersion(readFileSync(PACKAGE_PATH, "utf-8"), next);
    const lock = lockWithVersion(readFileSync(LOCK_PATH, "utf-8"), next);
    writeFileSync(CHANGELOG_PATH, changelog);
    writeFileSync(PACKAGE_PATH, pkg);
    writeFileSync(LOCK_PATH, lock);
    console.log(
      [
        `Prepared v${next} (${date}):`,
        `  package.json and package-lock.json: ${current} -> ${next}`,
        `  CHANGELOG.md: "## TBD" -> "## v${next} - ${date}", with a fresh TBD section`,
        "",
        "Next:",
        "  1. Review the changes (git diff), and commit them on develop.",
        "  2. Merge develop into main. When CI passes there, the release workflow",
        `     publishes mandreljs ${next} to npm and makes the v${next} GitHub release.`,
      ].join("\n"),
    );
    return 0;
  } catch (error) {
    if (!(error instanceof ChangelogError)) throw error;
    console.error(`release: ${error.message}`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = main();
