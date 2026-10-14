import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_BYTES, oversizedFiles, trackedFiles } from "../src/check-files.ts";
import { REPO_ROOT } from "../src/repo.ts";

describe("check-files", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("finds files over the limit and skips the rest", () => {
    const dir = mkdtempSync(join(tmpdir(), "hc-files-"));
    dirs.push(dir);
    writeFileSync(join(dir, "small.bin"), Buffer.alloc(10));
    writeFileSync(join(dir, "big.bin"), Buffer.alloc(101));
    expect(oversizedFiles(dir, ["small.bin", "big.bin", "deleted.bin"], 100)).toEqual([{ path: "big.bin", size: 101 }]);
  });

  it("lists the repo's tracked files with forward slashes", () => {
    const files = trackedFiles(REPO_ROOT);
    expect(files).toContain("package.json");
    expect(files).toContain("maps/test_movement.map");
    expect(files.every((f) => !f.includes("\\"))).toBe(true);
  });

  it("uses a 2 MB limit", () => {
    expect(MAX_BYTES).toBe(2 * 1024 * 1024);
  });
});
