import { gameFiles } from "@mandreljs/dev-server";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [gameFiles()],
});
