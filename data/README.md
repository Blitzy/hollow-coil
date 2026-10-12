# data

Gameplay data shared by both engines, with JSON Schemas that CI validates (Phase 0.7):

- `movement.json`: player movement constants
- `weapons.json`: weapon definitions
- `enemies.json`: enemy definitions

Units are Quake units and seconds. Engines convert durations to ticks using the sim's tick-rate constant; never store tick counts here.
