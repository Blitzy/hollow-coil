# Hollow Coil Spike Plan: Two-Engine Vertical Slice

## Goal

Build the same small vertical slice twice, once on the web (TypeScript + Three.js) and once in Godot 4.7 (GDScript), then pick one to continue. Most work lives in shared, engine-neutral files so the comparison is fair and the losing implementation costs as little as possible.

Judge the engines on:

- Iteration speed: time from saving a map in TrenchBroom to playing it
- Test ergonomics: how fast and reliable the test suites are
- Agent reliability: how often changes break something, and how quickly tests catch it
- Game feel and rendering control
- Distribution: web build size and load time, desktop and Steam Deck builds

## Slice Scope

In scope:

- Quake-style player movement and collision
- Two weapons: pistol and shotgun, with weapon switching
- One enemy: a hitscan shotgunner that shoots back
- Maps authored in TrenchBroom, compiled with ericw-tools
- Render presets: Software, 3dfx, Modern
- Minimal HUD: health and current weapon as text
- Deterministic simulation with state hashing and demo replay

Out of scope for the spike:

- Ammo (infinite for now), pickups, doors, triggers, secrets
- Projectile weapons and projectile enemies
- Menus, save games, settings UI beyond a preset switch
- Final art and audio (placeholders only)

## Locked Decisions

- TrenchBroom is the level editor. The .map file is the source of truth.
- ericw-tools compiles maps: qbsp and light. vis is skipped until profiling shows a need.
- Maps use the Quake 2 file formats: Quake 2 (Valve) .map files compiled to Quake 2 .bsp (IBSP v38) with `qbsp -q2bsp`. Gameplay stays Quake 1 style; only the file formats are Quake 2's. This gives native brush data for collision (including the compiler's bevel planes) and native colored lightmaps.
- Textures are loose PNG files in folders, `textures/<folder>/<name>.png`, referenced by name from maps and .bsp files. Engines load the PNGs directly. No WADs and no palette conversion in the pipeline.
- Both engines load .map (fast iteration and tests, no baked lighting) and .bsp (lightmaps, hidden faces removed).
- One entity parser serves both loaders. The .bsp entity lump uses the same key/value text as the .map.
- Gameplay collision is built from brush planes in both loaders, never from engine physics bodies.
- Godot uses GDScript, not C#, so web export stays possible.
- Simulation runs at a fixed 60 Hz tick, defined as a single constant. Rendering interpolates between ticks.
- Enemy AI thinks every 0.1 seconds (10 Hz, 6 ticks at the 60 Hz rate), following Quake's monster think interval. Data stores the interval in seconds, like every other duration. Player movement, collision, and weapons still update every tick. This keeps controls crisp while enemies react in readable, era-style beats.
- Enemy animation is stepped at about 10 fps rather than smoothly blended.
- Lighting is baked by ericw-tools, not by Blender or Godot LightmapGI.
- Sim and presentation are strictly separated (rules in CLAUDE.md).
- License: GPLv3 or later, with an additional permission for platform SDKs (see DECISIONS.md).

## Repo Layout

```
/maps        TrenchBroom .map files, game config, FGD, textures
/data        weapons.json, enemies.json, movement.json, plus JSON Schemas
/spec        Engine-neutral test scenarios (JSON)
/tools       compile script, bsp dump tool, schema validation
/build       Compiled .bsp output (gitignored)
/demos       Golden demo recordings for regression tests, per engine (/demos/web, /demos/godot)
/web         TypeScript + Three.js implementation
/godot       Godot 4.7 implementation
/docs        PLAN.md, DECISIONS.md
```

## Starting Values

These are starting points to tune in the feel pass, not final numbers. Units are Quake units and seconds.

Movement (Quake reference values):

- Max ground speed 320, ground accelerate 10, friction 4, stop speed 100
- Gravity 800, jump velocity 270, step height 18
- Air acceleration: accelerate 10 with wish speed capped at 30 (Quake 1 style, allows air strafing)

