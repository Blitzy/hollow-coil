// Engine code (packages/*/src) and what ships to players (apps/*/src) never
// import the tools: tools run in Node during development and are never shipped.
// Tests and an app's vite.config.ts may use them.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { relativeToRepo, repoPath } from "../src/layout.ts";

/** Every .ts file under dir. */
const tsFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? tsFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });

const sources = ["packages", "apps"].flatMap((group) =>
  readdirSync(repoPath(group), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => tsFiles(repoPath(group, entry.name, "src"))),
);

describe("engine code", () => {
  it("has source files to check", () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it.each(sources.map((path) => [relativeToRepo(path), path]))("%s never imports the tools", (_, path) => {
    const imports = [...readFileSync(path, "utf-8").matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]!);
    expect(imports.filter((spec) => spec.startsWith("@mandreljs/tools") || /(^|\/)tools\//.test(spec))).toEqual([]);
  });
});
