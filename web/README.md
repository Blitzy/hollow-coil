# web

The TypeScript + Three.js implementation of the vertical slice.

```
npm install          # once, or after package.json changes
npm test             # Vitest, in Node
npm run typecheck    # whole project, plus the sim-only check
```

## Layout

- `src/sim/`: the simulation. Plain TypeScript with no Three.js, DOM, Node, wall clock, or unseeded randomness. `tsconfig.sim.json` type-checks it with only the ES library, and `tests/sim-purity.test.ts` rejects forbidden imports and globals.
  - `math/`: vectors
  - `map/`: the `.map` parser (also reads `.bsp` entity text)
  - `collision/`: planes, windings, and brushes with qbsp-matching bevels
- `tests/`: cross-cutting tests and fixtures. `fixtures/bevels/` holds brushes compiled by qbsp; regenerate with `python web/tests/fixtures/bevels/generate.py`.

Movement and collision follow `docs/MOVEMENT.md`.
