// Plays the game in the browser, compiling maps as you save them. From this
// repo's source it runs Vite on apps/game-client, whose dev-server plugin
// serves the repo's game directories (see dev-server.ts). Vite's options pass
// through, such as --port 5199.
//
// Usage: node tools/src/dev.ts [vite options]   (or mandrel dev, npm run dev)

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { isMain } from "./cli.ts";
import { repoPath } from "./layout.ts";

/** The game client, which Vite serves from source. */
const CLIENT = repoPath("apps", "game-client");

/** Vite's command-line script, from the installed vite package. */
function viteScript(): string {
  const pkg = createRequire(import.meta.url).resolve("vite/package.json");
  return join(dirname(pkg), "bin", "vite.js");
}

export function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  return new Promise((done) => {
    const vite = spawn(process.execPath, [viteScript(), ...argv], { cwd: CLIENT, stdio: "inherit" });
    vite.on("error", (error) => {
      console.error(`dev: could not start Vite: ${error.message}`);
      done(1);
    });
    vite.on("exit", (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
}

if (isMain(import.meta.url)) process.exitCode = await main();
