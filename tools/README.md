# tools

Developer tools: they run in Node during development and never ship to players. Engine code (`packages/`) never imports them; `tests/engine-imports.test.ts` checks.

Command-line tools, each run from the repo root with `npm run <name>`. The ones that work on a game also run on a game directory anywhere else, run from inside it:

- `src/mandreljs.ts`: the `mandreljs` command (this package's `bin`), which runs the game tools below as subcommands: `mandreljs compile`, `mandreljs validate`, and so on. The npm scripts call it.
- `src/build.ts`: builds a release of a game in its `dist/` folder: the client, `games/index.json`, and the game's data, textures, and maps compiled at release quality.
- `src/dev.ts`: plays the game in the browser. From this repo's source it runs Vite on `apps/game-client`; with `--built`, or where there's no client source, it serves the built client with the plain server in `dev-server.ts`.
- `src/setup.ts`: installs the pinned third-party tools (ericw-tools) into a per-user cache shared by every game. Versions and checksums are in `versions.json`.
- `src/compile.ts`: compiles a game's maps into its `build/` folder with qbsp and light, failing on leaks, missing textures, and compiler errors.
- `src/validate.ts`: checks a game's data, the engine's light styles, and the scenarios, using `@mandreljs/defs`.
- `src/bspdump.ts`: prints a compiled `.bsp`'s contents as JSON.
- `src/install-trenchbroom.ts`: links a game's TrenchBroom config into TrenchBroom.
- `src/make-placeholder-textures.ts`: regenerates the example game's placeholder textures.
- `src/check-files.ts`: fails if any tracked file is over 2 MB.
- `src/rebaseline-demos.ts`: remakes golden demos' hashes and keyframes from their inputs, after an intentional behavior change (see `demos/README.md`).
- `src/package.ts`: builds the `mandreljs` package in `dist/mandreljs/` (`npm run package`): `mandreljs` bundled into `bin/mandreljs.js` with Vite, the built client, the defs, pinned versions, licenses, and `package-readme.md` as its README.

Used by other code:

- `src/dev-server.ts`: the dev server. It serves game directories at `/games/<game>/`, lists them (and the one to play) at `/games/index.json`, and compiles stale maps when the page asks for them. The same request handling runs as the Vite plugin each app's `vite.config.ts` uses, and as a plain Node server for the built client.
- `src/demo-levels.ts`: loads the level a demo was recorded on, compiling its `.bsp` when it was played on one. The golden demo test and `rebaseline-demos` use it.
- `src/testing.ts` and `src/level-parity.ts`: helpers for tests: reading repo files, the example game's data as a sim config, and comparing a level loaded from a `.map` with the same level from its `.bsp`.
- `src/engine-files.ts` and `src/engine-files.package.ts`: where the engine's own files are (schemas, light styles, the shared FGD, pinned versions, the client), from source and in the installed package. The package's bundle uses the second in place of the first, so they export the same names.
- `src/layout.ts`: where things are: the engine's own files, the game a command works on (the folder it runs in, `--game`, or the example game inside this repo), its `build/`, and the tools cache.
- `src/notices.ts`: the Vite plugin that writes `THIRD-PARTY-NOTICES.txt` into the client's build: every npm package bundled into it, with its license text (minifying drops license comments, and licenses such as MIT require the notice).
- `src/client.ts`: where the game client's source and build are, and building it with Vite.
- `src/zip.ts` and `src/cli.ts`: the zip reader `setup` unpacks downloads with, and `isMain`, which lets each tool run as a command or be imported (even when npm starts it through a link in `node_modules`).

`tests/` mirrors `src/`. The compile tests need ericw-tools and skip without it.
