# godot

The Godot 4.7 (GDScript) implementation of the vertical slice.

```
python tools/setup.py gdunit4     # once: installs the pinned gdUnit4 into addons/ (gitignored)
python tools/test_godot.py        # every test suite, headless
python tools/test_godot.py res://tests/sim/map    # one folder or suite
```

Run these from the repo root. The test runner finds Godot through the `GODOT` environment variable (the path to the Godot 4.7 executable; on Windows, the `_console.exe` so output reaches the terminal), or `godot` on PATH. It imports the project first, so Godot knows every script's `class_name`, then runs gdUnit4. CI runs the same script against a pinned Linux build of Godot (`.github/workflows/godot.yml`).

## Layout

- `src/sim/`: the simulation, in plain statically typed classes (`RefCounted`, never nodes), so tests run without scenes. `tests/test_sim_purity.gd` rejects scene-tree, clock, random, file, input, and rendering APIs, and 32-bit `Vector3`, in this folder.
  - `math/vec3.gd`: `Vec3`, a 64-bit vector. Official Godot builds have 32-bit `Vector3`; the sim uses `Vec3` so its math matches the web build's. `to_vector3()` converts for rendering.
  - `map/`: the `.map` parser (`MapParser`, also reads `.bsp` entity text), with `MapEntity` and `MapFace`
  - `collision/`: planes (`CollisionPlane`, named to avoid Godot's built-in `Plane`), windings, and brushes with qbsp-matching bevels
  - `constants.gd`: the tick rate and contents bits
- `src/content_paths.gd`: finds `maps/`, `textures/`, and `data/` files in the content directories listed in `HOLLOWCOIL_CONTENT`, then the repo root. The game reads them from outside the Godot project, so the same files serve both engines and the tools.
- `tests/`: gdUnit4 suites, mirroring `src/`. The qbsp bevel fixture is shared with the web build (`web/tests/fixtures/bevels`).

Commit the `.gd.uid` files Godot creates next to scripts; they are the scripts' stable IDs. Movement and collision follow `docs/MOVEMENT.md`, and the code is ported from the web build's sim, file for file where possible, so the two stay easy to compare.
