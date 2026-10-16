// CHANGELOG.md, for releases: stamping the "## TBD" section with a version when a
// release is prepared (see release.ts), and printing a released version's section,
// which the release workflow uses as the GitHub release's notes.
//
// Usage: node tools/src/changelog.ts extract <version>   (or npm run changelog -- extract <version>)
//   Prints the section for <version> (a leading "v" is optional). Exits with 3 when
//   the changelog has no section for it, and 1 for anything else that goes wrong.

import { readFileSync } from "node:fs";
import { isMain } from "./cli.ts";
import { repoPath } from "./layout.ts";

export const CHANGELOG_PATH = repoPath("CHANGELOG.md");

/** The exit status of extract when the changelog has no section for the version, so the workflow can tell that from a failure. */
export const NOT_FOUND_EXIT_CODE = 3;

/** The subheadings every TBD section starts with. */
export const SUBHEADINGS = ["### ✨ Added", "### 🔧 Changed", "### 🐛 Fixed", "### 🗑️ Removed"] as const;

const TBD = "## TBD";

export class ChangelogError extends Error {
  override name = "ChangelogError";
}

/** The changelog has no section for a version. */
export class SectionNotFoundError extends ChangelogError {
  override name = "SectionNotFoundError";
}

/** A plain X.Y.Z version, which major, minor, and patch bump from. */
const CORE = /^\d+\.\d+\.\d+$/;
/** Any semver version: X.Y.Z with an optional pre-release (-rc.1) and build (+abc) suffix. */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** True for a pre-release version, such as 1.2.0-rc.1, which npm and GitHub don't offer as the latest release. */
export const isPrerelease = (version: string): boolean => /^[^+]*-/.test(version);

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where a "## " section starts, as line indexes: each heading's line, and the end of the file. */
function sectionBounds(lines: readonly string[], heading: RegExp): { start: number; end: number } | null {
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return null;
  const next = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  return { start, end: next === -1 ? lines.length : next };
}

/**
 * A version after a bump: "major", "minor", or "patch" from the current X.Y.Z, or an explicit version (a pre-release
 * such as 1.2.0-rc.1 too), which must be newer than the current one.
 */
export function bumpVersion(current: string, bump: string): string {
  if (bump === "major" || bump === "minor" || bump === "patch") {
    if (!CORE.test(current)) throw new ChangelogError(`can't ${bump}-bump "${current}": give the next version explicitly, such as 1.2.0`);
    const [major, minor, patch] = current.split(".").map(Number) as [number, number, number];
    if (bump === "major") return `${major + 1}.0.0`;
    if (bump === "minor") return `${major}.${minor + 1}.0`;
    return `${major}.${minor}.${patch + 1}`;
  }
  const next = bump.replace(/^v/, "");
  if (!SEMVER.test(next)) throw new ChangelogError(`the bump must be major, minor, patch, or a version such as 1.2.3 or 1.2.0-rc.1, not "${bump}"`);
  if (!isNewer(next, current)) throw new ChangelogError(`${next} isn't newer than the current version, ${current}`);
  return next;
}

/**
 * True if version a comes after b: a later X.Y.Z, or the same X.Y.Z when b is a pre-release of it (1.2.0 after
 * 1.2.0-rc.1, or another pre-release such as rc.2, whose order among pre-releases isn't checked further).
 */
function isNewer(a: string, b: string): boolean {
  const core = (v: string): number[] => v.split(/[-+]/)[0]!.split(".").map(Number);
  const [x, y] = [core(a), core(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!;
  return isPrerelease(b) && a !== b;
}

/** Today's date in UTC, as YYYY-MM-DD. */
export const today = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/** True if a section's lines hold any entries (anything but its subheadings and blank lines). */
const hasEntries = (lines: readonly string[]): boolean => lines.some((line) => line.trim() !== "" && !line.startsWith("### "));

/**
 * The changelog with its "## TBD" section released as "## v<version> - <date>", without the subheadings that have
 * no entries, and a fresh, empty TBD section above it. Throws if there's no TBD section, it has no entries, or the
 * version already has a section.
 */
export function stampChangelog(text: string, version: string, date: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (sectionBounds(lines, new RegExp(`^## v${escape(version)}(\\s|$)`)) !== null) throw new ChangelogError(`the changelog already has a section for v${version}`);
  const tbd = sectionBounds(lines, /^## TBD\s*$/);
  if (tbd === null) throw new ChangelogError(`the changelog has no "${TBD}" section to release`);
  const body = lines.slice(tbd.start + 1, tbd.end);
  if (!hasEntries(body)) throw new ChangelogError(`the "${TBD}" section has no entries: there's nothing to release`);

  // The section in parts: any text before the first subheading, then each subheading with its entries.
  const parts: string[][] = [[]];
  for (const line of body) {
    if (line.startsWith("### ")) parts.push([line]);
    else parts.at(-1)!.push(line);
  }
  // Keep the parts with entries, dropping empty subheadings, with one blank line between parts.
  const kept = parts.filter(hasEntries).flatMap((part) => [...trimBlankLines(part), ""]);

  const fresh = [TBD, "", ...SUBHEADINGS.flatMap((h) => [h, ""])];
  const released = [`## v${version} - ${date}`, "", ...kept];
  return `${[...lines.slice(0, tbd.start), ...fresh, ...released, ...trimBlankLines(lines.slice(tbd.end))].join("\n").trimEnd()}\n`;
}

/** Lines without blank ones at the start and end. */
function trimBlankLines(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === "") start++;
  while (end > start && lines[end - 1]!.trim() === "") end--;
  return lines.slice(start, end);
}

/**
 * The body of a version's section (without its heading), trimmed. Throws a SectionNotFoundError if it has none, or
 * if it's empty, so an empty release is never published.
 */
export function extractSection(text: string, version: string): string {
  const v = version.replace(/^v/, "");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const bounds = sectionBounds(lines, new RegExp(`^## v${escape(v)}(\\s|$)`));
  if (bounds === null) throw new SectionNotFoundError(`CHANGELOG.md has no section for v${v}`);
  const body = lines.slice(bounds.start + 1, bounds.end).join("\n").trim();
  if (body === "") throw new SectionNotFoundError(`CHANGELOG.md's section for v${v} is empty`);
  return body;
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const [command, version] = argv;
  if (command !== "extract" || version === undefined || argv.length !== 2) {
    console.error("usage: changelog extract <version>");
    return 2;
  }
  try {
    process.stdout.write(`${extractSection(readFileSync(CHANGELOG_PATH, "utf-8"), version)}\n`);
    return 0;
  } catch (error) {
    if (!(error instanceof SectionNotFoundError)) throw error;
    console.error(error.message);
    return NOT_FOUND_EXIT_CODE;
  }
}

if (isMain(import.meta.url)) process.exitCode = main();
