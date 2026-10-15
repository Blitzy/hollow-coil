# Mandrel.js

An open-source web engine for first-person shooters in the spirit of mid-90s shooters like Doom and Quake, with a free example game to play and test it with.

Levels are hand-authored and abstract rather than realistic, made for fun, variety, and fast combat. (A mandrel is the core a coil is wound around and takes its shape from.)

## Status

Early prototyping: building a small vertical slice in the browser with TypeScript and Three.js. You can walk around the test maps with Quake-style movement and baked, colored lighting. (We built the same slice in Godot too, to compare, and chose the web build.) There are no weapons or enemies yet.

See [docs/PLAN.md](docs/PLAN.md) for the current plan.

## How It Works

- Levels are made in [TrenchBroom](https://trenchbroom.github.io/) and compiled with [ericw-tools](https://ericw.github.io/ericw-tools/).
- Weapons, enemies, and movement are defined in data files, not code.
- The game simulation runs at a fixed tick and is deterministic, so recorded demos replay exactly and can be used as regression tests.

## How It's Made

Mandrel.js is built with agentic coding. Most of the code is written with an AI coding agent ([Claude Code](https://claude.com/claude-code)), and every change is reviewed by a human before it's committed. The content you play is made by hand: levels are built in TrenchBroom, and weapon tuning, encounters, and art direction are human decisions. The agent handles the plumbing so more time goes into the parts that make a game feel good. See [docs/DECISIONS.md](docs/DECISIONS.md) for the reasoning and how AI-generated assets are handled.

## Getting Started

You'll need:

- [Node.js](https://nodejs.org/) 24 or newer
- [TrenchBroom](https://trenchbroom.github.io/) 2026.2 or newer, to edit maps

From the repo root, install the dependencies and the pinned map compiler ([ericw-tools](https://ericw.github.io/ericw-tools/)), which goes into a per-user cache shared by every game:

```
npm install
npm run setup
```

Then play:

```
npm run dev
```

and open http://localhost:5173/?map=greybox_01. See [apps/game-client/README.md](apps/game-client/README.md) for URL options and how the dev server compiles maps as you edit them.

To edit maps, link the Mandrel.js Example game config into TrenchBroom, then in TrenchBroom open Preferences > Games > Mandrel.js Example and set the game path to the `example` folder (the one containing `maps` and `textures`):

```
npm run install-trenchbroom
```

Every command is listed under [Commands](#commands).

## Commands

Run everything from the repo root. Options go after `--`, as in `npm run compile -- greybox_01 --mode release`. Commands that work on a game use the folder they run in if it's a game directory, or `--game <dir>`, or the example game.

The game commands (setup, `install-trenchbroom`, `dev`, `compile`, `bspdump`, and `validate`) are also one command, `mandrel`, the same one a game outside this repo will use: `npx mandrel compile --mode release`, or `npx mandrel help` for the list. Run inside a game directory, it works on that game.

**Setup**

| Command | What it does |
|---|---|
| `npm run setup` | Installs the pinned ericw-tools into a per-user cache (`%LOCALAPPDATA%\mandreljs` on Windows, `~/Library/Caches/mandreljs` on macOS, `~/.cache/mandreljs` on Linux), shared by every game. `--check` verifies the install without changing anything; `--force` reinstalls. |
| `npm run install-trenchbroom` | Links the game's config into TrenchBroom, and checks TrenchBroom's game path for it. `--uninstall` removes the links. |

**Play and build**

| Command | What it does |
|---|---|
| `npm run dev` | Starts the dev server at http://localhost:5173, compiling maps as you save them. In this repo it runs the client from source with Vite, so engine changes reload too, and Vite options work, such as `-- --port 5199`. `--built` serves the built client (from `npm run build`) without Vite, as an installed engine will. |
| `npm run build` | Builds a release of the game in its `dist/` folder (`example/dist/`), ready for any static web host, even in a subfolder: the client, built from source here, plus the game's data, textures, and maps compiled at release quality. It validates the game first and stops at any problem. `--mode check` uses fast lighting, to try a release quickly. |

**Maps**

| Command | What it does |
|---|---|
| `npm run compile` | Compiles every map into the game's `build/` folder, failing on leaks, missing textures, and compiler errors. Name maps to compile only those; `--mode release` for full-quality lighting. |
| `npm run bspdump -- <file>` | Prints a compiled map's entities, counts, textures, and lightmap stats as JSON, such as `-- example/build/greybox_01.bsp`. `--no-entities` leaves out the entity list. |
| `npm run make-placeholder-textures` | Regenerates the example game's placeholder textures in `example/textures/dev/`. |

**Checks** (CI runs all of these except `test:watch`)

| Command | What it does |
|---|---|
| `npm test` | Runs every test. The compile tests need ericw-tools, and skip without it. |
| `npm run test:watch` | Reruns the tests as you edit. |
| `npm run typecheck` | Type-checks everything, plus a check that the sim uses no browser or Node APIs. |
| `npm run validate` | Checks a game's data, the engine's light styles, and the scenarios against their schemas, plus the rules between files. |
| `npm run check-files` | Fails if any tracked file is over 2 MB. |

## Making Your Own Game

The engine plays game directories, like Quake's `id1/`. The example game is `example/` (see [example/README.md](example/README.md)); your game is a sibling directory, such as `mygame/`, checked out from its own repo (add it to `.git/info/exclude` so this repo ignores it). Play it at http://localhost:5173/?game=mygame, and pass `-- --game mygame` to `npm run compile`, `npm run validate`, and `npm run install-trenchbroom`.

## Repository Layout

| Folder | Contents |
|---|---|
| `example/` | The example game: maps, textures, weapon, enemy, and movement data, and its TrenchBroom config |
| `scenarios/` | Test scenarios, played on the example game |
| `demos/` | Recorded games, replayed as tests |
| `tools/` | Developer tools, run in Node and never shipped: map compiling, validation, the dev server, the TrenchBroom install, and test helpers |
| `apps/` | Things you run: `game-client/` (plays a game in the browser), and future editors |
| `packages/` | The engine's code: `sim/` (game rules, physics, and map files), `render/` (drawing, with Three.js), `defs/` (what game content must look like, and the checks for it) |
| `docs/` | Plan, decision log, and the movement reference |

The TypeScript side is one [npm workspace](https://docs.npmjs.com/cli/using-npm/workspaces): install once at the root, and apps import packages as `@mandreljs/<name>/<module>`, straight from source with no build step.

## Contributing

Project guidelines live in [CLAUDE.md](CLAUDE.md). Design decisions and their reasons are recorded in [docs/DECISIONS.md](docs/DECISIONS.md).

## License

Mandrel.js is licensed under the [GNU General Public License v3.0 or later](LICENSE), with an additional permission for linking with platform SDKs such as Steamworks. The example content (maps, textures, and gameplay data) is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). See [LICENSE-EXCEPTION.md](LICENSE-EXCEPTION.md) for exactly which files are covered by which license.
