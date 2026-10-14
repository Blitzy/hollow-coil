# @mandreljs/sim

The simulation and the file formats it reads. Plain TypeScript with no Three.js, DOM, Node, wall clock, or unseeded randomness: this package's `tsconfig.json` type-checks it with only the ES library, and `tests/sim-purity.test.ts` rejects forbidden imports and globals. Movement and collision follow `docs/MOVEMENT.md`.

Import modules by path, such as `import { readBsp } from "@mandreljs/sim/map/bsp"`.

- `src/math/`: vectors
- `src/map/`: the `.map` parser (also reads `.bsp` entity text) and the Quake 2 `.bsp` reader
- `src/collision/`: planes, windings, brushes with qbsp-matching bevels, and box traces
- `src/player/`: Quake-style player movement
- `src/level.ts`: a map's collision world, markers, and player start
- `src/sim.ts`: sim state, spawning, and `step()`, which advances one tick and returns events
- `src/snapshot.ts`: snapshots (JSON) and the per-tick state hash
- `src/rng.ts`: the seeded RNG (mulberry32), with reference values in its test
- `src/scenario.ts`: runs `/spec` scenarios; `tests/scenarios.test.ts` runs every one
- `src/testing/`: small box-and-ramp worlds for tests
- `tests/`: the tests, mirroring `src/`, plus `scenarios.test.ts` and `sim-purity.test.ts`
- `tests/fixtures/bevels/`: brushes compiled by qbsp, to check our bevels. Regenerate with `node packages/sim/tests/fixtures/bevels/generate.ts`.
- `tests/fixtures/bsp/`: a small compiled, lit room for the `.bsp` reader and the lightmap tests in `@mandreljs/render`. Regenerate with `node packages/sim/tests/fixtures/bsp/generate.ts`. Its `expected.json` is the oracle for the reader, so the generator parses the file with its own code, not the reader's.

Both generators need ericw-tools (`npm run setup`). ericw-tools' `light` isn't byte-for-byte deterministic, so regenerating the `.bsp` fixture changes some lightmap bytes; commit it only when the room or the tools actually changed.
