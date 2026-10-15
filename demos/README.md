# demos

Golden demos: recorded games, replayed as regression tests. Each `*.demo.json` holds one life on one map of the example game, from the level's start: every tick's input command, plus what the sim did with them. `packages/sim/tests/demos.test.ts` replays every demo here on the example game's current map and data. It fails if that content changed since the demo was recorded, saying which, and otherwise at the first tick whose state differs from the recording, naming the tick and what differs.

## Recording one

Play with `npm run dev` and press R. The level starts over and recording begins; press R again to stop, or die and start over, and the browser saves the demo (named after the map and the time). Move it into this folder and commit it. A demo replays on the file the game played (the compiled `.bsp`, or the `.map` with `lighting=off`); `.bsp` demos need ericw-tools to replay, as CI has.

## When a demo fails

A demo fails for one of two reasons:

- **Its content changed:** the map's collision or play entities, or a data file (`player.json`, `weapons.json`, `enemies.json`), differs from what it was recorded on. Lighting, texture alignment, and formatting don't count. If the change was on purpose, run `npm run rebaseline-demos` (or name demos: `-- greybox_01-....demo.json`), then play the demo back to check its old inputs still do what they should on the new content; if a wall now stands where the player walked, record it again.
- **The sim does something different with the same inputs.** If that's a bug, fix it. If the behavior changed on purpose, rebaseline it the same way.

Either way, say so in the commit message. Never rebaseline just to make a failure go away; explain it first (see the testing rules in `CLAUDE.md`).

## The format

A demo is JSON, one line per header field and input column so diffs stay readable. Everything a person played is in `commands`; everything else after the header is derived from it and can be rebaselined. `packages/sim/src/demo.ts` reads and writes it.

| Field | What it holds |
|---|---|
| `format` | Always `"mandreljs-demo"`. |
| `version` | The format's version (1). Only a breaking change bumps it, with an upgrade in `upgradeDemo` so older files keep loading. |
| `game`, `map` | The game's name and the map played. |
| `level` | `"bsp"` or `"map"`: the file the level came from. They collide alike, but not to the last bit, so a replay uses the same one. |
| `seed` | The sim's RNG seed. |
| `engine` | The engine version it was recorded with, for people reading it. |
| `tick_rate` | Ticks per second. A demo replays only at the rate it was recorded at. |
| `ticks` | How many ticks were recorded. |
| `content` | Hashes of the content it was recorded on, 8 hex digits each: `map` (the level's collision brushes, and every entity but worldspawn and lights, as loaded from the file `level` names), and `player`, `weapons`, and `enemies` (each data file, parsed, without `$schema`). A replay checks only the keys a demo has, so content a newer engine adds doesn't fail old demos. |
| `commands` | The input commands, one column per field of the command (`scenarios/schemas/input_command.schema.json`). Each column is runs, `[value, count, value, count, ...]`: with `"encoding": "runs"` the values are the field's, and with `"delta-runs"` they're changes from the previous tick (from 0 before the first; yaw's the short way round a turn). A held key or a still mouse is one run. |
| `actions` | Things that happen at a tick and aren't input commands, as `{ "tick", "type", ... }`. None exist yet. |
| `hashes` | The state's hash (`hashState`) at every tick from 0 to `ticks`, 8 hex digits each, run together. |
| `keyframes` | The full state at tick 0, every 5 seconds, and the last tick, for saying what differs when a replay diverges. |

### Growing it without breaking old demos

- **A new input** (a button, an inventory key) is a new column, or a new bit in `buttons`. Demos without it read it as its neutral value (0), which is how the engine played before it existed. An engine that meets a column it doesn't know refuses the demo and says it needs a newer engine.
- **A new kind of event** that isn't per-tick input goes in `actions` with a new `type`. Unknown types are refused the same way.
- **New header fields** are additive. Only a change that old readers would misread bumps `version`, and it comes with an upgrade.
- **New sim state starts neutral**, so a demo that never touches a feature plays the same. When behavior or content does change on purpose, the inputs still replay, and rebaselining makes the rest again.
