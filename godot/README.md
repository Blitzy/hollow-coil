# godot

The Godot 4.7 (GDScript) implementation of the vertical slice.

```
python tools/setup.py gdunit4     # once: installs the pinned gdUnit4 into addons/ (gitignored)
python tools/test_godot.py        # every test suite, headless
python tools/test_godot.py res://tests/sim/map    # one folder or suite
```

To play, open `godot/project.godot` in the Godot editor and press Play (F5). Click to capture the mouse, then move with WASD, look with the mouse, and jump with space; Esc frees the mouse. To pick a map, select the `Game` node in `scenes/main.tscn` and set **Map Name** in the inspector, or run from a terminal: `"$GODOT" --path godot -- --map=greybox_01`. The game reads maps, textures, and data from the repo (through the content search path below), so saving a map in TrenchBroom and restarting picks it up. Levels draw unlit from the `.map` for now; lightmaps come with M2.

Run the commands above from the repo root. The test runner finds Godot through the `GODOT` environment variable (the path to the Godot 4.7 executable; on Windows, the `_console.exe` so output reaches the terminal), or `godot` on PATH. It imports the project first, so Godot knows every script's `class_name`, then runs gdUnit4. CI runs the same script against a pinned Linux build of Godot (`.github/workflows/godot.yml`).

## Layout

- `src/sim/`: the simulation, in plain statically typed classes (`RefCounted`, never nodes), so tests run without scenes. `tests/test_sim_purity.gd` rejects scene-tree, clock, random, file, input, and rendering APIs, and 32-bit `Vector3`, in this folder.
  - `math/vec3.gd`: `Vec3`, a 64-bit vector. Official Godot builds have 32-bit `Vector3`; the sim uses `Vec3` so its math matches the web build's. `to_vector3()` converts for rendering.
  - `map/`: the `.map` parser (`MapParser`, also reads `.bsp` entity text), with `MapEntity` and `MapFace`
  - `collision/`: planes (`CollisionPlane`, named to avoid Godot's built-in `Plane`), windings, brushes with qbsp-matching bevels, and box traces (`Trace`)
  - `player/`: Quake-style player movement (`PlayerMovement`) and the player's physical state (`PlayerBody`)
  - `input_command.gd`: the per-tick input command, matching `spec/schemas/input_command.schema.json`
  - `player_data.gd`: `data/player.json` as the sim uses it (callers load the file)
  - `level.gd`: a map's collision world, markers, and player start
  - `sim.gd` and `sim_state.gd`: sim state, spawning, and `Sim.step()`, which advances one tick and returns events
  - `snapshot.gd`: snapshots and the per-tick state hash. The hash and the state's shape match the web build, so equal states hash equally in both engines. Snapshots use Godot's binary format rather than JSON, because Godot's JSON parser can read a float back one bit off.
  - `sim_random.gd`: the seeded RNG (mulberry32), matching the web build's reference values
  - `scenario.gd`: runs `/spec` scenarios; `tests/test_spec_scenarios.gd` runs every one
  - `constants.gd`: the tick rate, seconds-to-ticks conversion, and contents bits
- `src/render/`: presentation: level meshes from `.map` brushes (`LevelMesh`), texture projection (`TextureAxes`), and Quake-to-Godot coordinates (`QuakeCoords`)
- `src/game/`: the main scene's script (`game.gd`: loading, the fixed-tick loop, interpolation, mouse look, and the overlay) and input commands from held keys (`CommandBuilder`). The sim steps in `_physics_process`, with Godot's physics rate set from `SimConstants.TICK_RATE`.
- `scenes/main.tscn`: the main scene
- `src/content_paths.gd`: finds `maps/`, `textures/`, and `data/` files in the content directories listed in `HOLLOWCOIL_CONTENT`, then the repo root. The game reads them from outside the Godot project, so the same files serve both engines and the tools.
- `tests/`: gdUnit4 suites, mirroring `src/`. `tests/helpers/worlds.gd` builds small box-and-ramp worlds. The qbsp bevel fixture is shared with the web build (`web/tests/fixtures/bevels`).

Commit the `.gd.uid` files Godot creates next to scripts; they are the scripts' stable IDs. Movement and collision follow `docs/MOVEMENT.md`, and the code is ported from the web build's sim, file for file where possible, so the two stay easy to compare.
