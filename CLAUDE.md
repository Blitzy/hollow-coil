# Hollow Coil Project Guidelines

## What This Is

Hollow Coil is an open-source first-person shooter in the spirit of mid-90s shooters like Doom and Quake. Levels are hand-authored and abstract rather than realistic, built for fun, variety, and fast combat. The game is not commercial.

The current work plan lives in `docs/PLAN.md`. Decisions and their reasons go in `docs/DECISIONS.md`.

## Design Principles

- Feel over realism. Movement, weapon response, and enemy readability matter more than physical accuracy.
- Authored levels. Tools exist to support hand design, not replace it.
- Data-driven gameplay. Weapons, enemies, and movement constants live in `/data`, not in code.
- Era-authentic presentation, with options rather than a single locked look.

## Pipeline

- Levels are authored in TrenchBroom. The `.map` file is the source of truth.
- ericw-tools compiles `.map` to `.bsp` and bakes lighting. Both use the Quake 2 file formats (`qbsp -q2bsp`); gameplay is still Quake 1 style.
- Textures are loose PNGs at `textures/<folder>/<name>.png`, referenced by name. No WADs.
- Engines load `.map` for fast iteration and tests, and `.bsp` for lit, optimized builds.
- One entity parser serves both formats. Gameplay collision comes from brush planes, never from engine physics bodies.

## Simulation Rules

The simulation is strictly separated from presentation. These rules are not optional.

- Fixed 60 Hz tick, independent of frame rate, defined in one constant. Never hardcode the rate elsewhere. Express durations in seconds in data and convert to ticks from that constant. Rendering interpolates between ticks.
- Enemy AI decisions run on a 10 Hz think cadence, offset per enemy. Movement, collision, and weapons update every tick.
- The sim reads only per-tick input commands. No wall clock, input devices, or renderer access.
- All randomness comes from a seeded RNG stored in sim state. Never use `Math.random` or Godot's global random functions in sim code.
- All sim state is plain, serializable data with stable entity IDs.
- The sim emits events (fired, hit, damaged, died). Rendering and audio consume events. The sim never calls presentation code.
- On the web, sim code must not import Three.js or any DOM API.

## Testing Rules

- Every gameplay change ships with tests: unit tests for the logic, and a `/spec` scenario when behavior is observable.
- Never change test expectations, scenario tolerances, or golden demos just to make a failing test pass. Explain the failure first.
- Re-record golden demos only for intentional behavior changes, and say so in the commit message. Golden demos are only valid at the tick rate they were recorded with.
- Map compiles must stay clean. Treat a leak as a failing test.

## Code Conventions

- Web: TypeScript in strict mode.
- Godot: GDScript with static typing. Keep game logic in plain classes so most tests run without scenes.
- Prefer small, readable modules over clever abstractions.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, with the summary in the imperative and lowercase, no trailing period.

- Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `ci`, `build`, `style`, `revert`.
- Scope is optional. Use the area touched: `web`, `godot`, `sim`, `maps`, `data`, `spec`, `demos`, `tools`, `ci`.
- Breaking changes to data formats, scenario formats, or demo compatibility get a `!` after the type (`feat(data)!: ...`) and a `BREAKING CHANGE:` footer.
- Examples: `feat(sim): add air acceleration`, `fix(godot): stop step-up through ceilings`, `test(spec): add 20-unit step scenario`, `chore: update gitignore`.

## Licensing

- Code is GPLv3 or later, with an additional permission for platform SDKs (`LICENSE`, `LICENSE-EXCEPTION.md`).
- Adapting code from Quake, ericw-tools, or other GPLv2-or-later / GPLv3 projects is allowed. Credit the source in a comment next to the adapted code.
- Do not copy code from GPLv2-only projects; it cannot be combined with GPLv3.
- New dependencies must have GPLv3-compatible licenses (MIT, BSD, Apache-2.0, LGPL, GPLv3, and similar). Ask before adding anything else.

## Commands

- `python tools/setup.py`: install pinned third-party tools (ericw-tools) into `.tools/`. `--check` verifies without changing anything; `--force` reinstalls.
- `python tools/compile.py [map ...] [--mode check|release]`: compile maps to `build/<name>.bsp`. Fails on leaks, missing textures, and compiler errors. `check` (default) uses fast lighting; `release` uses full quality.
- `python tools/bspdump.py build/<name>.bsp [--no-entities]`: print a compiled .bsp's entities, counts, textures, and lightmap stats as JSON.
- `python -m unittest discover -s tools/tests`: test the tools (needs ericw-tools installed).
- `python tools/check_files.py`: fail if any tracked file is over 2 MB (runs in CI).
- `python tools/install_trenchbroom.py`: link `maps/trenchbroom` into TrenchBroom's games folder as "Hollow Coil". `--uninstall` removes the link.
- `python tools/make_placeholder_textures.py`: regenerate the placeholder PNGs in `maps/textures/dev/`.

Still to come: run each engine, run engine tests.

## Tools

- Scripts in `/tools` are Python 3.11+, standard library only unless a dependency is clearly worth it.
- Third-party tool versions are pinned in `tools/versions.json`. Bump versions there, never by hand-installing a different build.
