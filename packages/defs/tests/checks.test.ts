import { readdirSync } from "node:fs";
import { join } from "node:path";
import { loadSimConfig, readRepoFile, REPO_ROOT } from "@mandreljs/testing";
import { describe, expect, it } from "vitest";
import {
  crossCheck, fgdClassnames, fgdStyleChoices, gameCheck, lightStyleCheck, mapGameName, mapMarkers, resolveFgdIncludes, scenarioCheck,
  trenchbroomConfig, type DataFiles, type GameFile, type LightStylesFile, type ScenarioFile,
} from "@mandreljs/defs/checks";
import { SchemaValidator } from "@mandreljs/defs/schema";

const loadJson = (path: string): any => JSON.parse(readRepoFile(path));
/** The example game's FGD with the engine's included, as TrenchBroom reads it once install-trenchbroom links mandrel/. */
const fgd = resolveFgdIncludes(readRepoFile("example/trenchbroom/MandrelJSExample.fgd"), (path) =>
  readRepoFile(path.startsWith("mandrel/") ? `packages/defs/trenchbroom/${path.slice("mandrel/".length)}` : `example/trenchbroom/${path}`),
).text;
const realData = (): DataFiles => loadSimConfig() as unknown as DataFiles;

describe("crossCheck", () => {
  const classnames = fgdClassnames(fgd);
  const errorsAfter = (mutate: (d: any) => void): string[] => {
    const data = realData();
    mutate(data);
    return crossCheck(data, classnames);
  };

  it("passes the real data", () => {
    expect(crossCheck(realData(), classnames)).toEqual([]);
  });

  it("reads the FGD's classnames", () => {
    for (const name of ["monster_shotgunner", "info_player_start", "info_marker", "light"]) expect(classnames).toContain(name);
  });

  it("reports an unknown weapon", () => {
    expect(errorsAfter((d) => d.player.weapons.push("railgun"))).toEqual(["player.json: weapon 'railgun' is not defined in weapons.json"]);
  });

  it("reports a starting weapon the player doesn't carry", () => {
    expect(errorsAfter((d) => (d.player.weapons = d.player.weapons.filter((w: string) => w !== "pistol")))).toContain(
      "player.json: starting_weapon 'pistol' is not in the player's weapons",
    );
  });

  it("reports duplicate weapon slots", () => {
    expect(errorsAfter((d) => (d.weapons.weapons.shotgun.slot = 1))).toEqual(["weapons.json: 'shotgun' and 'pistol' both use slot 1"]);
  });

  it("reports an enemy classname the FGD doesn't define", () => {
    expect(errorsAfter((d) => (d.enemies.enemies.shotgunner.classname = "monster_ogre"))).toEqual([
      "enemies.json: 'shotgunner' classname 'monster_ogre' is not defined in the FGD",
    ]);
  });

  it("reports an inverted hull", () => {
    expect(errorsAfter((d) => (d.player.hull.maxs = [16, 16, -30]))).toEqual(["player.json: hull mins must be below maxs on every axis"]);
  });
});

