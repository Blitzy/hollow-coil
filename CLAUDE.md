# Mandrel.js Project Guidelines

The README says what Mandrel.js is, how to get started, every command, and how the repo is laid out:

@README.md

## Ground Rules

Call the engine Mandrel.js, or `mandreljs` where a dot isn't allowed (packages, the command, file and folder names, environment variables), never just "Mandrel" (see DECISIONS.md, "The engine is named Mandrel.js").

A game made with Mandrel.js keeps its own content in its own repo under its own license; this repo holds only the engine and its example content (see DECISIONS.md, 2026-10-14). The example game is `example/`.

The current work plan lives in `docs/PLAN.md`. Decisions and their reasons go in `docs/DECISIONS.md`. Player movement and world collision must follow `docs/MOVEMENT.md`, weapons `docs/WEAPONS.md`, and enemies `docs/ENEMIES.md`.

The engine is built for the web (TypeScript + Three.js); desktop builds will wrap it in Electron. Only `apps/game-client` ships to players.

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
- Trigonometry comes from `packages/sim/src/math/trig.ts`, never `Math.sin`, `cos`, `tan`, `atan2`, `hypot`, or any other `Math` function JavaScript doesn't define exactly: those differ in the last bit between browsers, which breaks demos (`packages/sim/tests/math/trig.test.ts` checks).
- All sim state is plain, serializable data with stable entity IDs.
- The sim emits events (fired, hit, damaged, died). Rendering and audio consume events. The sim never calls presentation code.
- Sim code (`packages/sim`) must not import Three.js, any DOM API, or Node APIs, or depend on another package.

## Testing Rules

- Every gameplay change ships with tests: unit tests for the logic, and a scenario in `/scenarios` when behavior is observable.
- Never change test expectations, scenario tolerances, or golden demos just to make a failing test pass. Explain the failure first.
- Rebaseline golden demos (`npm run rebaseline-demos`) only for intentional behavior or content changes, and say so in the commit message; after a content change (a map or data file a demo plays on), play the demo back to check it still does what it should. Golden demos are only valid at the tick rate they were recorded with. Keep the demo format growable (`demos/README.md`): new inputs are new columns with a neutral default, and new sim state starts neutral.
- Map compiles must stay clean. Treat a leak as a failing test.

## Code Conventions

- TypeScript in strict mode.
- Prefer small, readable modules over clever abstractions.
- Tests live in each app's or package's `tests/` folder, mirroring `src/` (`packages/sim/src/map/bsp.ts` is tested by `packages/sim/tests/map/bsp.test.ts`). Package tests import the package by module path (`@mandreljs/sim/map/bsp`), as other code does.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/) without a scope: `type: summary`, with the summary in the imperative and lowercase, no trailing period.

- Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `ci`, `build`, `style`, `revert`.
- No scope in parentheses after the type. Older commits have one (`feat(sim): ...`); new ones don't.
- Breaking changes to data formats, scenario formats, or demo compatibility get a `!` after the type (`feat!: ...`) and a `BREAKING CHANGE:` footer.
- Examples: `feat: add air acceleration`, `fix: stop step-up through ceilings`, `test: add 20-unit step scenario`, `chore: update gitignore`.

## Licensing

- Code is GPLv3 or later, with an additional permission for platform SDKs (`LICENSE`, `LICENSE-EXCEPTION.md`).
- Example content (maps, textures, gameplay data values, and future example audio and models) is CC BY 4.0. `LICENSE-EXCEPTION.md` lists which files are covered by which license; keep that list current when adding a new kind of content.
- Adapting code from Quake, ericw-tools, or other GPLv2-or-later / GPLv3 projects is allowed. Credit the source in a comment next to the adapted code.
- Do not copy code from GPLv2-only projects; it cannot be combined with GPLv3.
- New dependencies must have GPLv3-compatible licenses (MIT, BSD, Apache-2.0, LGPL, GPLv3, and similar). Ask before adding anything else.
- What ships to players carries its notices (the README's `npm run build` row lists them): `THIRD-PARTY-NOTICES.txt` comes from `tools/src/notices.ts`, and the rest from `tools/src/build.ts`. `NOTICE.md` links the engine's source from the `repository` in the root `package.json`. Keep them working when changing the client's build or releases.

## Commands

Every command is in the README's Commands section (imported above). On top of that:

- Run `npm run check` before saying a change is done: it runs every check CI runs. The compile tests and `npm run test:package` need ericw-tools (`npm run setup`).
- The `mandreljs` package's engine-file paths come from `tools/src/engine-files.package.ts`, which the bundle uses in place of `engine-files.ts`; keep the two in step (`tools/tests/package.test.ts` checks).
- Releases publish themselves from `main` (`.github/workflows/release.yml`); never publish to npm or tag by hand. A release starts with `npm run release -- prepare <bump>` on `develop`, which needs entries in `CHANGELOG.md`'s TBD section.
- When a command, option, or file name changes, update the README, `tools/package-readme.md` (what game makers read), and the command's own usage text in `tools/src/mandreljs.ts`; other docs link to those rather than repeating them.

## Tools

- Tools are TypeScript in `tools/src/` (tests in `tools/tests/`), run with plain `node`, which strips TypeScript types itself. That's why the tsconfig sets `erasableSyntaxOnly` (no enums, namespaces, or constructor parameter properties) and relative imports end in `.ts`. Use Node's standard library and our packages; ask before adding a dependency. Logic engine code or an app may need (such as validation) goes in a package, with the tool as a thin command-line wrapper. Code only tools and tests need (map compiling, the dev server, test helpers) stays in `tools/src/`.
- Third-party tool versions are pinned in `tools/versions.json`. Bump versions there, never by hand-installing a different build.
