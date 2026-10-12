# Decisions

Decisions and their reasons, newest first. Each entry records what was decided, why, and what was considered instead.

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
