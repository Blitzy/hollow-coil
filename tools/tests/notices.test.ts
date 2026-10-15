import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundledPackages, noticesText } from "../src/notices.ts";
import { repoPath } from "../src/layout.ts";

describe("third-party notices", () => {
  const three = repoPath("node_modules", "three", "build", "three.module.js");

  it("finds each npm package bundled in, once, with its license", () => {
    const packages = bundledPackages([three, repoPath("node_modules", "three", "src", "math", "Vector3.js"), repoPath("packages", "sim", "src", "sim.ts"), "\0vite/preload-helper"]);
    expect(packages.map((pkg) => [pkg.name, pkg.license])).toEqual([["three", "MIT"]]);
    expect(packages[0]!.text).toMatch(/^The MIT License/);
  });

  it("names the package an inner file belongs to, scoped or not", () => {
    // A scoped package's root is two folders under node_modules; vitest is one, scoped under @vitest's own dependencies.
    const scoped = bundledPackages([join(repoPath("node_modules", "@types", "three"), "index.d.ts")]);
    expect(scoped.map((pkg) => pkg.name)).toEqual(["@types/three"]);
  });

  it("writes each package's license under a heading, or says there are none", () => {
    const text = noticesText([{ name: "three", version: "1.0.0", license: "MIT", text: "The MIT License" }], "the client");
    expect(text).toContain("Third-party software in the client, and its licenses.");
    expect(text).toContain("three 1.0.0 (MIT)");
    expect(text).toContain("The MIT License");
    expect(noticesText([], "the client")).toContain("(none)");
  });
});
