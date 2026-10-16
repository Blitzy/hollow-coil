import { gameFiles } from "@mandreljs/tools/dev-server";
import { thirdPartyNotices } from "@mandreljs/tools/notices";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8")) as { version: string };

export default defineConfig({
  // Relative asset paths, so a release (mandreljs build) works wherever it's hosted, even in a subfolder.
  base: "./",
  plugins: [gameFiles(), thirdPartyNotices("the Mandrel.js game client")],
  // The engine's version, which demos record (see src/env.d.ts).
  define: { __MANDRELJS_VERSION__: JSON.stringify(version) },
});
