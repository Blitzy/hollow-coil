// Builds the mandreljs package, what a game's repo installs to get the mandreljs
// command, in dist/mandreljs/, and packs it into dist/mandreljs-<version>.tgz
// with npm pack. Repo-only; the package's contents come from this repo:
//
//   bin/mandreljs.js (+ .map)   the command, bundled into one JavaScript file with Vite,
//                             with engine-files.package.ts in place of engine-files.ts
//   client/                   the built game client, with THIRD-PARTY-NOTICES.txt
//   defs/                     schemas, light styles, and trenchbroom/mandreljs.fgd
//   versions.json             pinned third-party tool versions
//   README.md, LICENSE, LICENSE-EXCEPTION.md, package.json
//
// Node refuses to run TypeScript from node_modules, so the package ships
// JavaScript; the bundle also folds in our own packages, so it has no
// dependencies. See DECISIONS.md, "Games use the engine through one installed command".
//
// Usage: node tools/src/package.ts   (or npm run package)

import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "vite";
import { isMain } from "./cli.ts";
import { buildClient, CLIENT_BUILD, viteScript } from "./client.ts";
import { DEFS_DIR, displayPath, repoPath } from "./layout.ts";
import { VERSIONS_FILE } from "./setup.ts";

/** Where the package is assembled. */
export const PACKAGE_DIR = repoPath("dist", "mandreljs");

/** The package's package.json, with the version and repository of this repo's root package.json. */
export function packageJson(version: string, repository?: unknown): Record<string, unknown> {
  return {
    name: "mandreljs",
    version,
    ...(repository === undefined ? {} : { repository }),
    description: "A web engine for first-person shooters in the spirit of Doom and Quake: the mandreljs command, which plays, checks, compiles, and builds a game directory.",
    type: "module",
    bin: { mandreljs: "bin/mandreljs.js" },
    engines: { node: ">=24" },
    license: "GPL-3.0-or-later",
    keywords: ["game-engine", "fps", "quake", "trenchbroom", "threejs"],
  };
}

/** Bundles the mandreljs command into one file, with the package's engine-files module. */
async function bundle(out: string): Promise<void> {
  await build({
    configFile: false,
    logLevel: "warn",
    resolve: {
      alias: [{ find: /^\.\/engine-files\.ts$/, replacement: repoPath("tools", "src", "engine-files.package.ts") }],
    },
    // Bundle our own packages too; only Node's built-in modules stay imports.
    ssr: { noExternal: true },
    build: {
      ssr: repoPath("tools", "src", "mandreljs.ts"),
      outDir: join(out, "bin"),
      emptyOutDir: true,
      target: "node24",
      minify: false,
      sourcemap: true,
      rolldownOptions: { output: { entryFileNames: "mandreljs.js", codeSplitting: false } },
    },
  });
}

export async function main(): Promise<number> {
  const { version, repository } = JSON.parse(readFileSync(repoPath("package.json"), "utf-8")) as { version: string; repository?: unknown };
  const out = PACKAGE_DIR;
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const vite = viteScript();
  if (vite === null) throw new Error("the client's source and Vite are needed to build the package");
  const failure = await buildClient(vite);
  if (failure !== null) {
    console.log(`FAIL  client\n${failure}`);
    return 1;
  }
  cpSync(CLIENT_BUILD, join(out, "client"), { recursive: true });
  console.log("ok    client");

  await bundle(out);
  console.log("ok    bin/mandreljs.js");

  mkdirSync(join(out, "defs", "trenchbroom"), { recursive: true });
  cpSync(join(DEFS_DIR, "schemas"), join(out, "defs", "schemas"), { recursive: true });
  cpSync(join(DEFS_DIR, "lightstyles.json"), join(out, "defs", "lightstyles.json"));
  cpSync(join(DEFS_DIR, "trenchbroom", "mandreljs.fgd"), join(out, "defs", "trenchbroom", "mandreljs.fgd"));
  cpSync(VERSIONS_FILE, join(out, "versions.json"));
  for (const file of ["LICENSE", "LICENSE-EXCEPTION.md"]) cpSync(repoPath(file), join(out, file));
  cpSync(repoPath("tools", "package-readme.md"), join(out, "README.md"));
  writeFileSync(join(out, "package.json"), `${JSON.stringify(packageJson(version, repository), null, 2)}\n`);
  console.log("ok    defs, versions.json, licenses, README.md, package.json");
  console.log(`\nmandreljs ${version} is in ${displayPath(out)}/`);

  const tgz = execSync("npm pack --pack-destination ..", { cwd: out, encoding: "utf-8" }).trim().split("\n").at(-1)!;
  console.log(`packed: ${displayPath(join(out, "..", tgz))}`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = await main();
