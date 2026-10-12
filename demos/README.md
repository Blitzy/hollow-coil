# demos

Golden demo recordings: per-tick input commands, keyframe snapshots, and a per-tick state hash. CI replays them and fails at the first tick that diverges.

Demos are per engine, because float precision differs between the web build and Godot:

- `web/`: demos recorded and replayed by the web build
- `godot/`: demos recorded and replayed by the Godot build

A demo is only valid at the tick rate it was recorded with. Re-record goldens only for intentional behavior changes, and say so in the commit message.
