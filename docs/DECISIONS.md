# Decisions

Decisions and their reasons, newest first. Each entry records what was decided, why, and what was considered instead.

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
