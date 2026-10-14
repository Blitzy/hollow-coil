import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/setup.ts";

describe("setup", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects unknown tools and conflicting options", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await main(["nope"])).toBe(2);
    expect(await main(["--check", "--force"])).toBe(2);
  });
});
