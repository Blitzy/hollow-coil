import { describe, expect, it } from "vitest";
import { failureLine, levelProblem, levelUrl } from "../../src/game/level-files.ts";

/** A fetch that answers every request with this response (or throws), recording the URLs asked for. */
function fakeFetch(answer: () => Response): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchFile = (async (url: string | URL | Request) => {
    urls.push(String(url));
    return answer();
  }) as typeof fetch;
  return { fetch: fetchFile, urls };
}

describe("levelUrl", () => {
  it("finds the compiled .bsp under build/ and the .map source under maps/", () => {
    expect(levelUrl("games/example", "greybox_01", "bsp")).toBe("games/example/build/greybox_01.bsp");
    expect(levelUrl("games/example", "greybox_01", "map")).toBe("games/example/maps/greybox_01.map");
  });
});

describe("failureLine", () => {
  it("picks the line of a compile report that says why", () => {
    expect(failureLine("compiling greybox_01\n  FAIL  greybox_01  leak\n1 failed", { status: 422, statusText: "" })).toBe("FAIL  greybox_01  leak");
  });

  it("falls back to the status", () => {
    expect(failureLine("nothing useful", { status: 500, statusText: "Internal Server Error" })).toBe("500 Internal Server Error");
  });
});

describe("levelProblem", () => {
  it("is null for a level file that loads, asking for the file the demo was recorded on", async () => {
    const lit = fakeFetch(() => new Response("bsp bytes"));
    expect(await levelProblem("games/example", "greybox_01", "bsp", lit.fetch)).toBeNull();
    expect(lit.urls).toEqual(["games/example/build/greybox_01.bsp"]);
    const unlit = fakeFetch(() => new Response("map text"));
    expect(await levelProblem("games/example", "greybox_01", "map", unlit.fetch)).toBeNull();
    expect(unlit.urls).toEqual(["games/example/maps/greybox_01.map"]);
  });

  it("says when the game has no such map", async () => {
    const { fetch } = fakeFetch(() => new Response("not found", { status: 404 }));
    expect(await levelProblem("games/example", "no_such_map", "bsp", fetch)).toBe("this game has no no_such_map.bsp");
  });

  it("says why a map didn't compile", async () => {
    const { fetch } = fakeFetch(() => new Response("ericw-tools is not installed; run: mandreljs setup", { status: 422 }));
    expect(await levelProblem("games/example", "greybox_01", "bsp", fetch)).toBe("greybox_01.bsp didn't load: ericw-tools is not installed; run: mandreljs setup");
  });

  it("says when the request fails", async () => {
    const { fetch } = fakeFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    expect(await levelProblem("games/example", "greybox_01", "map", fetch)).toBe("greybox_01.map didn't load: Failed to fetch");
  });
});
