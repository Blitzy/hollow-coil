# Enemies Reference

The game implements enemies exactly as described here, and so must any future port, so that engine differences never become behavior differences. When the code and this document disagree, fix one of them; don't let them drift. The code is in `packages/sim/src/enemy/`: `enemy.ts` (state, data, spawning), `ai.ts` (thinking, sight, and chasing), `move.ts` (stepping, turning, and choosing a direction), and `damage.ts` (taking damage).

M4 is building enemies in stages; this document covers what exists so far: spawning, the think cadence, noticing the player, taking damage, and chasing. Attacks will follow.

## Sources

Adapted from Quake's QuakeC (id Software, GPLv2 or later): `droptofloor` for spawning; `FindTarget`, `range`, `infront`, `visible`, and `HuntTarget` in `ai.qc` for sight and reacting; `T_Damage` in `combat.qc`, multi-damage in `weapons.qc`, and the monsters' `pain_finished` check for damage and pain; and `sv_move.c` (`SV_movestep`, `SV_CheckBottom`, `SV_StepDirection`, `SV_NewChaseDir`, `SV_CloseEnough`, `SV_MoveToGoal`) with `PF_changeyaw` for chasing. Sight passes through windows, following Quake 2's `MASK_OPAQUE`. See DECISIONS.md (2026-10-14, "Enemy AI follows Quake's") for why.

## Conventions

- **Data:** `data/enemies.json`, one entry per enemy type. Every duration converts to ticks with `ticks(t) = floor(t * TICK_RATE + 0.5)`: at 60 Hz the shotgunner thinks every 6 ticks and has a reaction delay of 36. Its `run_speed` gives a step of `run_speed / TICK_RATE` each tick (1.83 units) and a think step of `run_speed * think_ticks / TICK_RATE` (11 units). Its `turn_speed` (degrees per second) gives a turn of `round(turn_speed * 65536 / 360 / TICK_RATE)` angle units per tick (607).
- **Masks:** an enemy's movement is blocked by `SOLID | WINDOW | MONSTERCLIP | MONSTER`; its sight only by `SOLID`.
- **Eyes:** an enemy's eye is `origin + (0, 0, eye_height)`, and the player's is `origin + (0, 0, player.eye_height)`.

## Spawning

