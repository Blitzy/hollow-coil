# Decisions

Decisions and their reasons, newest first. Each entry records what was decided, why, and what was considered instead.

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
