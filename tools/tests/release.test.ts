import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lockWithVersion, main, readVersion, withVersion } from "../src/release.ts";
import { repoPath } from "../src/layout.ts";

describe("release", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads the engine's version from the root package.json", () => {
    expect(readVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("changes only package.json's own version", () => {
    const text = '{\n  "name": "x",\n  "version": "0.0.1",\n  "dependencies": {\n    "y": { "version": "9.9.9" }\n  }\n}\n';
    expect(withVersion(text, "0.0.2")).toBe(text.replace('"version": "0.0.1"', '"version": "0.0.2"'));
  });

  it("changes the lockfile's two records of the root version, and nothing else", () => {
    const lock = readFileSync(repoPath("package-lock.json"), "utf-8");
    const updated = lockWithVersion(lock, "9.8.7");
    const parsed = JSON.parse(updated) as { version: string; packages: Record<string, { version?: string }> };
    expect([parsed.version, parsed.packages[""]!.version]).toEqual(["9.8.7", "9.8.7"]);
    expect(lockWithVersion(updated, readVersion())).toBe(lock);
  });

  it("refuses a bad bump, date, or usage before changing anything", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const before = readFileSync(repoPath("package.json"), "utf-8");
    expect(main(["prepare", "huge"])).toBe(1);
    expect(main(["prepare", "patch", "--date", "tomorrow"])).toBe(2);
    expect(main(["publish"])).toBe(2);
    expect(readFileSync(repoPath("package.json"), "utf-8")).toBe(before);
  });
});
