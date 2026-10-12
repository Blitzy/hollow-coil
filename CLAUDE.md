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
- ericw-tools compiles `.map` to `.bsp` and bakes lighting.
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

## Commands

To be filled in during Phase 0: install, run each engine, run tests, compile maps, dump a .bsp.