Each map entity whose `classname` matches an enemy type's `classname` spawns one enemy of that type, in entity order. Starting 1 unit above the entity's origin (like the player's spawn, because a box placed touching the floor counts as inside it), trace the enemy's hull straight down 256 units with its movement mask. If the trace hits something without starting inside a brush, the enemy starts at the trace's end point, standing 1/32 above the floor. Otherwise it starts at the entity's origin. Its facing is the entity's `angle` (degrees, 0 = east), converted to angle units.

Enemies get entity ids after the player's (1), in spawn order: 2, 3, and so on. A new enemy has full health, mode `idle`, and no target.

## Think cadence

An enemy makes decisions only on its think ticks. The enemy at index `i` among the level's enemies (counting from 0) first thinks on tick `1 + (i mod think_ticks)`, then every `think_ticks` ticks after that. So a level's first six shotgunners each think on a different tick of every six.

## Noticing the player

On a think tick, an `idle` enemy looks for the player. It sees the player's eye if all three hold:

1. **Range:** the distance from its eye to the player's eye is at most `sight_range`.
2. **View cone:** the angle between its facing (a horizontal vector from its yaw) and the direction to the player's eye is at most half of `field_of_view`. In other words, `dot(facing, direction) >= cos(field_of_view / 2)`.
3. **Line of sight:** a point trace from its eye to the player's eye with the sight mask reaches the end (`fraction == 1`).

When it does, it switches to mode `chase`, sets its target to the player, and allows its first attack only from `tick + reaction_ticks` (Quake's `HuntTarget` delays the first attack, not the chase). It emits `{ type: "sighted", entity, target }`.

## Damage

A shot's pellets are all traced first (see `docs/WEAPONS.md`, Hitscan), against the living enemies' boxes. Then each enemy hit takes the total damage of the pellets that hit it, once, in the order each was first hit (Quake's multi-damage). So a shotgun blast is one hit. Taking damage, an enemy:

1. Loses `amount` health and emits `{ type: "damaged", entity, attacker, amount, health }`.
2. If its health is 0 or less, switches to mode `dead` and emits `{ type: "died", entity, attacker }`. Nothing else happens.
3. If the attacker isn't its current target (and isn't itself), turns on it as on first sighting: target the attacker, allow its first attack only from `tick + reaction_ticks`, switch from `idle` to `chase`, and emit `sighted`. (Infighting rules for enemies hurting enemies come with enemy attacks.)
4. If the tick is at or after `painUntil`, draws one value from the RNG; if it's below `pain.chance`, switches to mode `pain` with `painUntil = tick + pain_ticks` and emits `{ type: "pain", entity }`. While still flinching, it neither rolls nor flinches again.

Damage reactions happen when the damage lands, not on think ticks; only the AI's own decisions wait for a think. A flinching enemy does nothing until its first think at or after `painUntil`, when it goes back to `chase` (or `idle`, if it has no target).

The dead never think, can't be hit, and don't block movement.

## Chasing

A chasing enemy chooses a heading on its think ticks and moves every tick, toward its quarry (so far, always the player). Angles are in angle units; an eighth turn (45 degrees) is 8192.

**Stepping** (Quake's `SV_movestep`): to step by a horizontal `move`, take `dest = origin + move`. Trace the enemy's hull from `dest + (0, 0, 18)` down to `dest - (0, 0, 18)` through the blockers (the world plus every other living entity's box, the player's included) with its movement mask.

- If the trace is all solid, the step fails.
- If it starts solid (no room a step up), trace again from `dest` down to `dest - (0, 0, 18)`; if that starts or is all solid, the step fails.
- If it hits nothing, the step fails: there's no floor within a step below, so it would walk off an edge.
- Otherwise the enemy would stand at the trace's end point, if the floor check passes there; else the step fails.

Only the destination is tested, so one tick's step must stay shorter than the thinnest wall (it's under 2 units now).

**The floor check** (Quake's `SV_CheckBottom`), against the world only: from the bottom of the box at its center, trace a point down 36 units. If it hits nothing, fail; call the height it hit `mid`. Then do the same from each of the box's four bottom corners: fail if any hits nothing or hits more than 18 below `mid`. So an enemy never stands with a corner over a drop of more than a step. Since an enemy never steps where it can't stand, it never leaves the ground and needs no gravity.

**Turning** (Quake's `PF_changeyaw`): turn `yaw` toward `idealYaw` the short way, by at most the turn per tick.

**Each tick**, a chasing enemy with `moving` set turns, then, if its facing is within 45 degrees of `idealYaw`, steps `run_step` toward `idealYaw` (Quake's `SV_StepDirection`). If the step fails, it clears `moving` and stands until its next think.

**On a think** (Quake's `SV_MoveToGoal`), a chasing enemy chooses a heading. A candidate heading works if a step of `think_step` that way would succeed from where it stands.

1. If its box and the quarry's, each grown by 1 unit on every side (Quake's `absmin` and `absmax`), come within `think_step` of each other on every axis, it's close enough: clear `moving`.
2. Otherwise draw a random value `r`. Unless `floor(r * 4) == 1` (one think in four), keep `idealYaw` if it still works.
3. Otherwise pick a new heading (Quake's `SV_NewChaseDir`), below. If it finds one, set `idealYaw` to it and set `moving`; if not, snap `idealYaw` down to its eighth turn and clear `moving`.

**A new heading:** let `olddir` be `idealYaw` rounded down to an eighth turn, `turnaround` the opposite of `olddir`, and `delta` the quarry's origin minus the enemy's. Let `dx` be east (0) if `delta.x > 10`, west (180) if `delta.x < -10`, else none; and `dy` be north (90) if `delta.y > 10`, south (270) if `delta.y < -10`, else none. Never try `turnaround` before the last step.

1. If both `dx` and `dy` are set, try the diagonal between them (45, 135, 225, or 315). Quake's code has 215 for south-west, a known typo; we use 225.
2. Draw a random value; if it's below 0.5, or `|delta.y| > |delta.x|`, swap `dx` and `dy`. Try `dx`, then `dy`.
3. Try `olddir`.
4. Draw a random value; if it's below 0.5, try every eighth turn from 0 up to 315, else from 315 down to 0.
5. Try `turnaround`.

Random values come from the sim's RNG, drawn only when the steps above reach them.

Quake's navigation is simple on purpose: with no pathfinding, an enemy can jitter against an obstacle and wander off. Levels are built with that in mind, as in the era.

## Order within a tick

The player moves (blocked by living enemies) and fires first, and the shot's damage is applied. Then each enemy updates, in spawn order: a think if it's a think tick, then a tick of movement. Each sees the player where they ended up this tick, and the enemies before it where they've moved to.

## State

| Field | Meaning |
|---|---|
| `id`, `type` | Entity id and enemy type. |
| `origin`, `yaw` | Position and facing (angle units). |
| `idealYaw` | The heading it turns toward and steps along. |
| `moving` | Whether it has a heading to step along until its next think. |
| `health` | Starts at the type's `health`. |
| `mode` | `idle`, `chase`, `pain`, or `dead` so far. |
| `nextThink` | The tick of its next decision. |
| `target` | The entity it hunts, or 0. |
| `attackReadyAt` | The first tick it may attack. |
| `painUntil` | The tick its pain stun ends. |

## Required tests

- Spawning: standing on the floor, dropping from the air, staying put with no floor in reach, and the real maps' enemies where they were placed.
- Decisions happen only on an enemy's think ticks, and enemies with different offsets think on different ticks.
- Sight respects range, the view cone, and walls (not windows), including that `test_combat`'s east shotgunner can't see the player at `west` through the center wall.
- A shot's pellets add up into one hit; an enemy dies at zero health and stops acting; the dead can't be hit and don't block.
- Pain follows its chance, stuns for its time, can't repeat while stunned, and ends on a think.
- A living enemy blocks the player.
- Stepping climbs steps up to 18 and refuses higher ones, steps down, refuses walls and edges, and never leaves a corner over a drop of more than a step; turning goes the short way; a new heading follows the order above.
- A chasing enemy picks its heading only on think ticks but moves every tick.
- Scenarios: an enemy follows the player up `test_movement`'s 18-unit step and stops close, and one gets around `test_combat`'s low cover. On every tick of every scenario, no enemy is inside the world.
