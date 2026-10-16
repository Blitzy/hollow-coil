# Mandrel.js

An open-source web engine for first-person shooters in the spirit of mid-90s shooters like Doom and Quake.

A game made with Mandrel.js is content, not code: levels built in [TrenchBroom](https://trenchbroom.github.io/), textures, and data files that define its weapons, enemies, and movement. The engine plays it in the browser, and one command, `mandreljs`, plays, checks, compiles, and builds it from the game's own repo. A free example game comes with the engine, to play and test it with.

(A mandrel is the core a coil is wound around and takes its shape from.)

## Status

Early development. The engine is playable in the browser, but features, data formats, and the `mandreljs` command change often, and the example game uses placeholder art. It's not ready for making real games yet.

See [docs/PLAN.md](docs/PLAN.md) for what's done and what's next.

## How It Works

- **A game is a folder**, laid out like Quake's `id1/`: `maps/`, `textures/`, `data/`, and its TrenchBroom config. It lives in its own repo, under its own license, and installs the engine as one npm package, `mandreljs` (see [Make your own game](#make-your-own-game)).
- **Levels are made in TrenchBroom** and compiled with [ericw-tools](https://ericw.github.io/ericw-tools/), which bakes the lighting.
- **Behavior lives in the engine; content combines it.** Weapons, enemies, and movement are tuned in data files, checked against the engine's schemas.
- **The simulation is deterministic,** on a fixed tick, so recorded demos replay exactly and double as regression tests.
- **Releases are static files** that run on any web host. Desktop builds will wrap them in Electron.

## How It's Made

Mandrel.js is built with agentic coding. Most of the code is written with an AI coding agent ([Claude Code](https://claude.com/claude-code)), and every change is reviewed by a human before it's committed. The example game's content is made by hand: levels are built in TrenchBroom, and weapon tuning, encounters, and art direction are human decisions. The agent handles the plumbing so more time goes into the parts that make a game feel good. See [docs/DECISIONS.md](docs/DECISIONS.md) for the reasoning and how AI-generated assets are handled.

## Getting Started

You'll need:

- [Node.js](https://nodejs.org/) 24 or newer
- [TrenchBroom](https://trenchbroom.github.io/) 2026.2 or newer, to edit maps

### Play the example game

Play it in your browser at https://mandreljs.github.io/mandrel.js/, built from `main` each time CI passes there.

To run it yourself, get the code, then install the dependencies and the pinned map compiler ([ericw-tools](https://ericw.github.io/ericw-tools/)), which goes into a per-user cache shared by every game:

```
git clone https://github.com/mandreljs/mandrel.js.git
cd mandrel.js
npm install
npm run setup
npm run dev
```

Open the address `npm run dev` prints, such as http://localhost:5173/?map=greybox_01. Maps compile when the game loads them, so the first load takes a moment. See [apps/game-client/README.md](apps/game-client/README.md) for URL options.

To edit its maps, link the example's game config into TrenchBroom:

```
npm run install-trenchbroom
```

It ends by telling you what to set in TrenchBroom: under Preferences > Games > Mandrel.js Example, the game path is the `example` folder (the one holding `maps` and `textures`, not `example/trenchbroom`). Restart TrenchBroom if it was open, then open a map from `example/maps/`. With `npm run dev` running, save the map and reload the page to play your changes.

### Make your own game

A game lives in its own repo, under your own license, and installs the engine as one npm package, `mandreljs`, for the `mandreljs` command. The package's [README](tools/package-readme.md) covers starting a game from a copy of the example, its commands, and crediting your content. To try the engine as it is in this repo, between releases, build the package here with `npm run package` and install the `.tgz` it makes.

To work on the engine and a game together, keep the game next to `example/` in this repo instead (add it to `.git/info/exclude` so this repo ignores it). Then `npm run dev` plays it at http://localhost:5173/?game=mygame from the engine's source, and the other commands take `-- --game mygame`.

## Commands

Run everything from the repo root. Options go after `--`, as in `npm run compile -- greybox_01 --mode release`. Commands that work on a game use the folder they run in if it's a game directory, or `--game <dir>`, or the example game.

The game commands (setup, `install-trenchbroom`, `dev`, `compile`, `bspdump`, and `validate`) are also one command, `mandreljs`, the same one a game outside this repo will use: `npx mandreljs compile --mode release`, or `npx mandreljs help` for the list. Run inside a game directory, it works on that game.

**Setup**

| Command | What it does |
|---|---|
| `npm run setup` | Installs the pinned ericw-tools into a per-user cache (`%LOCALAPPDATA%\mandreljs` on Windows, `~/Library/Caches/mandreljs` on macOS, `~/.cache/mandreljs` on Linux), shared by every game. `--check` verifies the install without changing anything; `--force` reinstalls. |
| `npm run install-trenchbroom` | Links the game's config into TrenchBroom, and checks TrenchBroom's game path for it. `--uninstall` removes the links. |

**Play and build**

| Command | What it does |
|---|---|
| `npm run dev` | Starts the dev server at http://localhost:5173, compiling maps as you save them. In this repo it runs the client from source with Vite, so engine changes reload too, and Vite options work, such as `-- --port 5199`. `--built` serves the built client (from `npm run build`) without Vite, as an installed engine will. |
| `npm run build` | Builds a release of the game in its `dist/` folder (`example/dist/`), ready for any static web host, even in a subfolder: the client, built from source here, plus the game's data, textures, and maps compiled at release quality. It validates the game first and stops at any problem. Each release carries the engine's license, a `NOTICE.md` saying what's the engine's (with a link to its source) and what's the game's, `THIRD-PARTY-NOTICES.txt` for libraries bundled into the client, such as Three.js, and the game's own `LICENSE`, `NOTICE`, or `CREDITS` files. `--mode check` uses fast lighting, to try a release quickly. |

**Maps**

| Command | What it does |
|---|---|
| `npm run compile` | Compiles every map into the game's `build/` folder, failing on leaks, missing textures, and compiler errors. Name maps to compile only those; `--mode release` for full-quality lighting. |
| `npm run bspdump -- <file>` | Prints a compiled map's entities, counts, textures, and lightmap stats as JSON, such as `-- example/build/greybox_01.bsp`. `--no-entities` leaves out the entity list. |
| `npm run make-placeholder-textures` | Regenerates the example game's placeholder textures in `example/textures/dev/`. |
| `npm run rebaseline-demos` | Remakes golden demos' hashes and keyframes from their recorded inputs, after an intentional behavior change (say so in the commit message). Name demos to do only those; see [demos/README.md](demos/README.md). |

**Checks**

| Command | What it does |
|---|---|
| `npm run check` | Runs every check below except `test:watch`, as CI does. Run it before opening a pull request. |
| `npm test` | Runs every test. The compile tests need ericw-tools, and skip without it. |
| `npm run test:watch` | Reruns the tests as you edit. |
| `npm run typecheck` | Type-checks everything, plus a check that the sim uses no browser or Node APIs. |
| `npm run validate` | Checks a game's data, the engine's light styles, and the scenarios against their schemas, plus the rules between files. |
| `npm run check-files` | Fails if any tracked file is over 2 MB. |
| `npm run test:package` | Packs the `mandreljs` package, installs it into a scratch folder outside the repo with a copy of the example game, and runs `mandreljs` there as a game's repo would: `setup --check`, `validate`, `compile`, `build`, and `dev`. Needs ericw-tools. |

**The engine package and releases**

Releases publish themselves. On `develop`, run `npm run release -- prepare <bump>`, commit, and merge `develop` into `main`; when CI passes there, the release workflow publishes `mandreljs` to npm and makes the GitHub release and its tag, with the version's `CHANGELOG.md` section as its notes. Every merge into `main` that passes CI also rebuilds the example game on the repo's [GitHub Pages site](https://mandreljs.github.io/mandrel.js/) (`.github/workflows/pages.yml`).

| Command | What it does |
|---|---|
| `npm run package` | Builds the `mandreljs` package, what a game's own repo installs for the `mandreljs` command, in `dist/mandreljs/`: the command bundled into JavaScript, the built client, and the engine's definitions, packed into `dist/mandreljs-<version>.tgz`, which a game's repo can install with `npm install <path to .tgz>`. The version is the root `package.json`'s. |
| `npm run release -- prepare <bump>` | Prepares a release: bumps the engine's version (`major`, `minor`, `patch`, or an explicit version such as `1.2.3`, or a pre-release such as `1.2.0-rc.1`, which is published as one and never as npm's latest) in `package.json` and its lockfile, and turns `CHANGELOG.md`'s TBD section into the version's, dated today (`--date YYYY-MM-DD` for another day), with a fresh TBD section above it. Refuses when TBD has no entries. |
| `npm run changelog -- extract <version>` | Prints a version's `CHANGELOG.md` section, as the release workflow does for the GitHub release's notes. |

## Repository Layout

| Folder | Contents |
|---|---|
| `example/` | The example game: maps, textures, weapon, enemy, and movement data, and its TrenchBroom config |
| `scenarios/` | Test scenarios, played on the example game |
| `demos/` | Recorded games, replayed as tests |
| `tools/` | Developer tools, run in Node and never shipped: map compiling, validation, the dev server, the TrenchBroom install, and test helpers |
| `apps/` | Things you run: `game-client/` (plays a game in the browser), and future editors |
| `packages/` | The engine's code: `sim/` (game rules, physics, and map files), `render/` (drawing, with Three.js), `defs/` (what game content must look like, and the checks for it) |
| `docs/` | The plan, the decision log, and the movement, weapon, and enemy references |

The TypeScript side is one [npm workspace](https://docs.npmjs.com/cli/using-npm/workspaces): install once at the root, and apps import packages as `@mandreljs/<name>/<module>`, straight from source with no build step.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Mandrel.js is licensed under the [GNU General Public License v3.0 or later](LICENSE), with an additional permission for linking with platform SDKs such as Steamworks. The example content (maps, textures, and gameplay data) is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). See [LICENSE-EXCEPTION.md](LICENSE-EXCEPTION.md) for exactly which files are covered by which license.
