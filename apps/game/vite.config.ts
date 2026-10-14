import { gameFiles } from "@hollow-coil/dev-server";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [gameFiles()],
});
