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

From the repo root, install the dependencies and the pinned map compiler ([ericw-tools](https://ericw.github.io/ericw-tools/)), which goes into `.tools/`:

```
npm install
npm run setup
```

Then play:

```
npm run dev
```

and open http://localhost:5173/?map=greybox_01. See [apps/game/README.md](apps/game/README.md) for URL options and how the dev server compiles maps as you edit them.

To edit maps, link the Mandrel.js Example game config into TrenchBroom, then in TrenchBroom open Preferences > Games > Mandrel.js Example and set the game path to the `example` folder (the one containing `maps` and `textures`):

```
npm run install-trenchbroom
```

Other root commands: `npm test` (every app, package, and tool), `npm run typecheck`, `npm run build`, `npm run compile` (all maps, or name some; `-- --mode release` for full-quality lighting), `npm run validate`, `npm run bspdump -- build/example/<name>.bsp`, and `npm run check-files`.

## Making Your Own Game

The engine plays game directories, like Quake's `id1/`. The example game is `example/` (see [example/README.md](example/README.md)); your game is a sibling directory, such as `mygame/`, checked out from its own repo (add it to `.git/info/exclude` so this repo ignores it). Play it at http://localhost:5173/?game=mygame, and pass `-- --game mygame` to `npm run compile`, `npm run validate`, and `npm run install-trenchbroom`.

## Repository Layout

| Folder | Contents |
|---|---|
| `example/` | The example game: maps, textures, weapon, enemy, and movement data, and its TrenchBroom config |
| `spec/` | Engine-neutral test scenarios |
| `demos/` | Golden demo recordings |
| `tools/` | Command-line tools: setup, map compiling, validation, `.bsp` inspection, and the TrenchBroom install (TypeScript, run with `node`) |
| `apps/` | Things you run: `game/` (the game), and future editors and tools |
| `packages/` | Shared TypeScript libraries: `sim/` (simulation and file formats), `render/` (Three.js presentation), `defs/` (the schemas, light styles, and shared entities every game is checked against, and the validation), `toolchain/` (map compiling with the pinned ericw-tools), `dev-server/` (serves game files in development), `testing/` (test helpers) |
| `docs/` | Plan, decision log, and the movement reference |

The TypeScript side is one [npm workspace](https://docs.npmjs.com/cli/using-npm/workspaces): install once at the root, and apps import packages as `@mandreljs/<name>/<module>`, straight from source with no build step.

## Contributing

Project guidelines live in [CLAUDE.md](CLAUDE.md). Design decisions and their reasons are recorded in [docs/DECISIONS.md](docs/DECISIONS.md).

## License

Mandrel.js is licensed under the [GNU General Public License v3.0 or later](LICENSE), with an additional permission for linking with platform SDKs such as Steamworks. The example content (maps, textures, and gameplay data) is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). See [LICENSE-EXCEPTION.md](LICENSE-EXCEPTION.md) for exactly which files are covered by which license.
