# Decisions

Decisions and their reasons, newest first. Each entry records what was decided, why, and what was considered instead.

## 2026-10-12: Godot setup: our own parser and meshes, a 64-bit vector, gdUnit4 installed by setup.py

**Decision:** The Godot build of M1 follows the web build's structure:

- Level meshes come from our own `.map` parser, not the func_godot addon.
- Sim math uses `Vec3`, a 64-bit vector class, instead of Godot's `Vector3`.
- Tests use gdUnit4 6.2.1, pinned in `tools/versions.json` and installed by `tools/setup.py` into a gitignored `godot/addons/gdUnit4`, the same way as ericw-tools. CI pins the Godot 4.7.2 Linux build by checksum.

**Why:**

- The sim needs our own parser for collision anyway. With func_godot drawing the level, Godot would have two `.map` parsers that could disagree in small ways (texture projection, plane precision, epsilons), so what you see and what you collide with could drift apart. M2 draws the lit world from `.bsp` faces, which func_godot doesn't read, so its meshes would be replaced a milestone later. Porting the web build's mesh code (about 150 tested lines) also keeps the engine comparison like for like. Its config (entity definitions, texture paths) would also duplicate our FGD and `textures/` layout.
- Official Godot builds have 32-bit `Vector3`. The web sim does its math in 64-bit numbers, and the shared scenarios and fixtures are checked against those results.
- gdUnit4 is 300+ files; installing it keeps third-party code out of the repo and pinned like our other tools.

**Trade-offs:** No preview of maps in Godot's editor viewport (a tool script could add one later). `Vec3` allocates an object per operation, which is slower than `Vector3`; fine for M1, worth measuring if movement or traces show up in profiles.

**Alternatives considered:** func_godot for meshes (above); a double-precision Godot build (custom engine builds for every platform and for CI); vendoring gdUnit4 into the repo; GUT, the other common GDScript test framework (also MIT, but gdUnit4 has a maintained headless runner for CI).

## 2026-10-12: Keep a commercial option open: public code, separable content

