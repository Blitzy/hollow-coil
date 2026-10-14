# Decisions

Decisions and their reasons, newest first. Each entry records what was decided, why, and what was considered instead.

## 2026-10-13: Tools are TypeScript, run with plain node

**Decision:** Every tool in `/tools` is TypeScript (`tools/src/`, tested with Vitest in `tools/tests/`), run directly by Node 24, which strips types itself, so there is no build step and Python is no longer needed. To make that work everywhere, the tsconfig sets `erasableSyntaxOnly` (no enums, namespaces, or constructor parameter properties) and relative imports end in `.ts`. Logic other apps need lives in packages, with the tool as a thin wrapper: data validation is `packages/data` (browser-safe, for editors), and `bspdump` reads files with the game's own `.bsp` reader. ericw-tools is still pinned and checksummed in `tools/versions.json`; `setup` unpacks it with a small zip reader on `node:zlib`, so there are still no dependencies.

**Why:**

- With one TypeScript engine, the old reason for Python (keeping tools independent of whichever engine lost) is gone, and the reasons have flipped. Sharing code beats keeping it separate: one `.bsp` reader instead of two, and a validator that editors in the browser can run before saving. The planned mod packager needs compiling and validation from a web or Electron app too.
- One toolchain: contributors and mappers need only Node. CI no longer installs Python, and the dev server compiles maps by calling the compile module instead of spawning Python.
- Each port was checked against the Python original before it was deleted: identical output on the real data, maps, and compiled `.bsp` files; the Python tests ported to Vitest; deliberate mutations caught; a real download and unpack of the pinned ericw-tools archives (including the Linux build's executable bits); and identical fixture values from the generators. The fixture generator for the `.bsp` reader still parses the file with its own code, so it stays an independent oracle.

**Trade-offs:** Node's zlib and Python's compress differently, so rerunning the placeholder texture generator rewrites 7 PNGs with identical pixels but different bytes; and ericw-tools' `light` isn't byte-deterministic, so regenerating the `.bsp` fixture changes lightmap bytes. Neither has been regenerated; do so only when the inputs change.

**Alternatives considered:** Keeping Python (works, but duplicates the format code and can't run in editors); a TypeScript runner like tsx (a dependency, and unnecessary now that Node strips types); a zip library such as fflate (works, but the format subset we need is about a hundred lines on `node:zlib`).

## 2026-10-13: One repo of apps and packages (npm workspaces)

**Decision:** The TypeScript code is an npm workspace, set up now, before there is a second app:

- `apps/` holds things you run. `apps/game` is the game; editors and tools (particles, models, sounds, demo inspector, and so on) will each be an app.
- `packages/` holds shared libraries: `sim` (simulation and file formats), `render` (Three.js presentation), `dev-server` (the Vite plugin that serves game files and compiles stale maps), and `testing` (Node-only test helpers).
- Packages export their TypeScript source directly (`@hollow-coil/sim/map/bsp`), so there is no build step between them. One root `package.json`, `tsconfig.json`, and `vitest.config.ts` cover everything, and root scripts are the single entry point for project commands, including the Python tools.
- The repo's files stay the source of truth. Editors read and write `data/`, `maps/`, and `textures/` (through the dev server in development), and what they save must pass `tools/validate.py`. Only `apps/game` ships to players.

**Why:**

- Editors should show exactly what the game shows. Sharing `render` and `sim` as packages makes that the default.
- The sim's isolation becomes structural: `packages/sim` depends on nothing, and its own tsconfig still checks it with only the ES library.
- npm workspaces are built into npm: no new dependency or tool to learn.
- Moving now, while the code is small, is cheaper than moving later. The move changed no code behavior: the production bundle came out byte-identical, and the lockfile kept every third-party version.

**Alternatives considered:** One Vite app with several HTML pages (simpler, but package boundaries would be convention only); monorepo tools like Turborepo or Nx (caching and task graphs we don't need at this size); waiting until the first editor (cheap either way, but Ryan preferred to be ready).

## 2026-10-13: User-made levels are a design goal

**Decision:** Players should be able to make and play their own levels, as with 90s shooters. The pieces we build for ourselves double as the modding kit: the TrenchBroom game config and FGD, the base textures, and `tools/compile.py` with pinned ericw-tools. Later milestones should keep this working:

- **Packages are data only:** a zip (like Quake 3's `.pk3`) holding `maps/`, any custom `textures/`, and possibly `data/` overrides. Never code: running user code in a browser or Electron app is a real security risk. This matches "content is data only" in the content separation entry below.
- **Every file from a user is untrusted.** Parsers (`.map`, `.bsp`, PNG, JSON) must reject bad input with an error rather than crash or read out of bounds.
- **On the web:** load a package by drag and drop or a file picker, keep installed packages in browser storage (IndexedDB or the Origin Private File System), and later perhaps load from a URL or a community hub.
- **On desktop (Electron):** a `mods/` folder scanned at startup, layered over the base content through the content search path. Steam Workshop is possible through steamworks.js.
- Mappers can test layout and movement on an uncompiled `.map` (unlit, full collision), and compile only for lighting. TrenchBroom's launch button can start the game on the map being edited.

**Why:** Making and sharing levels is a big part of what made the era's shooters last, and our Quake-style pipeline already supports it. The web makes sharing easier than it ever was: a level can be a link.

**Alternatives considered:** No modding support (simpler, but gives up something central to the genre); scripted mods (far more powerful, but untrusted code in a browser or Electron app is a security problem we don't want).

## 2026-10-13: The web build is the engine; Godot is dropped after M1

**Decision:** Continue on the web build (TypeScript + Three.js) only. Desktop releases, such as for Steam, will wrap the web build in Electron. The Godot implementation is removed from the repo; its last complete version is commit `f56ed69` ("feat(godot): render levels and make the slice playable") if it's ever needed.

**How they compared at M1.** Both engines built the same slice from the same maps, data, and scenarios.

- **Correctness:** both passed the three verified `/spec` scenarios unchanged. The sims turned out bit-for-bit identical: the same inputs produced the same state hashes in both engines, on Windows and in Linux CI, including 10 seconds of running, turning, strafing, and jumping. The port needed no algorithm changes.
- **Feel:** in Ryan's playtest, movement, mouse look (raw input on the web, captured mouse in Godot), smoothness, and latency were indistinguishable.
- **Iteration speed:** on the web, saving a map in TrenchBroom and reloading the page shows it lit, because the dev server compiles stale maps in about 0.1 seconds. Godot needed a scene restart and had no lit pipeline yet, though one could be built.
- **Test ergonomics:** the web runs 166 tests in about 1 second; Godot ran 106 in about 30 seconds, mostly gdUnit4's roughly 93 ms per test. CI jobs took similar time (13 to 17 seconds against 17 to 24).
- **Agent reliability:** the web needed fewer corrections. Godot work hit collisions with built-in type names (`Plane`, `Projection`), a precision bug in Godot's JSON parser (it reads some 17-digit floats back one bit off), the editor rewriting `.uid` and `.tscn` files during edits, and more GDScript ceremony (typed-array conversions, no tuples).
- **Editor value:** our authoring is TrenchBroom and JSON, and sim state lives in plain data, not scene nodes, so the Godot editor added little. Its UI, animation, particle, and audio tools went unexplored, but the game's needs there are small and era-style, and simple tools can be built into the web build.
- **Distribution:** a web visit downloads about 0.7 MB (142 KB of code gzipped plus 530 KB of content), against about 10 MB for Godot's web export. For desktop, Godot is smaller: about 38 MB zipped on Windows against about 158 MB for Electron 44. Consoles realistically need a native engine.

**Why web:** the engines tied on correctness and feel. The web build is ahead on browser reach, test speed, iteration, and agent reliability. Godot's real advantages, consoles and smaller desktop builds, aren't needs today.

**Desktop route:** Electron. It bundles one Chromium, so every player runs the same engine: the same behavior, the same float math (which settles cross-browser determinism for desktop), real fullscreen, no browser-reserved shortcuts, and Steam integration through steamworks.js. Precedents include the Three.js shooter Krunker's Steam client, Vampire Survivors (built in Phaser before a later Unity port for consoles), and CrossCode (NW.js). Tauri was ruled out because it uses each OS's own web view, which means WebKit on macOS and Linux.

**Revisit if:** a concrete console plan appears, or UI, animation, or particle tooling proves too costly to build. The sim's portability is proven: it moved to GDScript in three chunks and matched bit for bit, checked by the `/spec` scenarios, the RNG reference values, and state hashes. A future native port (Rust compiled to both WebAssembly and native, or a native host running the sim in an embedded JavaScript interpreter) would be checkable the same way.

**Supersedes:** "Golden demos are recorded per engine" (one engine now) and "Godot setup" below.

**Alternatives considered:** Godot (above); both engines, Godot for desktop and the web build for browsers (two codebases to keep in step); native JavaScript runtimes with their own windows, such as Deno with WebGPU or Node with SDL bindings (promising but unproven for shipped games); Rust; a custom engine on SDL (a renderer, audio, input, and platform layer to write and maintain).

## 2026-10-12: Godot setup: our own parser and meshes, a 64-bit vector, gdUnit4 installed by setup.py

*Superseded on 2026-10-13: Godot was dropped after M1 (see above). Kept for the record.*

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

*Superseded on 2026-10-13: the tools are TypeScript now (see above). The pinning approach (versions.json, checksums, version banner) carried over unchanged.*

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

*Superseded on 2026-10-13: the web build is the only engine. As it turned out, the two sims were bit-for-bit identical anyway.*

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
