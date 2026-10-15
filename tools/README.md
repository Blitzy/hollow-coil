# tools

Developer tools: they run in Node during development and never ship to players. Engine code (`packages/`) never imports them; `tests/engine-imports.test.ts` checks.

Command-line tools, each run from the repo root with `npm run <name>`. The ones that work on a game also run on a game directory anywhere else, run from inside it:

- `src/mandrel.ts`: the `mandrel` command (this package's `bin`), which runs the game tools below as subcommands: `mandrel compile`, `mandrel validate`, and so on. The npm scripts call it.
- `src/dev.ts`: plays the game in the browser, running Vite on `apps/game-client` with the dev server plugin.
- `src/setup.ts`: installs the pinned third-party tools (ericw-tools) into a per-user cache shared by every game. Versions and checksums are in `versions.json`.
- `src/compile.ts`: compiles a game's maps into its `build/` folder with qbsp and light, failing on leaks, missing textures, and compiler errors.
- `src/validate.ts`: checks a game's data, the engine's light styles, and the scenarios, using `@mandreljs/defs`.
- `src/bspdump.ts`: prints a compiled `.bsp`'s contents as JSON.
- `src/install-trenchbroom.ts`: links a game's TrenchBroom config into TrenchBroom.
- `src/make-placeholder-textures.ts`: regenerates the example game's placeholder textures.
- `src/check-files.ts`: fails if any tracked file is over 2 MB.

Used by other code:

- `src/dev-server.ts`: the Vite plugin each app's `vite.config.ts` uses in development. It serves game directories at `/games/<game>/` and compiles stale maps when the page asks for them.
- `src/testing.ts` and `src/level-parity.ts`: helpers for tests: reading repo files, the example game's data as a sim config, and comparing a level loaded from a `.map` with the same level from its `.bsp`.
- `src/layout.ts`: where things are: the engine's own files, the game a command works on (the folder it runs in, `--game`, or the example game inside this repo), its `build/`, and the tools cache.
- `src/zip.ts` and `src/cli.ts`: the zip reader `setup` unpacks downloads with, and `isMain`, which lets each tool run as a command or be imported (even when npm starts it through a link in `node_modules`).

`tests/` mirrors `src/`. The compile tests need ericw-tools and skip without it.
