// Tests the mandreljs package as a game's repo uses it: packs it, installs it
// into a scratch folder holding a copy of the example game (outside this repo,
// so nothing can come from the repo by accident), and runs the mandreljs command
// there: setup --check, validate, compile, build, and dev, with requests for the
// page, the game's index, and a compiled map. Repo-only; runs in CI after the
// compile check, and needs ericw-tools installed (npm run setup).
//
// Usage: node tools/src/test-package.ts [--keep]   (or npm run test:package)
//   --keep   leave the scratch folder in place, and print where it is

import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { parseArgs, stripVTControlCharacters, styleText } from "node:util";
import { isMain } from "./cli.ts";
import { EXAMPLE_GAME, repoPath } from "./layout.ts";
import { main as buildPackage } from "./package.ts";

/** What a game's repo holds: the example's content and license, without links, such as the FGD link install-trenchbroom makes. */
function copyGame(game: string): void {
  for (const folder of ["data", "maps", "textures", "trenchbroom"]) {
    cpSync(join(EXAMPLE_GAME, folder), join(game, folder), { recursive: true, filter: (src) => !lstatSync(src).isSymbolicLink() });
  }
  cpSync(join(EXAMPLE_GAME, "LICENSE.md"), join(game, "LICENSE.md"));
}

/**
 * The environment without what npm run and the package build add: npm_* settings, which point npm back at this repo;
 * NODE_ENV=production from Vite, which makes npm skip devDependencies; and the
 * node_modules/.bin folders on PATH, where this repo's own mandreljs command is.
 */
function outsideEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(npm_|init_cwd$|node_env$)/i.test(key)) continue;
    env[key] = /^path$/i.test(key) ? value?.split(delimiter).filter((dir) => !/node_modules[\\/]\.bin|node-gyp-bin/.test(dir)).join(delimiter) : value;
  }
  return env;
}

/** Runs a command in the game folder, showing its output, and throws if it fails. Through a shell, as a person types it (with npx --no, so npx never fetches mandreljs from the registry in place of this build). */
function run(game: string, command: string): void {
  console.log(`\n${styleText("bold", `$ ${command}`)}`);
  const result = spawnSync(command, { cwd: game, env: outsideEnv(), shell: true, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status ?? result.signal})`);
}

function expectFiles(dir: string, files: readonly string[]): void {
  const missing = files.filter((file) => !existsSync(join(dir, file)));
  if (missing.length > 0) throw new Error(`missing from ${dir}: ${missing.join(", ")}`);
}

/** Starts mandreljs dev on a free port, requests what the client loads first, and stops it. */
async function checkDev(game: string): Promise<void> {
  console.log(`\n${styleText("bold", "$ mandreljs dev --port 0")}`);
  // Node runs the installed command directly, so stopping it stops the server (a shell would leave it running on Windows).
  const server = spawn(process.execPath, [join(game, "node_modules", "mandreljs", "bin", "mandreljs.js"), "dev", "--port", "0"], { cwd: game, env: outsideEnv() });
  try {
    const url = await new Promise<string>((found, fail) => {
      let output = "";
      server.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
      server.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        const match = /play\s+(http:\/\/\S+)/.exec(stripVTControlCharacters(output));
        if (match !== null) found(match[1]!);
      });
      server.on("exit", (code) => fail(new Error(`mandreljs dev exited (${code}) before serving:\n${output}`)));
    });
    for (const [path, expected] of [
      ["", "<!doctype html>"],
      ["games/index.json", '"default":"mygame"'],
      ["games/mygame/data/game.json", '"start_map"'],
      ["games/mygame/build/test_movement.bsp", "IBSP"],
    ] as const) {
      const response = await fetch(new URL(path, url));
      const body = (await response.text()).slice(0, 2000).replaceAll(/\s+/g, "");
      if (!response.ok || !body.toLowerCase().includes(expected.replaceAll(" ", "").toLowerCase())) {
        throw new Error(`GET /${path}: ${response.status}, expected it to contain ${expected}`);
      }
      console.log(`ok    GET /${path}`);
    }
  } finally {
    const stopped = new Promise((done) => server.once("exit", done));
    server.kill();
    await stopped;
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { keep: { type: "boolean" } } });
  if ((await buildPackage(["--pack"])) !== 0) return 1;
  const { version } = JSON.parse(readFileSync(repoPath("package.json"), "utf-8")) as { version: string };
  const tgz = repoPath("dist", `mandreljs-${version}.tgz`);

  const scratch = mkdtempSync(join(tmpdir(), "mandreljs-package-"));
  const game = join(scratch, "mygame");
  try {
    copyGame(game);
    writeFileSync(join(game, "package.json"), `${JSON.stringify({ private: true, devDependencies: { mandreljs: `file:${tgz}` } }, null, 2)}\n`);
    run(game, "npm install --no-audit --no-fund");
    // Else npx would run another mandreljs, such as one in its cache, and this build would go untested.
    expectFiles(game, ["node_modules/mandreljs/bin/mandreljs.js"]);
    run(game, "npx --no mandreljs setup --check");
    run(game, "npx --no mandreljs validate");
    run(game, "npx --no mandreljs compile --mode check");
    run(game, "npx --no mandreljs build --mode check");
    const release = join(game, "dist");
    expectFiles(release, ["index.html", "THIRD-PARTY-NOTICES.txt", "LICENSE", "LICENSE-EXCEPTION.md", "NOTICE.md", "games/index.json", "games/mygame/LICENSE.md", "games/mygame/data/game.json"]);
    const maps = readdirSync(join(game, "maps")).filter((file) => file.endsWith(".map"));
    expectFiles(join(release, "games", "mygame", "build"), maps.map((map) => map.replace(/\.map$/, ".bsp")));
    console.log(`ok    the release has the client, notices, data, and ${maps.length} maps`);
    await checkDev(game);
  } catch (error) {
    console.log(`\n${styleText("red", "FAIL")}  ${(error as Error).message}`);
    if (values.keep) console.log(`kept: ${game}`);
    return 1;
  } finally {
    if (!values.keep) rmSync(scratch, { recursive: true, force: true });
  }
  console.log(`\nThe installed package works.${values.keep ? ` Kept: ${game}` : ""}`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = await main();
