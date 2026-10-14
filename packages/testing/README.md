# @mandreljs/testing

Node-only helpers for tests. The sim itself never reads files.

- `src/index.ts`: reading repo files (`readRepoFile`, `readRepoBytes`), and the example game's player, weapon, and enemy data as a sim config (`loadSimConfig`)
- `src/level-parity.ts`: comparing a level loaded from a `.map` with the same level from its `.bsp`: brushes matched by shape, and random sweeps
