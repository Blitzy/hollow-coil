// Fails if any tracked file is larger than MAX_BYTES.
//
// Large binaries belong in Git LFS (not set up yet; see docs/DECISIONS.md if it
// becomes needed). Catching them in CI keeps them out of history, where they
// would stay forever.
//
// Usage: node tools/src/check-files.ts   (or npm run check-files)

import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./layout.ts";
import { isMain } from "./cli.ts";

export const MAX_BYTES = 2 * 1024 * 1024;

const mb = (n: number): string => `${(n / (1024 * 1024)).toFixed(2)} MB`;

/** Paths of every file git tracks, relative to the root, with forward slashes. */
export function trackedFiles(root: string = REPO_ROOT): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf-8" });
  return out.split("\0").filter((name) => name !== "");
}

/** The files (relative paths) over maxBytes, with their sizes. Missing files, such as deletions not yet committed, are skipped. */
export function oversizedFiles(root: string, files: readonly string[], maxBytes = MAX_BYTES): { path: string; size: number }[] {
  return files.flatMap((path) => {
    try {
      const stat = statSync(join(root, path));
      return stat.isFile() && stat.size > maxBytes ? [{ path, size: stat.size }] : [];
    } catch {
      return [];
    }
  });
}

function main(): number {
  const tooBig = oversizedFiles(REPO_ROOT, trackedFiles());
  if (tooBig.length > 0) {
    console.log(`Files larger than ${mb(MAX_BYTES)}:`);
    for (const { path, size } of tooBig) console.log(`  ${path}  ${mb(size)}`);
    return 1;
  }
  console.log(`ok: no tracked file is larger than ${mb(MAX_BYTES)}`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main();