Player: health 100. Hull from -16 -16 -24 to 16 16 32 (32 x 32 x 56), eye height 22 above origin (Quake values).

Pistol:

- Hitscan, 1 ray, damage 14, fire interval 0.35, spread 1 degree

Shotgun:

- Hitscan, 8 pellets, damage 6 each, fire interval 0.9, spread 6 degrees horizontal and 4 vertical

Weapon switching: lower 0.2, raise 0.25. No firing while lowering or raising.

Shotgunner enemy:

- Think interval 0.1 (10 Hz), with a per-enemy offset so enemies don't all think on the same tick
- Health 40, sight range 1500, field of view 120 degrees
- Hull same as the player (Quake grunt values)
- Moves: chases the player when it has seen them, run speed about 110 (roughly a Quake grunt). Movement is applied every tick; direction is chosen on think ticks.
- Reaction delay 0.6 after first sighting the player
- Attack: 5 pellets, damage 4 each, spread 10 degrees, cooldown 1.5
- Pain chance 0.5, pain stun 0.3

All spread uses the simulation's seeded RNG.

## Phase 0: Shared Foundation

Done once, before either engine.

- [ ] 0.1 Scaffold the repo layout and a CI workflow that runs validation and compiles.
- [ ] 0.2 TrenchBroom game config and FGD with worldspawn, info_player_start, monster_shotgunner, and light (including a lightstyle key).
- [ ] 0.3 Placeholder textures: a small set of grid and solid-color PNGs.
- [ ] 0.4 `tools/compile`: runs qbsp (`-q2bsp`) and light on every map, writes to /build, and exits non-zero on leaks or errors with a readable text summary. Missing textures are only warnings in qbsp, so the script treats them as errors. Pass the texture root explicitly (`-basedir`) since output isn't under a `maps/` folder.
- [ ] 0.5 `tools/bspdump`: prints a .bsp's entities, face count, and lightmap stats as JSON.
- [ ] 0.6 Maps:
  - `test_movement`: steps at 16, 18, and 20 units, slopes, gaps, ledges, and a finish marker
  - `test_combat`: open arena with cover pieces and walls that block line of sight
  - `greybox_01`: room, corridor, room, with two enemies and real lighting
- [ ] 0.7 Data files and JSON Schemas for movement, weapons, and enemies, using the starting values above, validated in CI.
- [ ] 0.8 Input command format (see Input Commands below), spec scenario format, and the first scenarios (see Testing below).

Done when every map compiles cleanly in CI and all data validates.

## Engine Milestones

Do each milestone in both engines before moving on, alternating which engine goes first. Record observations in DECISIONS.md after each pair.

### M1: Walk Around

- Parse .map, build render geometry, and build collision from brush planes
- Fixed-tick sim loop, per-tick input commands, snapshot and state hash functions
- Quake-style movement with step-up, air control, and jumping
- Interpolated rendering and mouse look

Godot note: func_godot may build the visual mesh, but sim collision comes from our own brush parser so it matches the web build.

Tests:

- Unit tests for acceleration, friction, air acceleration, and step-up
- Scenario: 18-unit step succeeds, 20-unit step blocks
- Scenario: scripted input run through `test_movement` reaches the finish
- Snapshot, restore, and re-simulate produces an identical state hash

### M2: Compiled Maps and Lighting

- .bsp loader: faces, entities, lightmap data
- Pack face lightmaps into an atlas and render with a lightmap shader
- Colored light from the Quake 2 .bsp's RGB lightmaps. Quake 2 lightmaps came out about 3x brighter than Quake 1 for the same light values in the format spike, so calibrate brightness here.
- Animated lightstyles as shader uniforms

Tests:

- Entities parsed from .map and .bsp match
- Collision built from .map and .bsp matches. qbsp adds bevel planes to .bsp brushes, so either the .map loader adds the same bevels or the test compares sweep results rather than plane lists.
- Atlas packing has no overlaps and covers every lit face

