import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { defineConfig, type Plugin } from "vite";

const REPO_ROOT = join(import.meta.dirname, "..");
const SHARED = ["maps", "textures", "data"]; // repo folders the game reads at /game/<folder>/...
const TYPES: Record<string, string> = {
  ".map": "text/plain; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".bsp": "application/octet-stream",
};

/** Serves the shared repo folders in dev, so the game loads the same files the tools and Godot use. */
function sharedGameFiles(): Plugin {
  return {
    name: "hollow-coil-shared-files",
    configureServer(server) {
      server.middlewares.use("/game", (req, res, next) => {
        const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]!)).replace(/^[\\/]+/, "");
        const folder = path.split(sep)[0]!;
        if (!SHARED.includes(folder) || path.split(sep).includes("..")) return next();
        const file = join(REPO_ROOT, path);
        try {
          if (!statSync(file).isFile()) return next();
        } catch {
          res.statusCode = 404;
          return res.end("not found");
        }
        res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
        res.setHeader("Cache-Control", "no-store"); // always serve the latest map save
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [sharedGameFiles()],
});
