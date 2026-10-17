// The console's client commands: they act on the session (which map is loaded,
// starting over, recording a demo), outside the sim. What they check and say is
// here; what they do is the Client's, which main.ts gives them.

import type { Console, ConsoleCommand } from "./console.ts";

/** What the client commands act on. */
export interface Client {
  /** The map being played. */
  readonly map: string;
  /** The game's maps, from the server's games/index.json, or empty when it doesn't list them. */
  readonly maps: readonly string[];
  /** Loads a map in place of the one being played. */
  loadMap(name: string): Promise<void>;
  /** Starts the level over (leaving a demo being watched). */
  restart(): void;
  /** Starts the level over and records a demo, to save as name.demo.json, or named after the map and the time. */
  record(name: string | null): void;
  /** Stops recording and saves the demo. */
  stop(): void;
}

const MAP_NAME = /^[\w-]+$/;
const DEMO_SUFFIX = /\.demo\.json$/;

export function clientCommands(client: Client, con: Console): ConsoleCommand[] {
  return [
    {
      name: "map",
      usage: "<name>",
      help: "loads a map",
      run: async ([name, ...extra]) => {
        if (name === undefined || extra.length > 0) return con.print(`map <name>: loads a map (playing ${client.map}; maps lists them)`);
        const known = client.maps.length > 0 ? client.maps.includes(name) : MAP_NAME.test(name);
        if (!known) return con.warn(`no map "${name}" in this game (maps lists them)`);
        await client.loadMap(name);
      },
      complete: (index) => (index === 0 ? client.maps : []),
    },
    {
      name: "maps",
      help: "lists the game's maps",
      run: () => {
        if (client.maps.length === 0) return con.print(`this server doesn't list the game's maps (playing ${client.map})`);
        con.print(client.maps.map((name) => (name === client.map ? `  ${name}  (playing)` : `  ${name}`)).join("\n"));
      },
    },
    { name: "restart", help: "starts the level over", run: () => client.restart() },
    {
      name: "record",
      usage: "[name]",
      help: "starts the level over and records a demo, until stop",
      run: ([name, ...extra]) => {
        if (extra.length > 0) return con.print("record [name]: starts the level over and records a demo, until stop");
        const file = name?.replace(DEMO_SUFFIX, "");
        if (file !== undefined && !MAP_NAME.test(file)) return con.warn(`a demo's name can only have letters, digits, - and _`);
        client.record(file ?? null);
      },
    },
    { name: "stop", help: "stops recording and saves the demo", run: () => client.stop() },
  ];
}