describe("lightStyleCheck", () => {
  const choices = fgdStyleChoices(fgd);
  const lightstyles = (): LightStylesFile => loadJson("packages/defs/lightstyles.json");

  it("reads the FGD's style choices", () => {
    expect(choices.get(0)).toBe("Normal");
    expect(choices.get(10)).toBe("Fluorescent flicker");
    expect([...choices.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("passes the real data", () => {
    expect(lightStyleCheck(lightstyles(), choices)).toEqual([]);
  });

  it("reports a style missing from the FGD", () => {
    const data = lightstyles();
    data.styles["12"] = { name: "Sputter", pattern: "maz" };
    expect(lightStyleCheck(data, choices)).toEqual(["lightstyles.json: style 12 ('Sputter') is not a style choice in the FGD"]);
  });

  it("reports an FGD choice missing from the data", () => {
    const data = lightstyles();
    delete data.styles["11"];
    expect(lightStyleCheck(data, choices)).toEqual(["FGD: light style choice 11 ('Slow pulse, not fading to black') is not defined in lightstyles.json"]);
  });

  it("requires names to match", () => {
    const data = lightstyles();
    data.styles["4"]!.name = "Strobe";
    expect(lightStyleCheck(data, choices)).toEqual(["lightstyles.json: style 4 is named 'Strobe' but the FGD calls it 'Fast strobe'"]);
  });
});

describe("scenarios", () => {
  const DATA = realData();
  const readMap = (name: string): string | null => {
    try {
      return readRepoFile(`example/maps/${name}.map`);
    } catch {
      return null;
    }
  };
  const scenario = (name: string): ScenarioFile & Record<string, any> => loadJson(`spec/${name}.json`);
  const check = (s: ScenarioFile): string[] => scenarioCheck("test", s, DATA, readMap);
  const specValidator = new SchemaValidator((name) => loadJson(`spec/schemas/${name}`));

  it("passes every real scenario, schema and checks", () => {
    for (const file of readdirSync(join(REPO_ROOT, "spec")).filter((f) => f.endsWith(".json"))) {
      const s = scenario(file.replace(/\.json$/, ""));
      expect(specValidator.validate(s, "scenario.schema.json"), file).toEqual([]);
      expect(scenarioCheck(file, s, DATA, readMap), file).toEqual([]);
    }
  });

  it.each([
    [(s: any) => (s.inputs[0].forward = 128), "$.inputs[0].forward: 128 is above the maximum 127"],
    [(s: any) => (s.status = "done"), "$.status: 'done' is not one of ['unverified', 'verified']"],
    [(s: any) => (s.start.yaw = 360), "$.start.yaw: 360 must be less than 360"],
    [(s: any) => (s.expect[0].position = [1, 2]), "$.expect[0].position: needs at least 3 items, has 2"],
  ])("the schema catches mistake %#", (mutate, expected) => {
    const s = scenario("step_18_succeeds");
    mutate(s);
    expect(specValidator.validate(s, "scenario.schema.json")).toContain(expected);
  });

  it("reports an unknown map", () => {
    const s = scenario("step_18_succeeds");
    s.map = "no_such_map";
    expect(check(s)).toEqual(["spec/test.json: map 'no_such_map' not found (no_such_map.map)"]);
  });

  it("reports unknown markers", () => {
    const s = scenario("movement_course");
    s.start.marker = "nowhere";
    s.expect.at(-1)!.near_marker!.name = "also_nowhere";
    const errors = check(s);
    expect(errors).toContain("spec/test.json: marker 'nowhere' is not an info_marker in test_movement.map");
    expect(errors).toContain("spec/test.json: marker 'also_nowhere' is not an info_marker in test_movement.map");
  });

  it("checks segment order and the duration", () => {
    const s = scenario("movement_course");
    s.inputs[1]!.until = 4.0; // before the previous segment's 4.45
    s.duration = 8.0; // inputs run until 8.5
    s.expect.at(-1)!.at = 9.0;
    const errors = check(s);
    expect(errors).toContain("spec/test.json: inputs[1].until (4) must be after 4.45");
    expect(errors).toContain("spec/test.json: inputs run until 8.5, past the duration 8");
    expect(errors).toContain("spec/test.json: expect[1].at (9) is past the duration 8");
  });

  it("requires a tolerance on position and velocity checks", () => {
    const s = scenario("step_20_blocks");
    delete s.expect[0]!.tolerance;
    expect(check(s)).toEqual(["spec/test.json: expect[0] checks a position, velocity, or last_hit but has no tolerance"]);
  });

  it("requires weapon selections to be real slots", () => {
    const s = scenario("step_18_succeeds");
    s.inputs[0]!.weapon = 7;
    expect(check(s)).toEqual(["spec/test.json: inputs[0].weapon 7 is not a weapon slot in weapons.json"]);
  });

  it("checks scenario enemies: real types, one placement each, and markers that exist", () => {
    const s = scenario("step_18_succeeds");
    s.enemies = [
      { type: "imp", position: [0, 0, 24], yaw: 0 },
      { type: "shotgunner", yaw: 0 },
      { type: "shotgunner", marker: "nowhere", position: [0, 0, 24], yaw: 0 },
    ];
    expect(check(s)).toEqual([
      "spec/test.json: marker 'nowhere' is not an info_marker in test_movement.map",
      "spec/test.json: enemies[0].type 'imp' is not defined in enemies.json",
      "spec/test.json: enemies[1] needs exactly one of marker and position",
      "spec/test.json: enemies[2] needs exactly one of marker and position",
    ]);
  });

  it("requires enemy checks to name an enemy the scenario has, counting the map's when asked", () => {
    const s = scenario("pistol_fire_rate"); // test_combat, which has two shotgunners
    s.expect[0]!.enemy = { index: 0 };
    expect(check(s)).toEqual(["spec/test.json: expect[0].enemy.index 0 is past the scenario's 0 enemies"]);
    s.map_enemies = true;
    expect(check(s)).toEqual([]);
    s.expect[0]!.enemy = { index: 2 };
    expect(check(s)).toEqual(["spec/test.json: expect[0].enemy.index 2 is past the scenario's 2 enemies"]);
  });

  it("requires weapon checks to name real weapons", () => {
    const s = scenario("step_18_succeeds");
    s.expect[0]!.weapon = "railgun";
    expect(check(s)).toEqual(["spec/test.json: expect[0].weapon 'railgun' is not defined in weapons.json"]);
  });
});

describe("mapMarkers", () => {
  it("reads marker names and origins", () => {
    const { markers, problems } = mapMarkers(readRepoFile("example/maps/test_movement.map"), "test_movement.map");
    expect(problems).toEqual([]);
    expect(markers.get("step18_start")).toEqual([64, 144, 24]);
    expect(markers.has("finish")).toBe(true);
  });

  it("reports duplicate marker names", () => {
    const entity = '{\n"classname" "info_marker"\n"name" "here"\n"origin" "0 0 24"\n}\n';
    const { problems } = mapMarkers('{\n"classname" "worldspawn"\n}\n' + entity + entity, "dup.map");
    expect(problems).toEqual(["dup.map: marker name 'here' is used more than once"]);
  });

  it("reports a map that doesn't parse", () => {
    expect(mapMarkers("{ oops", "bad.map").problems[0]).toMatch(/^bad\.map: line 1:/);
  });
});

describe("resolveFgdIncludes", () => {
  it("puts the engine's entities in the example game's FGD", () => {
    const classnames = fgdClassnames(fgd);
    for (const name of ["worldspawn", "info_player_start", "info_marker", "light", "monster_shotgunner"]) expect(classnames).toContain(name);
    expect(fgd).not.toMatch(/^@include/m);
  });

  it("reads nested includes relative to the including file", () => {
    const files: Record<string, string> = { "a/one.fgd": '@include "two.fgd"\n@PointClass = one : ""', "a/two.fgd": "@PointClass = two : \"\"" };
    const { text, problems } = resolveFgdIncludes('@include "a/one.fgd"\r\n@PointClass = top : ""', (path) => files[path] ?? null);
    expect(problems).toEqual([]);
    expect([...fgdClassnames(text)]).toEqual(["two", "one", "top"]);
  });

  it("reports a missing file and an include loop", () => {
    expect(resolveFgdIncludes('@include "nope.fgd"', () => null).problems).toEqual(["FGD: included file 'nope.fgd' not found"]);
    expect(resolveFgdIncludes('@include "self.fgd"', () => '@include "self.fgd"').problems).toEqual(["FGD: self.fgd includes itself"]);
  });
});

describe("trenchbroomConfig", () => {
  it("reads the example game's config, comments and all", () => {
    expect(trenchbroomConfig(readRepoFile("example/trenchbroom/GameConfig.cfg"))).toEqual({ name: "Mandrel.js Example", definitions: ["MandrelJSExample.fgd"] });
  });

  it("keeps // inside strings", () => {
    const config = '{\n  // a comment\n  "name": "A // B", // another\n  "entities": { "definitions": ["a.fgd"] }\n}';
    expect(trenchbroomConfig(config).name).toBe("A // B");
  });

  it("throws on a config without a name or definitions", () => {
    expect(() => trenchbroomConfig('{ "entities": { "definitions": [] } }')).toThrow(/no name/);
    expect(() => trenchbroomConfig('{ "name": "X" }')).toThrow(/no entity definitions/);
  });
});

describe("gameCheck", () => {
  const game = (): GameFile => loadJson("example/data/game.json");
  const maps = (): Map<string, string> =>
    new Map(readdirSync(join(REPO_ROOT, "example", "maps")).filter((f) => f.endsWith(".map")).map((f) => [f.replace(/\.map$/, ""), readRepoFile(`example/maps/${f}`)]));
  const configName = trenchbroomConfig(readRepoFile("example/trenchbroom/GameConfig.cfg")).name;

  it("passes the example game", () => {
    expect(gameCheck(game(), configName, maps())).toEqual([]);
  });

  it("reads a map's game from its header", () => {
    expect(mapGameName("// Game: Some Game\n// Format: Quake2 (Valve)\n{")).toBe("Some Game");
    expect(mapGameName("// Format: Quake2 (Valve)\r\n// Game: Some Game\r\n{")).toBe("Some Game");
    expect(mapGameName('{\n"classname" "worldspawn"\n// Game: Too Late\n}')).toBeNull();
  });

  it("reports a config, map, or start map that doesn't match the game", () => {
    const all = maps();
    all.set("stray", "// Game: Quake 2\n{\n}");
    all.set("bare", "{\n}");
    expect(gameCheck({ ...game(), start_map: "e1m1" }, "Mandrel.js", all)).toEqual([
      "trenchbroom/GameConfig.cfg: name 'Mandrel.js' is not the game's name, 'Mandrel.js Example' (data/game.json)",
      "maps/stray.map: says // Game: Quake 2, but the game is 'Mandrel.js Example'",
      "maps/bare.map: has no // Game: line, but the game is 'Mandrel.js Example'",
      "data/game.json: start_map 'e1m1' not found (maps/e1m1.map)",
    ]);
  });
});