**Decision:** This repo holds all code, tools, schemas, test maps, and placeholder content, all under the GPL, and is meant to be public when the project is ready (it's private for now). If Hollow Coil becomes a commercial product, its final content (maps, textures, audio, music, and final tuning data) will live in a separate private repo with its own license. Nothing changes yet, but new work must keep that split possible:

- Engines and tools load content from a content directory (a game directory, like Quake's `id1/`) passed in or configured, with the repo root as the default. Don't hardcode the repo root as the only place content can come from.
- Content is data only: maps, images, audio, and JSON. No code (scripts, GDScript attached to scenes, map scripting) goes into content; it belongs in this repo under the GPL.
- This repo stays buildable and playable on its own, with free content such as the test maps and possibly a small free episode later.
- The project's name and logo may be protected as trademarks, which the GPL doesn't cover.

**Why:**

- This is how id Software shipped Quake after releasing its source under the GPL: the engine is free, and what people buy is the game data. The code and setup docs being public doesn't get in the way of selling content.
- Under the usual reading of the GPL, data loaded at runtime is a separate work that can have its own license, but code that runs with the engine is covered by the GPL. Keeping code out of content is what makes the split hold up.
- Anything published under the GPL stays available under it, even if the repo goes private again. The deadline for deciding where an asset lives is before it's committed, so the split has to be planned before real art and levels arrive.
- Making the content path configurable is cheap now and expensive once both engines and all the tools assume one layout.

**Not yet decided:** The license for free content in this repo (for example CC BY-SA), whether the final levels count as commercial content or stay free, and whether to ask contributors to sign a CLA. Get a short consult with a lawyer who knows open-source licensing before selling anything.

**Alternatives considered:** Keeping the code private for good (loses the open-source goal); everything in one public repo under the GPL (gives up selling content); a non-free license for the code (rejected when GPLv3 was chosen).

## 2026-10-12: Built with agentic coding; players' content is human-authored

**Decision:** Most of the code is written with an AI coding agent (Claude Code), and a human reviews every change before it's committed. The content players experience is human-authored: levels made by hand in TrenchBroom, plus the weapon and enemy tuning, encounter design, and art direction. The README says this openly.

AI-generated art and other assets aren't ruled out, but they're decided case by case under these rules, until a fuller asset policy is written when real art enters the project:

- A human sets the art direction, and generated material has to fit it. Defaults don't ship just because a model produced them.
- Generated material is curated and edited, not accepted as is.
- Provenance is recorded for every asset (hand-made, AI-assisted, or AI-generated, and with which tool), so store disclosures and licensing questions can be answered later without guesswork.

**Why:**

- Agentic coding does well on plumbing that has strong references to check against: the `.map` parser, brush bevels, box traces, movement ported from GPL Quake sources, and tooling. That frees time for the hand-made work that gives a game its character.
- Much of the backlash against AI in games is about generated content replacing craft. Keeping levels and design hand-made is the point of the project (see Design Principles in CLAUDE.md).
- Being open about it is more honest than leaving people to find out.
- The game isn't currently meant to be a commercial product, but GPLv3 keeps that option open. Under current US law, purely AI-generated output generally can't be copyrighted, which would weaken any later plan to sell assets separately from the code. Recording provenance keeps that question answerable.

**Alternatives considered:** Not mentioning AI use (dishonest, and would surface eventually); banning AI-generated assets outright (premature, since the asset pipeline doesn't exist yet and some uses, like AI-assisted texture cleanup, may be reasonable); allowing anything (risks the generic look the project is trying to avoid).

## 2026-10-12: Steep slopes can't be climbed (a departure from QuakeWorld)

**Decision:** When the player rests against a surface too steep to stand on, air acceleration can't push into it (the horizontal into-surface part of the wish is removed), and walking slides treat such surfaces as vertical walls. Details in docs/MOVEMENT.md, Steep slopes.

**Why:** Playtesting the first web build showed that holding forward slowly climbs the 63° slope in `test_movement`. That follows from QuakeWorld's formulas: air acceleration into the slope outweighs gravity on slopes up to about 66° at 60 Hz. It was hidden until the slide-stall fix, because the stall kept zeroing the velocity. Blocking only the air push left a 12 Hz, half-unit hop at the foot of the slope (walking still pushed into it), so walking slides treat steep surfaces as walls too. Air strafing everywhere else is unchanged.

**Trade-offs:** Running into a steep slope at speed no longer bumps the player a few units up it before they slide back. Movement there is slightly less faithful to QuakeWorld, which the feel pass in M5 can revisit.

**Alternatives considered:** Keeping QuakeWorld's behavior (authentic, but surprising in play); handling it in level design only, with slopes steeper than 66° or clip brushes (leaves the behavior in the engine for mappers to trip over); lowering the air wish speed cap (would weaken air strafing everywhere).

## 2026-10-11: Data validation with our own JSON Schema subset; player.json

**Decision:** `tools/validate.py` validates `data/*.json` with a small built-in implementation of the JSON Schema keywords our schemas use, and rejects any other keyword. Player health, hull, eye height, loadout, and movement constants live together in `player.json` (the plan originally named a `movement.json`).

**Why:**

- The `jsonschema` package pulls in several dependencies, including a compiled Rust extension, which would add pip installs to CI and every developer machine. The tools are standard library only by default.
- Rejecting unknown keywords means a schema can never silently check less than it looks like it does. The schemas stay standard JSON Schema, so editors still validate the files in full.
- Health and the collision hull are not movement, but they describe the same player; one file keeps the player's definition in one place.

**Alternatives considered:** The `jsonschema` package (full spec, but heavy dependencies); hand-written checks without schemas (no editor support, and the rules would live only in code).

## 2026-10-11: The repo root is the game root (textures/ next to maps/)

**Decision:** Textures live in a top-level `textures/` folder beside `maps/`, so the repo root is the game root. TrenchBroom's game path and the compilers' `-basedir`/`-gamedir` point at the repo root. This replaces the earlier `maps/textures/` location.

**Why:** ericw-tools and Quake-family tools assume the standard layout: the folder containing `maps/` is the game folder, with `textures/` beside it. Tools that infer paths from a map's location, such as lightpreview's viewer, which ignores path options, couldn't find textures under `maps/textures/`. With the standard layout, qbsp finds every texture with no path options at all.

**Alternatives considered:** Keeping `maps/textures/` and passing paths everywhere (works for our scripts but not for tools that infer paths); a link from `textures/` to `maps/textures/` (fragile on Windows and confusing).

## 2026-10-11: CI compiles maps in check mode, only when maps change

**Decision:** `tools/compile.py` has two lighting modes: `check` (fast, the default) and `release` (full quality, `-extra4`). CI compiles every map in check mode, in a separate `maps.yml` workflow that runs only when map-related files change (maps, textures, the compile and setup scripts, the tool versions). Release builds run locally or through a manual run of that workflow, which uploads the .bsp files as an artifact. Compiled-output caching is deferred until the number of maps makes it worthwhile.

**Why:**

- The repo is private on GitHub's free plan, with 2,000 CI minutes a month, and each job rounds up to a whole minute. Quake-era compiles get slow as maps grow, mostly from high-quality lighting (vis is already skipped).
- Almost every way a map breaks (leaks, missing textures, bad brushes) is caught by qbsp, which is fast. Lighting quality doesn't affect whether a map is valid.
- Docs-only and engine-only commits don't need map compiles at all.
- If the repo goes public, GitHub's standard runners are free and this matters much less.

**Alternatives considered:** Compiling everything at full quality on every push (simple, but minutes scale with map count and size); compiling only changed maps by diffing against the base commit (fragile when textures or tools change; caching by content hash is the better version of this, later).

## 2026-10-11: Quake 2 map and .bsp formats, with loose PNG textures

**Decision:** Maps are authored in TrenchBroom's Quake 2 (Valve) format and compiled with `qbsp -q2bsp` to Quake 2 .bsp files (IBSP v38). Textures are loose PNGs at `textures/<folder>/<name>.png`. Gameplay stays Quake 1 style; only the file formats come from Quake 2. This settles three open decisions: texture format, colored light storage, and the collision source for .bsp builds.

**Why:** We compiled the same test room (walls, a pillar, a ramp with a sloped plane, three lights, two of them colored) three ways with ericw-tools 2.0.0-alpha11 and opened the results in TrenchBroom 2026.2:

| | Quake 2 + loose PNGs (chosen) | Quake 1 + WAD | Quake 1 + loose PNGs |
|---|---|---|---|
| Textures | Referenced by name; engine loads full-color PNGs | 8-bit copies embedded in the .bsp, quantized to a 256-color palette | qbsp cannot find them in any layout |
| Texture names | Up to 32 characters, folders | Up to 15 characters, flat | n/a |
| Build step | None | PNG to WAD conversion with palette quantization | n/a |
| Collision data | Native brushes and sides, including bevel planes added by qbsp | BSPX BRUSHLIST via `-wrbrushes`: exact brushes, no bevels | Same as Quake 1 + WAD |
| Colored light | Native RGB lightmaps | `.lit` file or BSPX RGBLIGHTING (both worked) | Same as Quake 1 + WAD |
| TrenchBroom | Works with a custom config (`"extensions": [".png"]`) | Works with a custom config and our own palette | Not tested |

- Quake 2 gives everything we need with no extra build step, and textures stay ordinary PNGs in git that any image editor can open.
- The bevel planes help directly with box-versus-brush collision, the hardest part of M1.
- The Quake 1 WAD route works, but visibly shifts texture colors (the palette quantization was obvious in TrenchBroom) and limits names to 15 characters with no folders.

**Notes for implementation:**

- qbsp only warns about missing textures in Quake 2 mode, so the compile script must treat that warning as an error.
- Quake 2 lightmaps came out about 3x brighter than Quake 1 for the same light values; calibrate in M2.
- ericw-tools also writes `.texinfo.json`, `.content.json`, `.prt`, and `.log` files next to the output.
- TrenchBroom picks the game config from the `// Game:` comment at the top of a .map, so it must match our config's name exactly.
- Optional `.wal_json` files next to textures can set per-texture defaults (contents, surface flags, light value) later.

**Alternatives considered:** Quake 1 + WAD (works, but adds a lossy conversion step and name limits); Quake 1 + loose PNGs (qbsp doesn't support it); always loading collision from the .map alongside the .bsp (unnecessary now that the .bsp has brushes).

## 2026-10-11: Tools are Python, with pinned versions

**Decision:** Scripts in /tools are written in Python using the standard library. Third-party tool versions live in `tools/versions.json`. ericw-tools is downloaded by `tools/setup.py` into a gitignored `.tools/` folder, checked against a pinned SHA-256, and verified by its version banner. Godot and TrenchBroom are installed by each developer and are not pinned for now.

**Why:**

- The tools must outlive whichever engine loses the spike, so they shouldn't depend on either engine's stack.
- Python's standard library covers downloads, zip extraction, checksums, and binary .bsp parsing, and Python is preinstalled on CI runners.
- ericw-tools output (geometry, lighting, leak detection) can change between versions, so map compiles must use exactly the same build everywhere. Godot and TrenchBroom versions matter less: TrenchBroom only edits .map text, and a Godot version check can be added if the Godot build continues past the spike.

**Alternatives considered:** Node/TypeScript (same language as the web build, but ties shared tools to the web stack and needs a dependency for zip extraction); shell scripts (every tool written twice, for PowerShell and bash).

## 2026-10-11: Input commands are quantized

**Decision:** Per-tick input commands store view angles as absolute 16-bit integers (65536 units per turn), movement as integers from -127 to 127, buttons as a bitfield, and weapon select as a slot number. The format is shared by both engines. Details are in PLAN.md under Input Commands.

**Why:** Demos and scenarios replay recorded commands, so the commands must survive being saved and loaded with no rounding drift. Integers are exact in JSON and in both engines. Absolute angles avoid errors piling up the way summed deltas would. Quake used the same approach.

**Alternatives considered:** Floating-point angles and movement: simpler at first, but text round-tripping and float differences between engines make exact replay fragile.

## 2026-10-11: Golden demos are recorded per engine

**Decision:** Each engine records and replays its own golden demos (/demos/web, /demos/godot). Cross-engine agreement is checked by the shared /spec scenarios with tolerances.

**Why:** The web build does math in 64-bit floats while Godot's vectors are 32-bit, so state hashes diverge from the first tick. Making them match would mean rounding state before every hash or writing custom math in both engines, which is a lot of effort for a spike where one engine will be dropped.

**Alternatives considered:** One shared demo set with state rounded before hashing: fragile, because rounding boundaries can still differ between engines, and it hides small real differences.

## 2026-10-11: License is GPLv3 or later, with a platform SDK exception

**Decision:** Code is licensed under the GNU GPL v3 or later. A section 7 additional permission allows linking with platform SDKs such as Steamworks and console SDKs. Final game assets may get a separate license later; until then, everything in the repo is under the GPL.

**Why:**

- Nobody, including a fork, can take the code closed-source. That matters more to us than maximum reuse.
- It still allows a commercial release: the code stays open while the final assets can be sold, the way id Software released the Quake engine while keeping the game data commercial.
- Quake's source is GPLv2 or later, so we can study and adapt it directly, with credit. The same goes for ericw-tools.
- The platform exception keeps Steam features and console ports possible. It is included from the start because adding it later would need every contributor's agreement.

**Alternatives considered:**

- MIT: easiest for reuse and console ports, but allows closed-source forks, which we don't want.
- MPL-2.0: modified files must stay open, but closed files can be added around them, so closed versions are still possible.
- AGPLv3: also covers modified versions run on servers. It adds little for a single-player game and some contributors avoid it. Worth revisiting if multiplayer or hosted services happen; GPLv3 code can be combined with AGPLv3.

**Open:** The exception wording follows the FSF's template for additional permissions but has not been reviewed by a lawyer.
