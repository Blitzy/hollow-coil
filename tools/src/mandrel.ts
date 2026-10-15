#!/usr/bin/env node
// The mandrel command: one entry point for the tools that work on a game.
// Run in a game directory (a folder holding data/game.json), or pass --game;
// inside this repo the example game is the default. Each command is a tool in
// this folder, loaded only when it's run.
//
// Usage: mandrel <command> [options]   (mandrel help lists the commands)

import { styleText } from "node:util";
import { isMain } from "./cli.ts";
import { GameNotFoundError } from "./layout.ts";

interface Command {
  /** Arguments after the command name, for help. */
  readonly usage: string;
  readonly summary: string;
  readonly run: (argv: string[]) => Promise<number>;
}

const COMMANDS: Record<string, Command> = {
  dev: {
    usage: "[--game dir] [--port n] [--host name] [--built]",
    summary: "Play in the browser, compiling maps as you save them",
    run: async (argv) => (await import("./dev.ts")).main(argv),
  },
  compile: {
    usage: "[map ...] [--mode check|release] [--game dir]",
    summary: "Compile maps into the game's build/ folder",
    run: async (argv) => (await import("./compile.ts")).main(argv),
  },
  validate: {
    usage: "[--game dir]",
    summary: "Check the game's data and TrenchBroom setup against the engine's definitions",
    run: async (argv) => (await import("./validate.ts")).main(argv),
  },
  bspdump: {
    usage: "<file.bsp> [--no-entities]",
    summary: "Print a compiled map's contents as JSON",
    run: async (argv) => (await import("./bspdump.ts")).main(argv),
  },
  setup: {
    usage: "[tool ...] [--check | --force]",
    summary: "Install the pinned map compiler (ericw-tools)",
    run: async (argv) => (await import("./setup.ts")).main(argv),
  },
  "install-trenchbroom": {
    usage: "[--game dir] [--uninstall]",
    summary: "Link the game's config into TrenchBroom",
    run: async (argv) => (await import("./install-trenchbroom.ts")).main(argv),
  },
};

const HELP_FLAGS = new Set(["help", "--help", "-h"]);

/** The list of commands, for mandrel help. */
export function helpText(): string {
  const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length));
  return [
    "Usage: mandrel <command> [options]",
    "",
    "Run in a game directory (a folder holding data/game.json), or pass --game <dir>.",
    "",
    "Commands:",
    ...Object.entries(COMMANDS).map(([name, command]) => `  ${styleText("bold", name.padEnd(width))}  ${command.summary}`),
    "",
    "mandrel <command> --help shows a command's options.",
  ].join("\n");
}

/** One command's usage line, for mandrel <command> --help and option errors. */
export const usageLine = (name: string): string => `Usage: mandrel ${name} ${COMMANDS[name]!.usage}`;

/** Node's errors for options a command doesn't take, or values it's missing. */
const isOptionError = (error: unknown): error is Error => {
  const code = error instanceof Error ? (error as Error & { code?: unknown }).code : undefined;
  return typeof code === "string" && code.startsWith("ERR_PARSE_ARGS");
};

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [name, ...rest] = argv;
  if (name === undefined || HELP_FLAGS.has(name)) {
    console.log(helpText());
    return name === undefined ? 2 : 0;
  }
  const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name]! : undefined;
  if (command === undefined) {
    console.error(`mandrel: unknown command '${name}'\n\n${helpText()}`);
    return 2;
  }
  if (rest.some((arg) => arg === "--help" || arg === "-h")) {
    const note = name === "dev" ? "\n\nInside the engine's repo, other options go to Vite, such as --open." : "";
    console.log(`${usageLine(name)}\n\n${command.summary}.${note}`);
    return 0;
  }
  try {
    return await command.run(rest);
  } catch (error) {
    if (error instanceof GameNotFoundError) {
      console.error(`mandrel ${name}: ${error.message}`);
      return 1;
    }
    if (!isOptionError(error)) throw error;
    // Node's message goes on to explain '--'; the first sentence is the useful part.
    const problem = error.message.split(/\.\s/)[0]!.replace(/^\w/, (c) => c.toLowerCase());
    console.error(`mandrel ${name}: ${problem}\n${usageLine(name)}`);
    return 2;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main();
