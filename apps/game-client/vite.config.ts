import { gameFiles } from "@mandreljs/tools/dev-server";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [gameFiles()],
});
