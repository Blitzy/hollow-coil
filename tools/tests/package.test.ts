// The mandreljs package's pieces that can drift without the packed-install test noticing until CI.
// (That test, which packs the package and runs it in a game folder, is tools/src/test-package.ts.)

import { describe, expect, it } from "vitest";
import * as packaged from "../src/engine-files.package.ts";
import * as source from "../src/engine-files.ts";
import { packageJson } from "../src/package.ts";

describe("engine files", () => {
  it("are found the same way from source and from the package", () => {
    // The package bundles the tools with engine-files.package.ts in place of engine-files.ts, so they must export the same things.
    expect(Object.keys(packaged).sort()).toEqual(Object.keys(source).sort());
    // Same kinds of value; null stands in for a path the package doesn't have (the client's source).
    const kind = (value: unknown): string => (value === null ? "string" : typeof value);
    for (const key of Object.keys(source) as (keyof typeof source)[]) expect(kind(packaged[key]), key).toBe(kind(source[key]));
  });

  it("say where they are", () => {
    expect([source.IN_REPO, source.BUNDLED]).toEqual([true, false]);
    expect([packaged.IN_REPO, packaged.BUNDLED, packaged.CLIENT_SOURCE]).toEqual([false, true, null]);
  });
});

describe("package.json", () => {
  it("provides the mandreljs command, needs Node 24, and has no dependencies", () => {
    const pkg = packageJson("1.2.3");
    expect(pkg).toMatchObject({ name: "mandreljs", version: "1.2.3", bin: { mandreljs: "bin/mandreljs.js" }, engines: { node: ">=24" }, type: "module" });
    expect(pkg).not.toHaveProperty("dependencies");
    expect(packageJson("1.2.3", { type: "git", url: "git+https://github.com/mandreljs/mandrel.js.git" }).repository).toEqual({ type: "git", url: "git+https://github.com/mandreljs/mandrel.js.git" });
  });
});
