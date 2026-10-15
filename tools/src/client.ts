// The game client, for the tools that serve or ship it: its source (served by
// Vite inside this repo) and its build (served without Vite, and shipped).

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { repoPath } from "./layout.ts";

/** The game client's source. */
export const CLIENT_SOURCE = repoPath("apps", "game-client");
/** The built client, from npm run build. */
export const CLIENT_BUILD = join(CLIENT_SOURCE, "dist");

/** True if a folder holds a built client. */
export const isBuiltClient = (dir: string): boolean => existsSync(join(dir, "index.html"));

/** Vite's command-line script when the client's source and Vite are both here (this repo), or null (an installed engine). */
export function viteScript(): string | null {
  if (!existsSync(join(CLIENT_SOURCE, "index.html"))) return null;
  try {
    const pkg = createRequire(import.meta.url).resolve("vite/package.json");
    return join(dirname(pkg), "bin", "vite.js");
  } catch {
    return null;
  }
}

/** Builds the client from source into CLIENT_BUILD with Vite. Resolves to null when it's built, or to Vite's output when it fails. */
export function buildClient(vite: string): Promise<string | null> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [vite, "build", "--logLevel", "warn"], { cwd: CLIENT_SOURCE, env: { ...process.env, NO_COLOR: "1" } });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", (error) => done(`could not start Vite: ${error.message}`));
    child.on("exit", (code) => done(code === 0 ? null : output.trim() || `Vite exited with ${code}`));
  });
}
