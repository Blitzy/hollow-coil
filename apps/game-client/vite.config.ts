import { gameFiles } from "@mandreljs/tools/dev-server";
import { thirdPartyNotices } from "@mandreljs/tools/notices";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths, so a release (mandrel build) works wherever it's hosted, even in a subfolder.
  base: "./",
  plugins: [gameFiles(), thirdPartyNotices("the Mandrel.js game client")],
});
