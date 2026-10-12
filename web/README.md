# web

The TypeScript + Three.js implementation of the vertical slice.

```
npm install          # once, or after package.json changes
npm run dev          # play in the browser at http://localhost:5173/?map=test_movement
npm test             # Vitest, in Node
npm run typecheck    # whole project, plus the sim-only check
```

In the browser, click to capture the mouse, then move with WASD, look with the mouse, and jump with space. `?map=<name>` picks any map in `maps/`. The dev server serves the repo's `maps/`, `textures/`, and `data/` folders at `/game/`, so saving a map in TrenchBroom and reloading the page picks it up. (A production build doesn't bundle those files yet.)

## Layout

- `src/sim/`: the simulation. Plain TypeScript with no Three.js, DOM, Node, wall clock, or unseeded randomness. `tsconfig.sim.json` type-checks it with only the ES library, and `tests/sim-purity.test.ts` rejects forbidden imports and globals.
  - `math/`: vectors
  - `map/`: the `.map` parser (also reads `.bsp` entity text)
  - `collision/`: planes, windings, brushes with qbsp-matching bevels, and box traces
  - `player/`: Quake-style player movement
  - `level.ts`: a map's collision world, markers, and player start
  - `sim.ts`: sim state, spawning, and `step()`, which advances one tick and returns events
  - `snapshot.ts`: snapshots (JSON) and the per-tick state hash
  - `rng.ts`: the seeded RNG (mulberry32), with reference values in its test
  - `scenario.ts`: runs `/spec` scenarios; `tests/scenarios.test.ts` runs every one
  - `testing/`: small box-and-ramp worlds for tests
- `src/render/`: Three.js presentation: level meshes, texture coordinates, and Quake-to-Three coordinates
- `src/game/`: browser input, input commands, and the fixed-step loop
- `src/main.ts`: the entry point that ties them together
- `tests/helpers/`: Node-only test helpers, such as loading `/data` files
- `tests/`: cross-cutting tests and fixtures. `fixtures/bevels/` holds brushes compiled by qbsp; regenerate with `python web/tests/fixtures/bevels/generate.py`.

Movement and collision follow `docs/MOVEMENT.md`.
