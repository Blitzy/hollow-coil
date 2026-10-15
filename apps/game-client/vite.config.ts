import { gameFiles } from "@mandreljs/tools/dev-server";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths, so a release (mandrel build) works wherever it's hosted, even in a subfolder.
  base: "./",
  plugins: [gameFiles()],
});
