# Mandrel.js Plan: Vertical Slice

## Goal

Build a small vertical slice on the web (TypeScript + Three.js). Desktop releases will wrap the web build in Electron.

The slice started as a two-engine comparison: the same slice built on the web and in Godot 4.7. After M1, with both engines passing the same scenarios and playing identically, the web build was chosen and Godot dropped (see DECISIONS.md, 2026-10-13). Most work still lives in shared, engine-neutral files (the example game in `/example`, and `/scenarios`), which keeps a future port possible and checkable.

Design goals beyond the slice:

- User-made levels: the TrenchBroom config, FGD, and compile tools double as a modding kit, with data-only level packages (see DECISIONS.md, 2026-10-13).
- Editor and tool apps in `apps/`, sharing the game's sim and renderer (see DECISIONS.md, 2026-10-13). Ideas so far, none scheduled: particle editor, model viewer and animation tester, sfxr-style sound designer, demo inspector (scrub ticks, find the first divergent hash), map inspector (collision, bevels, lightmaps, test traces), scenario visualizer, live tuning panel for `data/` values, light style editor, palette and look tool for the Software preset, and a mod packager.

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
- The game loads .map (fast iteration and tests, no baked lighting) and .bsp (lightmaps, hidden faces removed).
- One entity parser serves both loaders. The .bsp entity lump uses the same key/value text as the .map.
- Gameplay collision is built from brush planes in both loaders, never from engine physics bodies.
- The game runs on the web (TypeScript + Three.js); desktop builds wrap it in Electron.
- Simulation runs at a fixed 60 Hz tick, defined as a single constant. Rendering interpolates between ticks.
- Enemy AI thinks every 0.1 seconds (10 Hz, 6 ticks at the 60 Hz rate), following Quake's monster think interval. Data stores the interval in seconds, like every other duration. Player movement, collision, and weapons still update every tick. This keeps controls crisp while enemies react in readable, era-style beats.
- Enemy animation is stepped at about 10 fps rather than smoothly blended.
- Lighting is baked by ericw-tools, not computed at runtime or baked in Blender.
- Sim and presentation are strictly separated (rules in CLAUDE.md).
- License: GPLv3 or later, with an additional permission for platform SDKs (see DECISIONS.md).

## Repo Layout

```
/example     The example game's directory, like Quake's id1/:
  maps/        TrenchBroom .map files
  textures/    Textures (PNG), next to maps/ as Quake tools expect
  data/        game.json (name, start map), player.json (health, hull, movement), weapons.json, enemies.json
  trenchbroom/ The game's TrenchBroom config and FGD
  build/       Compiled .bsp output (gitignored)
/scenarios   Engine-neutral test scenarios (JSON), played on the example game
/tools       Developer tools, run in Node: compile, validate, bspdump, setup, install-trenchbroom,
             the dev server's Vite plugin, and test helpers
/demos       Golden demo recordings for regression tests
/apps        Things you run: game-client/ (plays a game in the browser), and future editors
/packages    The engine's code: sim/, render/, defs/ (schemas, light styles, the shared FGD, and the checks)
/docs        PLAN.md, DECISIONS.md, MOVEMENT.md
```

## Starting Values

These are starting points to tune in the feel pass, not final numbers. Units are Quake units and seconds.

Movement (Quake reference values):

- Max ground speed 320, ground accelerate 10, friction 4 (doubled over drop-offs), stop speed 100
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

Shared files and tools, done before the engine work.

- [x] 0.1 Scaffold the repo layout and a CI workflow that runs validation and compiles.
- [x] 0.2 TrenchBroom game config and FGD with worldspawn, info_player_start, monster_shotgunner, and light (including a lightstyle key).
- [x] 0.3 Placeholder textures: a small set of grid and solid-color PNGs.
- [x] 0.4 `tools/compile`: runs qbsp (`-q2bsp`) and light on every map, writes to /build, and exits non-zero on leaks or errors with a readable text summary. Missing textures are only warnings in qbsp, so the script treats them as errors. Pass the game root explicitly (`-basedir`, `-gamedir`) since output isn't under a `maps/` folder.
- [x] 0.5 `tools/bspdump`: prints a .bsp's entities, face count, and lightmap stats as JSON.
- [x] 0.6 Maps:
  - `test_movement`: steps at 16, 18, and 20 units, slopes, gaps, ledges, and a finish marker
  - `test_combat`: open arena with cover pieces and walls that block line of sight
  - `greybox_01`: room, corridor, room, with two enemies and real lighting
- [x] 0.7 Data files and JSON Schemas for the player (including movement), weapons, and enemies, using the starting values above, validated in CI.
- [x] 0.8 Input command format (see Input Commands below), spec scenario format, and the first scenarios (see Testing below).