### M3: Weapons

- Weapon state machine: raising, idle, firing, cooldown, lowering
- Pistol and shotgun from data, hitscan against world and entities
- Switching via number keys and scroll wheel
- Events emitted for presentation (fired, hit wall, hit entity)

Tests:

- Fire rate matches data across a long hold
- Shotgun emits the right pellet count, and spread is reproducible with a fixed seed
- No firing during switch, switch timing matches data
- Hitscan stops at world geometry

### M4: Enemy

- States: idle, alert, chase, attack, pain, dead
- Movement toward the player using the same world collision as the player, with step-up
- Think cadence: decisions only on the enemy's think ticks, offset per enemy
- Line-of-sight checks against world collision
- Reaction delay, hitscan shotgun attack, pain stun

Tests:

- AI state changes happen only on that enemy's think ticks
- Enemies with different offsets think on different ticks
- Enemy does not see the player through walls in `test_combat`
- Damage at known ranges matches data within tolerance
- Enemy dies at zero health and stops acting
- Scenario: a chasing enemy closes distance to the player, steps up stairs, and never passes through walls
- Golden demo: record a short fight in `greybox_01` with a per-tick state hash, and replay it in CI

### M5: Feel and Presentation

Mostly hands-on tuning by Ryan, with few tests.

- Low-resolution render target with upscaling
- Render presets: Software (nearest, palette quantization, fullbrights), 3dfx (bilinear, 16-bit ordered dither, Voodoo-style output filter), Modern
- Separate texture and lightmap filter options in a custom preset
- Stepped enemy animation at about 10 fps
- View bob, weapon sway, muzzle flash, impact effects, placeholder audio
- Minimal HUD

## Testing

- **Unit tests** per engine: Vitest for web (sim runs in Node with no Three.js imports), gdUnit4 for Godot via `godot --headless`.
- **Shared scenarios** in /spec: each names a map, a starting state, an input sequence, and expectations at given ticks with tolerances. Both engines run every scenario.
- **Golden demos** in /demos: recorded inputs plus keyframe snapshots and a per-tick state hash. CI replays them and fails at the first divergent tick. Demos are only valid at the tick rate they were recorded with, so any tick rate experiments (such as 35 Hz) happen before recording goldens.
- **Demos are per engine.** The web build uses 64-bit floats and Godot's vectors use 32-bit floats, so state hashes can't match across engines. Each engine records and replays its own goldens in /demos/web and /demos/godot. Cross-engine agreement is checked by the shared /spec scenarios, which use tolerances. The input command format is shared, so the same recorded inputs can drive both engines.

## Input Commands

The sim's only input is one command per tick, in a format shared by both engines and used by scenarios and demos. Values are quantized so replays are exact:

- View angles are absolute, not deltas: yaw and pitch as 16-bit integers, 65536 units per full turn (Quake's scheme). Presentation accumulates mouse input at full precision and quantizes when building the command.
- Movement: forward and side as integers from -127 to 127, scaled to max speed by the sim.
- Buttons: a bitfield (attack, jump).
- Weapon select: 0 for no change, otherwise a weapon slot number.
- **Compile check**: CI compiles every map and fails on leaks or errors.
- **Visual smoke tests**: Playwright screenshots per map on web, `--write-movie` frame captures in Godot.

## Evaluation and Decision

After M4 in both engines, or earlier if the answer is obvious, compare against the goals above and record the decision and reasons in DECISIONS.md.

## Open Decisions

- Enemy navigation: Quake-style `movetogoal` (step toward the goal, try other directions when blocked) versus something smarter. Start with the Quake approach.
- Cross-browser determinism (custom trig or lookup tables), deferred until demos need to play across browsers
- Single entry point for project scripts (an `npm install` / `npm run` equivalent), deferred until after the engine decision
