# Hollow Coil

An open-source first-person shooter in the spirit of mid-90s shooters like Doom and Quake. Levels are hand-authored and abstract rather than realistic, built for fun, variety, and fast combat. Not a commercial project.

## Status

Early prototyping. We're building the same small vertical slice in two engines, a web build (TypeScript + Three.js) and Godot 4.7 (GDScript), and will continue with whichever works better. Nothing is playable yet.

See [docs/PLAN.md](docs/PLAN.md) for the current plan.

## How It Works

- Levels are made in [TrenchBroom](https://trenchbroom.github.io/) and compiled with [ericw-tools](https://ericw.github.io/ericw-tools/).
- Weapons, enemies, and movement are defined in data files, not code.
- The game simulation runs at a fixed tick and is deterministic, so recorded demos replay exactly and can be used as regression tests.

## Getting Started

You'll need:

- Python 3.11 or newer
- [TrenchBroom](https://trenchbroom.github.io/) 2026.2 or newer, to edit maps

Then install the pinned map compiler ([ericw-tools](https://ericw.github.io/ericw-tools/)) into `.tools/`:

```
python tools/setup.py
```

Build, run, and test instructions for each engine are coming as the prototype takes shape.

## Repository Layout

| Folder | Contents |
|---|---|
| `maps/` | TrenchBroom maps, textures, and editor config |
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
