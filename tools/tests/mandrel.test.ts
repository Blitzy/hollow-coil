import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { repoPath } from "../src/layout.ts";
import { helpText, main, usageLine } from "../src/mandrel.ts";

describe("mandrel", () => {
  afterEach(() => vi.restoreAllMocks());
  const capture = (): { out: string[]; err: string[] } => {
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void out.push(line));
    vi.spyOn(console, "error").mockImplementation((line: string) => void err.push(line));
    return { out, err };
  };

  it("lists its commands", async () => {
    const { out } = capture();
    expect(await main(["help"])).toBe(0);
    for (const name of ["dev", "build", "compile", "validate", "bspdump", "setup", "install-trenchbroom"]) expect(out.join("\n")).toContain(name);
    expect(await main([])).toBe(2); // no command: the list, but as a failure
  });

  it("runs a command with its options", async () => {
    const { out } = capture();
    expect(await main(["validate", "--game", "example"])).toBe(0);
    expect(out.at(-1)).toBe("ok    cross-file checks");
  });

  it("shows a command's usage for --help, without running it", async () => {
    const { out } = capture();
    expect(await main(["compile", "--help"])).toBe(0);
    expect(out[0]).toContain(usageLine("compile"));
    expect(out.join("\n")).not.toContain("compiling");
  });

  it("explains an unknown command or option briefly", async () => {
    const { err } = capture();
    expect(await main(["frobnicate"])).toBe(2);
    expect(err[0]).toMatch(/^mandrel: unknown command 'frobnicate'/);
    expect(await main(["validate", "--nope"])).toBe(2);
    expect(err[1]).toBe(`mandrel validate: unknown option '--nope'\n${usageLine("validate")}`);
  });

  it("is the tools package's command, and the root scripts use it", () => {
    expect(JSON.parse(readFileSync(repoPath("tools", "package.json"), "utf-8")).bin).toEqual({ mandrel: "src/mandrel.ts" });
    const scripts = JSON.parse(readFileSync(repoPath("package.json"), "utf-8")).scripts as Record<string, string>;
    for (const name of ["dev", "build", "compile", "validate", "bspdump", "setup", "install-trenchbroom"]) expect(scripts[name]).toBe(`mandrel ${name}`);
  });

  it("runs when started through the node_modules link, as npm starts it", () => {
    // npm runs a package's command by its path under node_modules, a link to tools/; it must still run.
    const linked = repoPath("node_modules", "@mandreljs", "tools", "src", "mandrel.ts");
    expect(execFileSync(process.execPath, [linked, "help"], { encoding: "utf-8" })).toContain("Usage: mandrel <command>");
  });

  it("has help that fits a terminal", () => {
    for (const line of helpText().split("\n")) expect(line.replace(/\u001b\[\d+m/g, "").length).toBeLessThanOrEqual(100);
  });
});
