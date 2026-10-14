# Enemies Reference

The game implements enemies exactly as described here, and so must any future port, so that engine differences never become behavior differences. When the code and this document disagree, fix one of them; don't let them drift. The code is in `packages/sim/src/enemy/`: `enemy.ts` (state, data, spawning) and `ai.ts` (thinking and sight).

M4 is building enemies in stages; this document covers what exists so far: spawning, the think cadence, and noticing the player. Damage, chasing, and attacks will follow.

## Sources

Adapted from Quake's QuakeC (id Software, GPLv2 or later): `droptofloor` for spawning; `FindTarget`, `range`, `infront`, `visible`, and `HuntTarget` in `ai.qc` for sight and reacting. Sight passes through windows, following Quake 2's `MASK_OPAQUE`. See DECISIONS.md (2026-10-14, "Enemy AI follows Quake's") for why.

## Conventions

- **Data:** `data/enemies.json`, one entry per enemy type. Every duration converts to ticks with `ticks(t) = floor(t * TICK_RATE + 0.5)`: at 60 Hz the shotgunner thinks every 6 ticks and has a reaction delay of 36.
- **Masks:** an enemy's movement is blocked by `SOLID | WINDOW | MONSTERCLIP`; its sight only by `SOLID`.
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

## Order within a tick

The player moves and fires first. Then each enemy updates, in spawn order, seeing the player where they ended up this tick.

## State

| Field | Meaning |
|---|---|
| `id`, `type` | Entity id and enemy type. |
| `origin`, `yaw` | Position and facing (angle units). |
| `health` | Starts at the type's `health`. |
| `mode` | `idle` or `chase` so far. |
| `nextThink` | The tick of its next decision. |
| `target` | The entity it hunts, or 0. |
| `attackReadyAt` | The first tick it may attack. |

## Required tests

- Spawning: standing on the floor, dropping from the air, staying put with no floor in reach, and the real maps' enemies where they were placed.
- Decisions happen only on an enemy's think ticks, and enemies with different offsets think on different ticks.
- Sight respects range, the view cone, and walls (not windows), including that `test_combat`'s east shotgunner can't see the player at `west` through the center wall.
