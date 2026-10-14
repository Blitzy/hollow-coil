import { afterEach, describe, expect, it, vi } from "vitest";
import { main, readRepoMap } from "../src/validate.ts";

describe("validate", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes the repo's data and scenarios, printing a line per file", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));
    expect(main()).toBe(0);
    expect(lines).toContain("ok    data/player.json");
    expect(lines).toContain("ok    spec/step_18_succeeds.json");
    expect(lines.at(-1)).toBe("ok    cross-file checks");
  });

  it("reads maps from the repo, or null for a missing one", () => {
    expect(readRepoMap("test_movement")).toContain("worldspawn");
    expect(readRepoMap("no_such_map")).toBeNull();
  });
});
