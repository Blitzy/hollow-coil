# web

The TypeScript + Three.js implementation of the vertical slice.

```
npm install          # once, or after package.json changes
npm run dev          # play in the browser at http://localhost:5173/?map=test_movement
npm test             # Vitest, in Node
npm run typecheck    # whole project, plus the sim-only check
```

In the browser, click to capture the mouse, then move with WASD, look with the mouse, and jump with space. `?map=<name>` picks any map in `maps/`. The dev server serves the repo's `maps/`, `textures/`, `data/`, and `build/` folders at `/game/`, so saving a map in TrenchBroom and reloading the page picks it up. (A production build doesn't bundle those files yet.)

The world is drawn from the compiled `.bsp` with its baked lighting. When the page asks for `build/<name>.bsp` and the `.map` is newer, the dev server compiles it first with `tools/compile.py` in check mode (about a tenth of a second), so lighting stays current. If the compile fails or ericw-tools isn't installed, the page falls back to the unlit `.map` and shows why in the overlay; the full report is in the browser console and the dev server's output. The sim always loads collision and entities from the `.map`. Lights with a `style` animate using the patterns in `data/lightstyles.json`, stepped on sim ticks.

URL options: `&lighting=off` draws the unlit `.map`; `&brightness=<n>` tries another lightmap brightness (default 1.5, fixed so light values mean the same in every map; see `maps/README.md`). While playing, `[` and `]` adjust it for comparison. The dev server runs `python` on Windows and `python3` elsewhere; set `PYTHON` to override.

## Layout

- `src/sim/`: the simulation. Plain TypeScript with no Three.js, DOM, Node, wall clock, or unseeded randomness. `tsconfig.sim.json` type-checks it with only the ES library, and `tests/sim-purity.test.ts` rejects forbidden imports and globals.
  - `math/`: vectors
  - `map/`: the `.map` parser (also reads `.bsp` entity text) and the Quake 2 `.bsp` reader
  - `collision/`: planes, windings, brushes with qbsp-matching bevels, and box traces
  - `player/`: Quake-style player movement
  - `level.ts`: a map's collision world, markers, and player start
  - `sim.ts`: sim state, spawning, and `step()`, which advances one tick and returns events
  - `snapshot.ts`: snapshots (JSON) and the per-tick state hash
  - `rng.ts`: the seeded RNG (mulberry32), with reference values in its test
  - `scenario.ts`: runs `/spec` scenarios; `tests/scenarios.test.ts` runs every one
  - `testing/`: small box-and-ramp worlds for tests
- `src/render/`: Three.js presentation: lit world meshes from the `.bsp` (`bsp-mesh.ts`) with the lightmap atlas (`lightmap-atlas.ts`) and animated light styles (`light-styles.ts`), unlit meshes from the `.map` (`level-mesh.ts`), texture coordinates, and Quake-to-Three coordinates
- `src/game/`: browser input, input commands, and the fixed-step loop
- `src/main.ts`: the entry point that ties them together
- `tests/helpers/`: Node-only test helpers, such as loading `/data` files
- `tests/`: cross-cutting tests and fixtures. `fixtures/bevels/` holds brushes compiled by qbsp; regenerate with `python web/tests/fixtures/bevels/generate.py`. `fixtures/bsp/` holds a small compiled, lit room for the `.bsp` reader; regenerate with `python web/tests/fixtures/bsp/generate.py`.

Movement and collision follow `docs/MOVEMENT.md`.
