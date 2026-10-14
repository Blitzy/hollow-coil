# data

The engine's data and the schemas for every game's data, read by the game and checked by the tools. Units are Quake units, seconds, and degrees. Engines convert durations to ticks using the sim's tick-rate constant; never store tick counts here.

- `lightstyles.json`: animated light patterns, keyed by a light's `style` number. The patterns are Quake's: one letter per step (`a` dark, `m` normal, `z` about double), looping. Presentation only; the sim doesn't read them. They're engine vocabulary, shared by every game: the `light` entity's style choices in the engine's FGD (`trenchbroom/mandrel.fgd`) must match these numbers and names.
- `schemas/`: a JSON Schema for each data file (`<name>.schema.json`), plus shared definitions in `common.schema.json`

Each game directory has its own `data/` (the example game's is `example/data/`), checked against the same schemas:

- `game.json`: the game's name (the page title, and the name of its TrenchBroom config) and the map it starts on
- `player.json`: health, hull, eye height, loadout, and Quake-style movement constants
- `weapons.json`: weapon switch timing and weapon definitions, keyed by weapon id
- `enemies.json`: enemy definitions, keyed by enemy id

Run `npm run validate` to check every file against its schema, plus cross-file rules: the player's weapons exist, weapon slots are unique, enemy classnames are defined in the game's TrenchBroom FGD, the FGD's light style choices match `lightstyles.json`, hulls are well formed, and the game's name matches its TrenchBroom config and its maps' `// Game:` lines. It checks the example game; `-- --game <dir>` checks another. CI runs it on every push. Editors like VS Code also validate these files as you type, through each file's `"$schema"` key.

The validator supports a subset of JSON Schema and rejects any other keyword, so if a schema needs something new (like `oneOf`), add support to `packages/data/src/schema.ts` first.
