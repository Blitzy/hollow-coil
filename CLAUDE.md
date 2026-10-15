# Mandrel.js Project Guidelines

## What This Is

Mandrel.js is an open-source web engine for first-person shooters in the spirit of mid-90s shooters like Doom and Quake. This repo holds the engine plus a free example game to play and test it with. Levels are hand-authored and abstract rather than realistic, built for fun, variety, and fast combat.

Call the engine Mandrel.js, or `mandreljs` where a dot isn't allowed (packages, the command, file and folder names, environment variables), never just "Mandrel" (see DECISIONS.md, "The engine is named Mandrel.js").

A game made with Mandrel.js keeps its own content in its own repo under its own license; this repo holds only the engine and its example content (see DECISIONS.md, 2026-10-14). Content lives in game directories, like Quake's `id1/`: the example game is `example/`, and another game is a sibling directory checked out from its own repo.

The current work plan lives in `docs/PLAN.md`. Decisions and their reasons go in `docs/DECISIONS.md`. Player movement and world collision must follow `docs/MOVEMENT.md`, weapons `docs/WEAPONS.md`, and enemies `docs/ENEMIES.md`.

The engine is built for the web (TypeScript + Three.js); desktop builds will wrap it in Electron. A Godot version was built through M1 for comparison and then dropped (see DECISIONS.md).

The TypeScript code is an npm workspace with three kinds of folder:

- `apps/`: things you run. `apps/game-client` plays a game directory in the browser; editors will join it. Only `apps/game-client` ships to players.
- `packages/`: the engine's code. `sim` (game rules, physics, and map files), `render` (drawing, with Three.js), and `defs` (the schemas, light styles, and shared FGD every game is checked against, and the checks).
- `tools/`: developer tooling, run in Node and never shipped: the command-line tools, map compiling, the dev server's Vite plugin, and test helpers.

Apps import packages by module path (`@mandreljs/sim/map/bsp`), straight from TypeScript source. Shared code goes in a package, never imported from another app. Engine code never imports from `tools/` (`tools/tests/engine-imports.test.ts` checks); tests and an app's `vite.config.ts` may. Within the packages, `sim` depends on nothing.

## Design Principles

- Feel over realism. Movement, weapon response, and enemy readability matter more than physical accuracy.
- Authored levels. Tools exist to support hand design, not replace it.
- Data-driven gameplay. Weapons, enemies, and movement constants live in a game's `data/` (the example's is `example/data/`), not in code.
- Behavior lives in the engine; content combines it. Content never contains code. A new behavior is a generic engine action, named for what it does and never for one monster, plus example content and tests that use it.
- Era-authentic presentation, with options rather than a single locked look.

## Pipeline

- Levels are authored in TrenchBroom. The `.map` file is the source of truth.
- ericw-tools compiles `.map` to `.bsp` and bakes lighting. Both use the Quake 2 file formats (`qbsp -q2bsp`); gameplay is still Quake 1 style.
- A game directory holds `maps/`, `textures/`, `data/` (with `game.json`, its name and start map), and `trenchbroom/` (its TrenchBroom config and FGD) side by side, the standard Quake layout that ericw-tools and TrenchBroom expect. What every game shares is in `packages/defs`: the schemas, `lightstyles.json`, and the shared entities in `trenchbroom/mandreljs.fgd`, which each game's FGD includes as `mandreljs/mandreljs.fgd`. Only a game's data is ever in a folder called `data/`. Engine tests (`/scenarios`, golden demos, compile tests) use only the example game.
- Textures are loose PNGs at `textures/<folder>/<name>.png` in a game directory, referenced by name. No WADs.
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

- Every gameplay change ships with tests: unit tests for the logic, and a scenario in `/scenarios` when behavior is observable.
- Never change test expectations, scenario tolerances, or golden demos just to make a failing test pass. Explain the failure first.
- Re-record golden demos only for intentional behavior changes, and say so in the commit message. Golden demos are only valid at the tick rate they were recorded with.
- Map compiles must stay clean. Treat a leak as a failing test.

## Code Conventions

- TypeScript in strict mode.
- Prefer small, readable modules over clever abstractions.
- Tests live in each app's or package's `tests/` folder, mirroring `src/` (`packages/sim/src/map/bsp.ts` is tested by `packages/sim/tests/map/bsp.test.ts`). Package tests import the package by module path (`@mandreljs/sim/map/bsp`), as other code does.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, with the summary in the imperative and lowercase, no trailing period.

- Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `ci`, `build`, `style`, `revert`.
- Scope is optional. Use the area touched: an app or package (`game-client`, `sim`, `render`, `defs`, and future app names), or `tools`, `example` (the example game's content), `maps`, `data`, `scenarios`, `demos`, `ci`, `repo` (workspace-wide setup).
- Breaking changes to data formats, scenario formats, or demo compatibility get a `!` after the type (`feat(data)!: ...`) and a `BREAKING CHANGE:` footer.
- Examples: `feat(sim): add air acceleration`, `fix(sim): stop step-up through ceilings`, `test(scenarios): add 20-unit step scenario`, `chore: update gitignore`.

## Licensing

- Code is GPLv3 or later, with an additional permission for platform SDKs (`LICENSE`, `LICENSE-EXCEPTION.md`).
- Example content (maps, textures, gameplay data values, and future example audio and models) is CC BY 4.0. `LICENSE-EXCEPTION.md` lists which files are covered by which license; keep that list current when adding a new kind of content.
- Adapting code from Quake, ericw-tools, or other GPLv2-or-later / GPLv3 projects is allowed. Credit the source in a comment next to the adapted code.
- Do not copy code from GPLv2-only projects; it cannot be combined with GPLv3.
- New dependencies must have GPLv3-compatible licenses (MIT, BSD, Apache-2.0, LGPL, GPLv3, and similar). Ask before adding anything else.
- What ships to players carries its notices: the client's build lists every bundled npm package and its license in `THIRD-PARTY-NOTICES.txt` (`tools/src/notices.ts`), and a release from `mandreljs build` adds the engine's `LICENSE`, `LICENSE-EXCEPTION.md`, and a `NOTICE.md` linking the engine's source (the `repository` in the root `package.json`), plus the game's own `LICENSE`/`NOTICE`/`CREDITS` files (the example's `LICENSE.md` gives the credit CC BY requires).

## Commands

The commands that work on a game (`dev`, `build`, `compile`, `validate`, `bspdump`, `setup`, `install-trenchbroom`) are subcommands of one `mandreljs` command (`tools/src/mandreljs.ts`), the one a game outside this repo will install. The npm scripts below run it on the example game; `npx mandreljs <command>` runs it too, including from inside a game directory. `npx mandreljs help` lists them.

- `npm run setup [-- tool ...]`: install pinned third-party tools (ericw-tools) into the per-user tools cache (`%LOCALAPPDATA%\mandreljs` on Windows, `~/Library/Caches/mandreljs` on macOS, `~/.cache/mandreljs` on Linux), shared by every game. Name tools to install only those. `-- --check` verifies without changing anything; `-- --force` reinstalls.
- `npm run compile [-- map ...] [-- --mode check|release] [-- --game dir]`: compile a game's maps to its own `build/<name>.bsp` (`example/build/` for the example). Fails on leaks, missing textures, and compiler errors. `check` (default) uses fast lighting; `release` uses full quality.
- `npm run bspdump -- example/build/<name>.bsp [--no-entities]`: print a compiled .bsp's entities, counts, textures, and lightmap stats as JSON, read with the game's own `.bsp` reader.
- `npm run validate [-- --game dir]`: validate the engine's light styles, a game's `data/*.json` (the example's by default), and the `scenarios/*.json` scenarios against their schemas, plus cross-file checks, such as the game's enemies against its FGD and its name in its TrenchBroom config and map headers (runs in CI). The checks themselves live in `packages/defs`, so editors can use them too.
- `npm run package [-- --pack]`: build the `mandreljs` package (what a game's repo installs for the `mandreljs` command) in `dist/mandreljs/`: the command bundled with Vite into `bin/mandreljs.js`, the built client, the defs, and the pinned versions; `--pack` also makes `dist/mandreljs-<version>.tgz`. The package's engine-file paths come from `tools/src/engine-files.package.ts`, which the bundle uses in place of `engine-files.ts`; keep the two in step (`tools/tests/package.test.ts` checks).
- `npm run check-files`: fail if any tracked file is over 2 MB (runs in CI).
- `npm run test:package`: pack the `mandreljs` package, install it into a scratch folder outside the repo with a copy of `example/`, and run `mandreljs` there (`setup --check`, `validate`, `compile`, `build`, and requests to `dev`), as a game's repo would (runs in CI; needs ericw-tools).
- `npm run install-trenchbroom [-- --game dir]`: link a game's `trenchbroom/` folder (the example's by default) into TrenchBroom's games folder, named after its FGD (`games/MandrelJSExample`), and link the engine's FGD folder (`packages/defs/trenchbroom`) into it as `mandreljs/` for its FGD's `@include` (and remove links left by earlier versions). `-- --uninstall` removes the links.
- `npm run make-placeholder-textures`: regenerate the placeholder PNGs in `example/textures/dev/`.

Everything runs from the repo root: `npm install` once, then `npm run dev` (play at http://localhost:5173/?map=test_movement; run as `npx mandreljs dev` inside another game directory to play that game, or `&game=<dir>` for another one in the repo; pass Vite options after `--`, or `--built` for the plain Node server an installed engine uses), `npm test` (Vitest: every app, package, and tool; the compile tests need ericw-tools and skip without it), `npm run typecheck` (includes the sim-only check), and `npm run build` (a release of the example game in `example/dist/`).

## Tools

- Tools are TypeScript in `tools/src/` (tests in `tools/tests/`), run with plain `node`, which strips TypeScript types itself. That's why the tsconfig sets `erasableSyntaxOnly` (no enums, namespaces, or constructor parameter properties) and relative imports end in `.ts`. Use Node's standard library and our packages; ask before adding a dependency. Logic engine code or an app may need (such as validation) goes in a package, with the tool as a thin command-line wrapper. Code only tools and tests need (map compiling, the dev server, test helpers) stays in `tools/src/`.
- Third-party tool versions are pinned in `tools/versions.json`. Bump versions there, never by hand-installing a different build.
