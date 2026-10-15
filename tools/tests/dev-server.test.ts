// The plain dev server, end to end on a random port, with a stand-in client and
// a copy of the example game (so compiling on request never writes into the repo).

import { cpSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { folderGames, gameName, singleGame, startServer } from "../src/dev-server.ts";
import { EXAMPLE_GAME, REPO_ROOT } from "../src/layout.ts";
import { toolsInstalled } from "../src/setup.ts";
import { splitOptions } from "../src/dev.ts";

describe("dev server", () => {
  let dir = "";
  let game = "";
  let server: Server;
  let url = "";

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "mandreljs-dev-"));
    game = join(dir, "mygame");
    for (const folder of ["data", "textures"]) cpSync(join(EXAMPLE_GAME, folder), join(game, folder), { recursive: true });
    mkdirSync(join(game, "maps"));
    cpSync(join(EXAMPLE_GAME, "maps", "test_movement.map"), join(game, "maps", "test_movement.map"));
    const client = join(dir, "client");
    mkdirSync(join(client, "assets"), { recursive: true });
    writeFileSync(join(client, "index.html"), "<!doctype html><title>client</title>");
    writeFileSync(join(client, "assets", "main.js"), "console.log('client');");
    ({ server, url } = await startServer({ clientDir: client, games: singleGame(game), port: 0, host: "localhost", log: () => {} }));
  });
  afterAll(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const get = (path: string): Promise<Response> => fetch(new URL(path, url));

  it("serves the built client", async () => {
    const page = await get("/");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await (await get("/assets/main.js")).text()).toContain("client");
  });

  it("names the game to play in /games/index.json", async () => {
    expect(await (await get("/games/index.json")).json()).toEqual({ default: "mygame", games: ["mygame"] });
  });

  it("serves the game's files", async () => {
    const info = await (await get("/games/mygame/data/game.json")).json();
    expect(info.name).toBe("Mandrel.js Example");
    expect((await get("/games/mygame/textures/dev/grid_grey.png")).headers.get("content-type")).toBe("image/png");
    expect((await get("/games/mygame/maps/test_movement.map")).status).toBe(200);
  });

  it("serves nothing outside the client and the game", async () => {
    for (const path of ["/games/other/data/game.json", "/games/mygame/secret.txt", "/games/mygame/data/../../client/index.html", "/games/mygame/data/%2e%2e%2f%2e%2e%2fclient%2findex.html", "/nope.html"]) {
      expect((await get(path)).status, path).toBe(404);
    }
  });

  it.skipIf(!toolsInstalled())("compiles a map the first time it's asked for, and again after it's saved (needs ericw-tools)", async () => {
    const first = await get("/games/mygame/build/test_movement.bsp");
    expect(first.status).toBe(200);
    expect(new Uint8Array(await first.arrayBuffer()).slice(0, 4)).toEqual(new TextEncoder().encode("IBSP"));
    const later = new Date(Date.now() + 5000);
    utimesSync(join(game, "maps", "test_movement.map"), later, later); // as if saved in TrenchBroom
    expect((await get("/games/mygame/build/test_movement.bsp")).status).toBe(200);
  }, 30_000);

  it("reports a map that won't compile (or that it can't compile without ericw-tools)", async () => {
    writeFileSync(join(game, "maps", "broken.map"), "this is not a map");
    const response = await get("/games/mygame/build/broken.bsp");
    expect(response.status).toBe(422);
    expect(await response.text()).not.toBe("");
  }, 30_000);
});

describe("games", () => {
  it("offers every game in the repo, plus the chosen one, which is the default", () => {
    const outside = join(tmpdir(), "elsewhere", "mygame");
    const games = folderGames(REPO_ROOT, outside);
    expect(games.defaultName).toBe("mygame");
    expect(games.list().get("example")).toBe(EXAMPLE_GAME);
    expect(games.list().get("mygame")).toBe(outside);
    expect(games.list().has("packages")).toBe(false);
  });

  it("names a game from its data/game.json", () => {
    expect(gameName(EXAMPLE_GAME)).toBe("Mandrel.js Example");
  });
});

describe("dev options", () => {
  it("takes --game and --built for itself and passes the rest on", () => {
    expect(splitOptions(["--game", "mygame", "--port", "5199", "--built"])).toEqual({ game: "mygame", built: true, rest: ["--port", "5199"] });
    expect(splitOptions(["--game=../x", "--open"])).toEqual({ game: "../x", built: false, rest: ["--open"] });
  });
});
