import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ericwTool, exeName, loadVersions, platformKey, SetupError, verifyEricw } from "@mandreljs/toolchain/setup";

describe("setup", () => {
  it("knows this platform and its executable names", () => {
    expect(["windows", "linux", "macos"]).toContain(platformKey());
    expect(exeName("qbsp")).toBe(process.platform === "win32" ? "qbsp.exe" : "qbsp");
  });

  it("reads the pins and places the tools by version", () => {
    const versions = loadVersions();
    const pin = versions["ericw-tools"];
    expect(pin.version).toMatch(/^\d/);
    for (const platform of ["windows", "linux", "macos"]) expect(pin.platforms[platform]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ericwTool("qbsp", versions)).toContain(join(".tools", "ericw-tools", pin.version));
  });

  it("reports an incomplete install", () => {
    const dir = mkdtempSync(join(tmpdir(), "mandrel-setup-"));
    try {
      expect(() => verifyEricw(dir, "1.0")).toThrow(SetupError);
      expect(() => verifyEricw(dir, "1.0")).toThrow(/missing: qbsp, light/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
