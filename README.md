# Hollow Coil

An open-source first-person shooter in the spirit of mid-90s shooters like Doom and Quake. Levels are hand-authored and abstract rather than realistic, built for fun, variety, and fast combat. It is not currently intended to be a commercial product.

## Status

Early prototyping. We're building the same small vertical slice in two engines, a web build (TypeScript + Three.js) and Godot 4.7 (GDScript), and will continue with whichever works better. Nothing is playable yet.

See [docs/PLAN.md](docs/PLAN.md) for the current plan.

## How It Works

- Levels are made in [TrenchBroom](https://trenchbroom.github.io/) and compiled with [ericw-tools](https://ericw.github.io/ericw-tools/).
- Weapons, enemies, and movement are defined in data files, not code.
- The game simulation runs at a fixed tick and is deterministic, so recorded demos replay exactly and can be used as regression tests.

## How It's Made

Hollow Coil is built with agentic coding. Most of the code is written with an AI coding agent ([Claude Code](https://claude.com/claude-code)), and every change is reviewed by a human before it's committed. The content you play is made by hand: levels are built in TrenchBroom, and weapon tuning, encounters, and art direction are human decisions. The agent handles the plumbing so more time goes into the parts that make a game feel good. See [docs/DECISIONS.md](docs/DECISIONS.md) for the reasoning and how AI-generated assets are handled.

## Getting Started

You'll need:

- Python 3.11 or newer
- [TrenchBroom](https://trenchbroom.github.io/) 2026.2 or newer, to edit maps

Then install the pinned map compiler ([ericw-tools](https://ericw.github.io/ericw-tools/)) into `.tools/`:

```
python tools/setup.py
```

To edit maps, link the Hollow Coil game config into TrenchBroom, then in TrenchBroom open Preferences > Games > Hollow Coil and set the game path to the repo root (the folder containing `maps` and `textures`):

```
python tools/install_trenchbroom.py
```

Build, run, and test instructions for each engine are coming as the prototype takes shape.

## Repository Layout

| Folder | Contents |
|---|---|
| `maps/` | TrenchBroom maps and editor config |
| `textures/` | Textures (PNG), referenced by name from maps |
| `data/` | Weapons, enemies, and movement values, with JSON Schemas |
| `spec/` | Engine-neutral test scenarios |
| `demos/` | Golden demo recordings, per engine |
| `tools/` | Setup, map compiling, and validation scripts (Python) |
| `web/` | TypeScript + Three.js implementation |
| `godot/` | Godot 4.7 implementation |
| `docs/` | Plan and decision log |

## Contributing

Project guidelines live in [CLAUDE.md](CLAUDE.md). Design decisions and their reasons are recorded in [docs/DECISIONS.md](docs/DECISIONS.md).

## License

Hollow Coil's code is licensed under the [GNU General Public License v3.0 or later](LICENSE), with an additional permission for linking with platform SDKs such as Steamworks. See [LICENSE-EXCEPTION.md](LICENSE-EXCEPTION.md) for details, including how game assets are handled.