Done when every map compiles cleanly in CI and all data validates.

## Milestones

### M1: Walk Around

Done (2026-10-13), in both engines; the engine decision followed. Movement and collision follow `docs/MOVEMENT.md`.

- Parse .map, build render geometry, and build collision from brush planes
- Fixed-tick sim loop, per-tick input commands, snapshot and state hash functions
- Quake-style movement with step-up, air control, and jumping
- Interpolated rendering and mouse look

Tests:

- Unit tests for acceleration, friction, air acceleration, and step-up
- Scenario: 18-unit step succeeds, 20-unit step blocks
- Scenario: scripted input run through `test_movement` reaches the finish
- Snapshot, restore, and re-simulate produces an identical state hash

### M2: Compiled Maps and Lighting

Done (2026-10-13). The game loads a level from one file, the compiled .bsp, for drawing, collision, and entities, and falls back to the .map when there is no usable .bsp. Tests check that both files give the same level on every map: the same entities and brushes, the same sweep results, and the same scenario runs, tick for tick.

- .bsp loader: faces, entities, lightmap data
- Pack face lightmaps into an atlas and render with a lightmap shader. Read each face's lightmap from its stored offset: ericw-tools pads each face's data to a multiple of 4 samples, so faces are not packed back to back. Lightmap size per face is computed from texture-space extents at 16 texels per luxel (see `lightmapExtents` in `packages/sim/src/map/bsp.ts`).
- Colored light from the Quake 2 .bsp's RGB lightmaps. Quake 2 lightmaps came out about 3x brighter than Quake 1 for the same light values in the format spike, so calibrate brightness here.
- Animated lightstyles from `lightstyles.json` (Quake's patterns, now in `packages/defs`), stepped on sim ticks. When a style's value changes, re-compose the lightmaps of the faces it lights, as Quake's GL renderers did, rather than mixing styles in a shader.

Tests:

- Entities parsed from .map and .bsp match
- Collision built from .map and .bsp matches. qbsp adds bevel planes to .bsp brushes, so either the .map loader adds the same bevels or the test compares sweep results rather than plane lists.
- Atlas packing has no overlaps and covers every lit face

### M3: Weapons

Done (2026-10-14). The pistol and shotgun switch and fire by Quake 3's rules (see `docs/WEAPONS.md`), with hitscan against walls and entity boxes, fired and hit events, and scenarios. In the game: number keys and the mouse wheel switch weapons, the overlay shows the weapon, and shots leave placeholder marks where they hit.

- Weapon state machine: ready, firing (with its cooldown), lowering, raising
- Pistol and shotgun from data, hitscan against world and entities
- Switching via number keys and scroll wheel
- Events emitted for presentation (fired, hit wall, hit entity)

Tests:

- Fire rate matches data across a long hold
- Shotgun emits the right pellet count, and spread is reproducible with a fixed seed
- No firing during switch, switch timing matches data
- Hitscan stops at world geometry

### M4: Enemy

Done (2026-10-15). Enemy AI follows Quake's, infighting included (see `docs/ENEMIES.md`): spawning, the think cadence, noticing the player by sight, taking damage (pain, death, and enemies blocking the player), chasing with Quake's movetogoal, and shooting back (with a wind-up, aim lag, and Quake's infighting), with placeholder boxes in the game. The game shows getting hurt (Quake's red flash and view kick), shots hitting someone, and dying (Quake's dead view), and a press restarts the level. Golden demos work: R records one in the game (format in `demos/README.md`), CI replays every demo in `demos/`, and `npm run rebaseline-demos` remakes one after an intentional change. The first, a fight in `greybox_01` that kills both shotgunners, found that browsers and Node disagree on `Math.sin` and friends, so the sim now does its own trigonometry (see DECISIONS.md).

- States: idle, chase, attack, pain, dead. The reaction delay holds the first attack, as in Quake, rather than being a separate alert state.
- Infighting, as in Quake: an enemy hurt by another enemy turns on it, then returns to the player
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
- Golden demo: Ryan records a short fight in `greybox_01` with an in-game recorder; CI replays it against its per-tick state hashes

### Demo Playback

Done (2026-10-16): watching a demo in the game, to see what a golden demo does and where a failing one goes wrong. Playback presents the demo through the same events as play, so hurt flashes, marks, and enemies all show. The playback itself is `apps/game-client/src/game/demo-playback.ts`.

- Drag a `.demo.json` onto the game page to play it (in the dev server and in a release). A demo from another map reloads the page on that map first, from the file the demo was recorded on (the `.bsp`, or the `.map` with lighting off), carrying the demo across in the browser's session storage. If the map or data changed since it was recorded, the overlay says which, and playback starts paused.
- The camera follows the recorded view angles, smoothed between ticks like movement.
- Space pauses (and at the end plays again), the left and right arrows change speed (1/4x to 4x), and Escape leaves playback. Effects fade on playback time, so pausing freezes them.
- The overlay shows the time, the speed, and whether every tick's hash still matches the recording, flagging the tick where it first diverges, and what differs at the next keyframe where something still does (all of it in the browser console).
- Later: seeking, starting from the keyframes' full states.

### Console

Started (C1 done, 2026-10-17): a drop-down console, as in Quake, opened and closed with the backquote / tilde key. It's where commands with arguments go: recording and playing demos, loading maps, and cheats for testing levels and enemies.

Commands come in two kinds, because the sim's rules decide where each one runs:

- **Client commands** act on the session, outside the sim: `map <name>`, `maps`, `restart`, `record [name]`, `stop`, `playdemo <file>`, `help [command]`, `clear`, and settings such as `sensitivity <n>` and `brightness <n>`.
- **Sim commands** change game state, so they go into the sim as actions on a tick, beside that tick's input command, never by editing state from outside. That keeps them deterministic, and the demo format already has a place for them: they're recorded in a demo's `actions` and replay exactly. Each is a generic engine action with tests, and its state starts neutral (see `demos/README.md`). Quake's names where it had one: `god` (take no damage), `noclip` (fly through walls, along the view), `notarget` (enemies don't notice you), `kill` (die), `give <weapon>`, plus `killmonsters` (kill every enemy).

Steps:

- [x] C1 The console itself, drawn by the engine (see DECISIONS.md, "The game's UI is drawn by the engine"), which brings the 2D layer the HUD and menus will use too: bitmap-font text and quads over the scene, laid out in virtual pixels so it scales with the window now and with the low-resolution target in M5. It slides down over the top half of the view, releases the mouse, and takes the keyboard while open (the game pauses, as single player can). A command line with history (up and down), tab completion of command and map names, and scrollback (Page Up and Page Down). Commands are parsed as Quake did: words, with quotes for one that has spaces. The engine's messages go to it too (map loaded, demo saved, why a map is unlit), not only to the overlay and the browser console. The first client commands: `help`, `clear`, `map`, `maps`, `restart`, `record`, and `stop`; `record` replaces the R key. `map` loads a map in place instead of reloading the page, and `maps` needs the list of a game's maps: the dev server and a release's `games/index.json` say which maps each game has. Done: the 2D layer and the engine's font are in `packages/render` (`layer2d.ts`, `font.ts`: 5 by 9 glyphs in 6 by 10 cells, drawn in code; see DECISIONS.md), the console in `apps/game-client/src/game/` (`console.ts`, `console-view.ts`, `client-commands.ts`). The layer's virtual pixels are the most whole screen pixels that keep it at least 360 tall.
- [ ] C2 Sim actions: the sim takes a tick's actions along with its command, demos record and replay them, and the first actions are `god`, `noclip`, `notarget`, `kill`, `give`, and `killmonsters`, each with unit tests and, where it can be seen in play, a scenario. Noclip movement goes in `docs/MOVEMENT.md`.
- [ ] C3 With demo playback: `playdemo`, and settings that last between visits (stored in the browser).

Open questions: where a game supplies its UI art (status bar graphics, its own font), as Quake's came from `gfx.wad` (the engine's font is the fallback when a game has none); where a game's own demos live and how `playdemo` finds them (the golden demos are the engine's, in `demos/`); and whether settings become Quake-style cvars that `set` and the config can name.

### M5: Feel and Presentation

Mostly hands-on tuning by Ryan, with few tests.

- Low-resolution render target with upscaling
- Render presets: Software (nearest, palette quantization, fullbrights), 3dfx (bilinear, 16-bit ordered dither, Voodoo-style output filter), Modern
- Separate texture and lightmap filter options in a custom preset
- Stepped enemy animation at about 10 fps
- View bob, weapon sway, muzzle flash, impact effects, placeholder audio
- Minimal HUD, drawn with the 2D layer the console brings, replacing the HTML overlay's health and weapon line (the overlay stays, for developer info)

## Standalone Games

A game made with the engine lives in its own repo and installs one package, `mandreljs`, for a `mandreljs` command (see DECISIONS.md, 2026-10-14, "Games use the engine through one installed command"). The tools now work on a game folder anywhere (S1). `mandreljs` runs them as one command (S2), and `mandreljs dev` serves the built client without Vite (S3). `mandreljs build` writes a release (S4). The `mandreljs` package bundles it all (S5), and CI tests it as installed (S6). It's on npm from v0.0.1.

- [x] S1 Tools work on any game folder, still from source in this repo. `layout.ts` separates engine files (schemas, the shared FGD, light styles, pinned tool versions, later the built client), found relative to the tools themselves, from the game: the current folder if it holds `data/game.json`, otherwise `--game`, otherwise `example`. Compiled maps go to `<game>/build/`, ericw-tools to a per-user cache, and `install-trenchbroom` links the engine's FGD from wherever the engine is. Repo-only checks (scenarios, `check-files`, `make-placeholder-textures`, old-link cleanup) stay repo-only. Done when `compile`, `validate`, and `install-trenchbroom` work on a copy of `example/` outside the repo.
- [x] S2 One `mandreljs` command (`tools/src/mandreljs.ts`, the tools package's `bin`) with `dev`, `compile`, `validate`, `bspdump`, `setup`, and `install-trenchbroom`; the root npm scripts run it. `mandreljs build` arrives with S4. Inside this repo `mandreljs dev` runs Vite on the client's source.
- [x] S3 A dev server without Vite: the request handling (serving game files, compiling stale maps) is plain Node code in `tools/src/dev-server.ts`, shared by the Vite plugin and a plain server that serves the built client and the current game (`mandreljs dev --built`, and an installed engine). The server lists its games and the one to play at `/games/index.json`, and the client asks it instead of defaulting to `example`.
- [x] S4 `mandreljs build`: validates the game, builds the client (from source inside this repo), compiles maps at release quality, and writes the client with `games/index.json` and the game's data, textures, and compiled maps (not the `.map` sources) to `<game>/dist/`. The client and its assets use relative URLs, so a release works on any static host, even in a subfolder.
- [x] S5 The `mandreljs` package (`npm run package`, in `dist/mandreljs/`): `mandreljs` bundled into `bin/mandreljs.js` with Vite (with a source map), the built client, the defs (schemas, light styles, the shared FGD), pinned tool versions, the license files, and a README for game makers. No runtime dependencies; requires Node 24. It's packed into the `.tgz` a game's repo installs. Engine-file paths come from `engine-files.ts`, swapped for `engine-files.package.ts` in the bundle.
- [x] S6 CI packs the package, installs it into a scratch folder with a copy of `example/`, and runs `validate`, `compile`, `build`, and a `mandreljs dev` request (`npm run test:package`, `tools/src/test-package.ts`). The README and the package's README describe making a game with `mandreljs`.

Editors (particle editor, model viewer, and so on) join the same package later and are served by `mandreljs dev` next to the game; saving needs a write request that stays inside the game folder, validates, and accepts only the server's own pages.

## Testing

- **Unit tests** in Vitest (the sim runs in Node with no Three.js imports).
- **Scenarios** in /scenarios: each names a map, a start marker, a timeline of inputs, and expectations at given times (in seconds, converted to ticks by exact rules) with tolerances. They are engine-neutral, so a future port must pass them too. Format and conversion rules are in scenarios/README.md.
- **Golden demos** in /demos: recorded inputs plus keyframe snapshots and a per-tick state hash, with a copy of the /data files they were recorded with. CI replays them with that copy and fails at the first divergent tick, so tuning /data never breaks a demo; only code changes can. After an intentional code change, a command rebaselines a demo from its recorded inputs. Demos are only valid at the tick rate they were recorded with, so any tick rate experiments (such as 35 Hz) happen before recording goldens.
- **Compile check**: CI compiles every map in fast check mode and fails on leaks, missing textures, or errors. It is part of the single CI job (see DECISIONS.md).
- **Visual smoke tests**: Playwright screenshots per map.

## Input Commands

The sim's only input is one command per tick, in an engine-neutral format used by the game, scenarios, and demos. Values are quantized so replays are exact. The schema is `scenarios/schemas/input_command.schema.json`:

- View angles are absolute, not deltas: yaw and pitch as 16-bit integers, 65536 units per full turn (Quake's scheme). Yaw 0 faces +x (east) and increases counterclockwise; pitch is positive looking up. Presentation accumulates mouse input at full precision and quantizes when building the command.
- Movement: forward and side as integers from -127 to 127 (positive is forward and right), scaled to max speed by the sim.
- Buttons: a bitfield (1 = attack, 2 = jump).
- Weapon select: 0 for no change, otherwise a weapon slot number.

## Open Decisions

- For standalone games (above): whether `example/` gets a `package.json` so it doubles as a starter template, or a separate starter repo does that. (A release from `mandreljs build` holds only its own game, so `?game=` can't load another one there.)
