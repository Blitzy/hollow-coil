# @mandreljs/defs

The definitions every game is checked against, and the code that checks them. Browser-safe (no file access), so editors can check what they save the same way CI does. `npm run validate` (`tools/src/validate.ts`) runs it over the engine's files, a game directory, and the `/spec` scenarios.

## Definitions

Shared by every game, and GPL like the rest of the engine. Units are Quake units, seconds, and degrees; engines convert durations to ticks using the sim's tick-rate constant, so never store tick counts in data.

- `schemas/`: a JSON Schema for each data file (`<name>.schema.json`), plus shared definitions in `common.schema.json`. A game's `data/` holds:
  - `game.json`: the game's name (the page title, and the name of its TrenchBroom config) and the map it starts on
  - `player.json`: health, hull, eye height, loadout, and Quake-style movement constants
  - `weapons.json`: weapon switch timing and weapon definitions, keyed by weapon id
  - `enemies.json`: enemy definitions, keyed by enemy id
- `lightstyles.json`: animated light patterns, keyed by a light's `style` number. The patterns are Quake's: one letter per step (`a` dark, `m` normal, `z` about double), looping. Presentation only; the sim doesn't read them. `@mandreljs/render` builds them into the engine.
- `trenchbroom/mandrel.fgd`: the entities every game shares (`worldspawn`, `info_player_start`, `info_marker`, `light`). Each game's FGD starts with `@include "mandrel/mandrel.fgd"`, through a link `npm run install-trenchbroom` makes in the game's `trenchbroom/` folder. The `light` entity's style choices must match `lightstyles.json`, number and name.

Editors like VS Code validate data files as you type, through each file's `"$schema"` key.

## Validation

- `src/schema.ts`: `SchemaValidator`, our subset of JSON Schema. It rejects any keyword it doesn't support, so a schema can't silently check less than it appears to; if a schema needs something new (like `oneOf`), add support here first. It takes a function that loads schema files by name.
- `src/checks.ts`: the cross-file checks: the player's weapons exist, weapon slots are unique, enemy classnames are in the game's FGD, the FGD's light style choices match `lightstyles.json`, hulls are well formed, the game's name matches its TrenchBroom config and its maps' `// Game:` lines, and scenario markers and timing. Plus reading a TrenchBroom config and resolving an FGD's `@include`s. They take file text, and functions that read other files (an included FGD, a scenario's map).
- `tests/`: the tests.
