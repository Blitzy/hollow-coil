import { describe, expect, it } from "vitest";
import { clientCommands, type Client } from "../../src/game/client-commands.ts";
import { Console } from "../../src/game/console.ts";

/** A console with the client commands, acting on a client that records what it's asked to do. */
function setup(maps: readonly string[] = ["greybox_01", "test_combat", "test_movement"]): { con: Console; done: string[] } {
  const con = new Console();
  const done: string[] = [];
  const client: Client = {
    map: "greybox_01",
    maps,
    loadMap: async (name) => void done.push(`load ${name}`),
    restart: () => void done.push("restart"),
    record: (name) => void done.push(`record ${name}`),
    stop: () => void done.push("stop"),
  };
  con.register(...clientCommands(client, con));
  return { con, done };
}

const texts = (con: Console): string[] => con.lines.map((line) => line.text);

describe("client commands", () => {
  it("loads a map the game has", async () => {
    const { con, done } = setup();
    await con.run("map test_combat");
    expect(done).toEqual(["load test_combat"]);
  });

  it("says how to use map, and which maps there are when it isn't one", async () => {
    const { con, done } = setup();
    await con.run("map");
    await con.run("map e1m1");
    expect(done).toEqual([]);
    expect(con.lines).toEqual([
      { text: "map <name>: loads a map (playing greybox_01; maps lists them)", warning: false },
      { text: 'no map "e1m1" in this game (maps lists them)', warning: true },
    ]);
  });

  it("loads any map name when the server doesn't list the maps, but never a path", async () => {
    const { con, done } = setup([]);
    await con.run("map anything");
    await con.run("map ../secret");
    expect(done).toEqual(["load anything"]);
    expect(texts(con)).toEqual(['no map "../secret" in this game (maps lists them)']);
  });

  it("completes map names", () => {
    const { con } = setup();
    con.type("map test_m");
    con.key({ key: "Tab" });
    expect(con.input).toBe("map test_movement ");
  });

  it("lists the maps, marking the one being played", async () => {
    const { con } = setup();
    await con.run("maps");
    expect(texts(con)).toEqual(["  greybox_01  (playing)", "  test_combat", "  test_movement"]);
    const unlisted = setup([]).con;
    await unlisted.run("maps");
    expect(texts(unlisted)).toEqual(["this server doesn't list the game's maps (playing greybox_01)"]);
  });

  it("records under a name, or the map and time, and stops", async () => {
    const { con, done } = setup();
    await con.run("record");
    await con.run("record fight.demo.json");
    await con.run("stop");
    expect(done).toEqual(["record null", "record fight", "stop"]);
  });

  it("only records under a name that's safe for a file", async () => {
    const { con, done } = setup();
    await con.run("record ../oops");
    await con.run("record two words");
    expect(done).toEqual([]);
    expect(texts(con)).toEqual(["a demo's name can only have letters, digits, - and _", "record [name]: starts the level over and records a demo, until stop"]);
  });

  it("starts the level over", async () => {
    const { con, done } = setup();
    await con.run("restart");
    expect(done).toEqual(["restart"]);
  });
});
