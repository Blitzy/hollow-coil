# spec

Engine-neutral test scenarios. The web build runs every scenario here (`packages/sim/tests/scenarios.test.ts`); a port to another engine must pass the same expectations, as the Godot build did through M1. Run `npm run validate` to check them; CI does on every push.

- `*.json`: scenarios, validated against `schemas/scenario.schema.json`
- `schemas/input_command.schema.json`: the per-tick input command, used by the game, scenarios, and demos

## Scenario format

A scenario names a map, a start (an `info_marker` plus facing), a timeline of input segments, and expectations at given times. See the schema's descriptions for every field, and the existing scenarios for examples.

Each input segment holds one set of inputs until its `until` time. View angles (`yaw`, `pitch`) carry over to later segments when omitted; everything else (`forward`, `side`, `jump`, `attack`, `weapon`) is neutral unless the segment sets it. After the last segment, inputs are neutral with the view held.

Expectations check the player's origin (`position`), `velocity`, `on_ground`, distance to a marker (`near_marker`), the weapon in hand (`weapon`, by its id in `data/weapons.json`), and how many shots the player has fired so far (`shots`; a shotgun blast is one shot). A `null` axis in `position` or `velocity` is not checked. Weapon timing follows `docs/WEAPONS.md`.

## Conversion rules

Any engine must convert scenarios to ticks and input commands exactly this way:

- **Time to ticks:** `ticks(t) = floor(t * tick_rate + 0.5)`, using the sim's tick-rate constant.
- **Segments:** segment *i* supplies the commands for ticks `ticks(previous until)` up to but not including `ticks(until)`, where the first segment starts at tick 0.
- **Expectations:** a check `at` time *t* runs after `ticks(t)` ticks have been simulated.
- **Angles:** `units(degrees) = floor(degrees * 65536 / 360 + 0.5)`. Yaw is then taken modulo 65536. Yaw 0 faces +x (east) and 90 faces +y (north). Pitch is positive looking up.
- **Buttons:** `jump` sets bit 2 and `attack` sets bit 1 of the command's `buttons`.
- **Start state:** the player spawns at the start marker's origin raised by 1 unit (see `docs/MOVEMENT.md`, Spawning), at rest, at full health, holding the starting weapon ready to fire. The first tick settles it onto the floor, 1/32 above it, so standing heights in expectations are 24 + 1/32 above the floor; the tolerances cover that. The RNG is seeded with `seed` (default 0). The RNG is mulberry32, so any engine can reproduce seeded results exactly: see `packages/sim/src/rng.ts`, and the reference outputs in `packages/sim/tests/rng.test.ts`.

Scenario times are in seconds, not ticks, so scenarios survive tick-rate experiments. Write times that land on whole ticks at 60 Hz (multiples of 1/60 s, such as 0.05 or 0.1) so the rounding never matters at the current rate.

## Status

- `unverified`: written without running in an engine. The first time an engine runs it, expectations and input timing may be tuned once to match correct behavior, with the reason in the commit message. Then mark it `verified`.
- `verified`: an engine has passed it. From then on, the testing rules in `CLAUDE.md` apply: never change expectations just to make a failing test pass.
