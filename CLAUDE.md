# Hollow Coil Project Guidelines

## What This Is

Hollow Coil is an open-source first-person shooter in the spirit of mid-90s shooters like Doom and Quake. Levels are hand-authored and abstract rather than realistic, built for fun, variety, and fast combat. The game is not currently intended to be a commercial product.

The current work plan lives in `docs/PLAN.md`. Decisions and their reasons go in `docs/DECISIONS.md`. Player movement and world collision must follow `docs/MOVEMENT.md`.

The game is built for the web (TypeScript + Three.js); desktop builds will wrap it in Electron. A Godot version was built through M1 for comparison and then dropped (see DECISIONS.md).

The TypeScript code is an npm workspace. `apps/` holds things you run (`apps/game` is the game; editors and tools will join it). `packages/` holds shared libraries: `sim` (simulation and file formats), `render` (Three.js presentation), `dev-server` (the development Vite plugin), and `testing` (Node-only test helpers). Apps import packages by module path (`@hollow-coil/sim/map/bsp`), straight from TypeScript source. Shared code goes in a package, never imported from another app. Only `apps/game` ships to players.

## Design Principles

- Feel over realism. Movement, weapon response, and enemy readability matter more than physical accuracy.
- Authored levels. Tools exist to support hand design, not replace it.
- Data-driven gameplay. Weapons, enemies, and movement constants live in `/data`, not in code.
- Era-authentic presentation, with options rather than a single locked look.

## Pipeline

- Levels are authored in TrenchBroom. The `.map` file is the source of truth.
- ericw-tools compiles `.map` to `.bsp` and bakes lighting. Both use the Quake 2 file formats (`qbsp -q2bsp`); gameplay is still Quake 1 style.
- Textures are loose PNGs at `textures/<folder>/<name>.png` (top level, next to `maps/`), referenced by name. No WADs. The repo root is the game root, the standard Quake layout that ericw-tools and TrenchBroom expect.
- Engines load `.map` for fast iteration and tests, and `.bsp` for lit, optimized builds.
- One entity parser serves both formats. Gameplay collision comes from brush planes, never from engine physics bodies.

## Simulation Rules

The simulation is strictly separated from presentation. These rules are not optional.

- Fixed 60 Hz tick, independent of frame rate, defined in one constant. Never hardcode the rate elsewhere. Express durations in seconds in data and convert to ticks from that constant. Rendering interpolates between ticks.
- Enemy AI decisions run on a 10 Hz think cadence, offset per enemy. Movement, collision, and weapons update every tick.
- The sim reads only per-tick input commands. No wall clock, input devices, or renderer access.
- All randomness comes from a seeded RNG stored in sim state. Never use `Math.random` in sim code.
- All sim state is plain, serializable data with stable entity IDs.
- The sim emits events (fired, hit, damaged, died). Rendering and audio consume events. The sim never calls presentation code.
- Sim code (`packages/sim`) must not import Three.js, any DOM API, or Node APIs, or depend on another package.

## Testing Rules

- Every gameplay change ships with tests: unit tests for the logic, and a `/spec` scenario when behavior is observable.
- Never change test expectations, scenario tolerances, or golden demos just to make a failing test pass. Explain the failure first.
- Re-record golden demos only for intentional behavior changes, and say so in the commit message. Golden demos are only valid at the tick rate they were recorded with.
- Map compiles must stay clean. Treat a leak as a failing test.

## Code Conventions

- TypeScript in strict mode.
- Prefer small, readable modules over clever abstractions.
- Tests live in each app's or package's `tests/` folder, mirroring `src/` (`packages/sim/src/map/bsp.ts` is tested by `packages/sim/tests/map/bsp.test.ts`). Package tests import the package by module path (`@hollow-coil/sim/map/bsp`), as other code does.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, with the summary in the imperative and lowercase, no trailing period.

- Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `ci`, `build`, `style`, `revert`.
- Scope is optional. Use the area touched: an app or package (`game`, `sim`, `render`, `dev-server`, `testing`, and future app names), or `maps`, `data`, `spec`, `demos`, `tools`, `ci`, `repo` (workspace-wide setup).
- Breaking changes to data formats, scenario formats, or demo compatibility get a `!` after the type (`feat(data)!: ...`) and a `BREAKING CHANGE:` footer.
- Examples: `feat(sim): add air acceleration`, `fix(sim): stop step-up through ceilings`, `test(spec): add 20-unit step scenario`, `chore: update gitignore`.

## Licensing

- Code is GPLv3 or later, with an additional permission for platform SDKs (`LICENSE`, `LICENSE-EXCEPTION.md`).
- Adapting code from Quake, ericw-tools, or other GPLv2-or-later / GPLv3 projects is allowed. Credit the source in a comment next to the adapted code.
- Do not copy code from GPLv2-only projects; it cannot be combined with GPLv3.
- New dependencies must have GPLv3-compatible licenses (MIT, BSD, Apache-2.0, LGPL, GPLv3, and similar). Ask before adding anything else.

## Commands

- `python tools/setup.py [tool ...]`: install pinned third-party tools (ericw-tools) into `.tools/`. Name tools to install only those. `--check` verifies without changing anything; `--force` reinstalls.
- `python tools/compile.py [map ...] [--mode check|release]`: compile maps to `build/<name>.bsp`. Fails on leaks, missing textures, and compiler errors. `check` (default) uses fast lighting; `release` uses full quality.
- `npm run bspdump -- build/<name>.bsp [--no-entities]`: print a compiled .bsp's entities, counts, textures, and lightmap stats as JSON, read with the game's own `.bsp` reader.
- `python -m unittest discover -s tools/tests`: test the tools (needs ericw-tools installed).
- `npm run validate`: validate `data/*.json` and the `spec/*.json` scenarios against their schemas, plus cross-file checks (runs in CI). The checks themselves live in `packages/data`, so editors can use them too.
- `npm run check-files`: fail if any tracked file is over 2 MB (runs in CI).
- `python tools/install_trenchbroom.py`: link `maps/trenchbroom` into TrenchBroom's games folder as "Hollow Coil". `--uninstall` removes the link.
- `python tools/make_placeholder_textures.py`: regenerate the placeholder PNGs in `textures/dev/`.

TypeScript (run from the repo root): `npm install`, then `npm run dev` (play at http://localhost:5173/?map=test_movement; pass Vite options after `--`), `npm test` (Vitest, every app and package), `npm run typecheck` (includes the sim-only check), and `npm run build`. `npm run setup`, `npm run compile`, and `npm run validate` run the Python tools above.
## Tools

- Tools in `/tools` are being ported from Python to TypeScript. New and ported tools live in `tools/src/` (tests in `tools/tests/`) and run with plain `node`, which strips TypeScript types itself. That's why the tsconfig sets `erasableSyntaxOnly` (no enums, namespaces, or constructor parameter properties) and relative imports end in `.ts`. Use Node's standard library and our packages; ask before adding a dependency.
- The remaining Python scripts need Python 3.11+, standard library only.
- Third-party tool versions are pinned in `tools/versions.json`. Bump versions there, never by hand-installing a different build.
