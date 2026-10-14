// Enforces the simulation rules from CLAUDE.md on this package's src: no Three.js,
// DOM, or Node imports, no wall clock, and no unseeded randomness. The package's
// tsconfig.json separately makes any DOM or Node global a type error.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SIM_DIR = join(import.meta.dirname, "../src");

function simSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return simSources(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

const FORBIDDEN: [RegExp, string][] = [
  [/\bMath\.random\b/, "Math.random (use the sim's seeded RNG)"],
  [/\bDate\b/, "Date (the sim has no wall clock)"],
  [/\bperformance\b/, "performance (the sim has no wall clock)"],
  [/\b(setTimeout|setInterval|requestAnimationFrame)\b/, "timers (the sim is stepped by the caller)"],
  [/\b(window|document|globalThis|navigator)\b/, "browser globals"],
];

describe("sim purity", () => {
  const files = simSources(SIM_DIR);

  it("finds sim sources", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [relative(SIM_DIR, f), f]))("%s imports only relative sim modules", (_name, file) => {
    const source = readFileSync(file, "utf-8");
    const imports = [...source.matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g)].map((m) => m[1] ?? m[2]);
    for (const spec of imports) expect(spec, `import of "${spec}"`).toMatch(/^\.\.?\//);
  });

  it.each(files.map((f) => [relative(SIM_DIR, f), f]))("%s avoids clocks, randomness, and globals", (_name, file) => {
    const code = readFileSync(file, "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    for (const [pattern, what] of FORBIDDEN) expect(code, what).not.toMatch(pattern);
  });
});
