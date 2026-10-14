# data

Gameplay and presentation data, read by the game and checked by the tools. Units are Quake units, seconds, and degrees. Engines convert durations to ticks using the sim's tick-rate constant; never store tick counts here.

- `player.json`: health, hull, eye height, loadout, and Quake-style movement constants
- `weapons.json`: weapon switch timing and weapon definitions, keyed by weapon id
- `enemies.json`: enemy definitions, keyed by enemy id
- `lightstyles.json`: animated light patterns, keyed by a light's `style` number. The patterns are Quake's: one letter per step (`a` dark, `m` normal, `z` about double), looping. Presentation only; the sim doesn't read them. The TrenchBroom FGD's style choices must match these numbers and names.
- `schemas/`: a JSON Schema for each file (`<name>.schema.json`), plus shared definitions in `common.schema.json`

Run `python tools/validate.py` to check every file against its schema, plus cross-file rules: the player's weapons exist, weapon slots are unique, enemy classnames are defined in the TrenchBroom FGD, the FGD's light style choices match `lightstyles.json`, and hulls are well formed. CI runs it on every push. Editors like VS Code also validate these files as you type, through each file's `"$schema"` key.

The validator supports a subset of JSON Schema and rejects any other keyword, so if a schema needs something new (like `oneOf`), add support to `tools/validate.py` first.
