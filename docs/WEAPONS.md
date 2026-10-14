# Weapons Reference

The game implements the player's weapons exactly as described here, and so must any future port, so that engine differences never become behavior differences. When the code and this document disagree, fix one of them; don't let them drift. The code is `packages/sim/src/player/weapons.ts` (switching and firing) and `packages/sim/src/combat/hitscan.ts` (what a shot hits).

## Sources

- **Switching and firing:** Quake 3 `code/game/bg_pmove.c` (id Software, GPLv2 or later): `PM_Weapon`, `PM_BeginWeaponChange`, `PM_FinishWeaponChange`. Quake 3 counts milliseconds; we count ticks. The one deliberate difference is noted under [Per tick](#per-tick). See DECISIONS.md (2026-10-13, "Weapon switching follows Quake 3") for why.
- **Spread:** Quake `QuakeC/weapons.qc` `FireBullets` (id Software, GPLv2 or later): a random offset on each axis, along the view's right and up vectors.
- **What stops a shot:** Quake 2's `MASK_SHOT` (solid and window brushes, not clip brushes).

## Conventions

- **Data:** `data/weapons.json` gives each weapon's `slot` and `fire_interval`, and the shared `switching.lower_time` and `switching.raise_time`. `data/player.json` lists the player's `weapons` and `starting_weapon`.
- **Ticks:** every duration converts to ticks with `ticks(t) = floor(t * TICK_RATE + 0.5)`, the same rule scenarios use. A weapon's fire ticks are at least 1. At 60 Hz: pistol 21, shotgun 54, lower 12, raise 15.
- **Slots:** the input command's `weapon` field is a slot number (0 for none). A slot selects the player's weapon with that slot; a slot with no weapon the player has is ignored.

## State

The weapon state is part of the player's sim state:

| Field | Meaning |
|---|---|
| `current` | The weapon in hand. |
| `desired` | The weapon the player last asked for. Differs from `current` until a switch finishes. |
| `phase` | `ready` (idle), `firing` (fired; cooling down), `lowering`, or `raising`. |
| `time` | Ticks until the weapon can act again: the cooldown, or what's left of lowering or raising. |

At spawn: `current = desired = starting_weapon`, `phase = ready`, `time = 0`.

## Per tick

The weapon updates after the player moves, as in Quake, so shots start from where the player ended up.

```
weaponFrame(cmd):
    if cmd.weapon != 0 and the player has a weapon in that slot:
        desired = that weapon
    if time > 0: time -= 1

    # Start a switch, unless already lowering. A weapon that fired finishes its cooldown first.
    if desired != current and phase != lowering and (time <= 0 or phase != firing):
        phase = lowering
        time += lower_ticks
    if time > 0: return

    if phase == lowering:
        current = desired
        phase = raising
        time += raise_ticks
        if time > 0: return
    if phase == raising:
        phase = ready              # Quake 3 returns here; we don't (see below)

    if attack is not held:
        phase = ready
        return
    fire current                   # emits a "fired" event
    phase = firing
    time += fire_ticks[current]
```

Times are added (`+=`), not set, as in Quake 3. That has two consequences worth knowing:

- **A key pressed while raising** starts lowering again, and the lowering takes the rest of the raise plus `lower_ticks`.
- **Changing your mind while lowering** costs nothing extra: `desired` just changes, and whatever is desired when lowering ends is raised, even the weapon that was lowered.

**The difference from Quake 3:** Quake 3 returns on the frame its raise finishes, so the new weapon can't fire until the next frame. We let it fire on that same tick, so a switch takes exactly `lower_time + raise_time`: a key pressed on tick 1 lowers until tick 12, raises from tick 13, and can fire on tick 28.

## Firing timeline

Holding attack fires on the first tick the weapon is ready, then every `fire_ticks` ticks: the pistol on ticks 1, 22, 43, and so on. Releasing and pressing again during the cooldown doesn't fire sooner. A switch requested during the cooldown waits for it: lowering starts on the tick the cooldown ends. Pressing the current weapon's key again before then cancels the switch, with nothing lowered.

## Hitscan

On the tick a weapon fires, its `hitscan` data (`pellets`, `damage`, `spread`, `range`) is fired from the player's eye: `origin + (0, 0, eye_height)`, using the origin after this tick's move and the command's view angles.

**Aim vectors** (Quake's `AngleVectors`, no roll), from yaw `y` and pitch `p` in radians:

```
forward = (cos p * cos y, cos p * sin y, sin p)
right   = (sin y, -cos y, 0)
up      = cross(right, forward)
```

**Each pellet**, in order, draws two values from the sim's RNG, even when the spread is 0, so the RNG always advances by `2 * pellets`:

```
u = 2 * random() - 1               # horizontal, -1 to 1
v = 2 * random() - 1               # vertical
dir = normalize(forward + right * tan(spread.horizontal) * u + up * tan(spread.vertical) * v)
```

Spread angles are in degrees: the most a pellet can be off the aim on each axis. The pellet is a ray from the eye to `eye + dir * range`:

1. Trace it through the world as a point (zero-size box), with the shot mask: `SOLID | WINDOW`. Clip brushes don't stop shots.
2. Test it against every entity box that can be hit (never the shooter's own). A box counts if the ray enters it before the world trace stopped; a ray starting inside a box hits it at once. The nearest box wins.
3. The pellet hits that entity at the point where the ray enters its box; otherwise the wall at the trace's end point (1/32 short of the surface, as every trace stops) with the wall's normal; otherwise nothing, if the ray reached its range.

The eye is always inside the player's hull, which never overlaps the world, so the trace never starts inside a brush.

Until enemies arrive (M4), there are no entities to hit.

## Events

In order, for each shot:

- `{ type: "fired", entity, weapon }`: the shooter's entity id and the weapon id. Scenarios count these as `shots`.
- Then one event per pellet that hit something, in pellet order:
  - `{ type: "hitWall", entity, point, normal }`
  - `{ type: "hitEntity", entity, target, point, damage }`, with the weapon's per-pellet `damage`

Presentation (sound, muzzle flashes, impact marks) consumes them. Scenarios can check the latest hit point as `last_hit`.

## Required tests

- Fire rate matches the data over a long hold, for every weapon.
- Tapping attack during the cooldown doesn't fire sooner.
- A switch takes `lower_time + raise_time`, with no firing until the new weapon is up.
- A switch requested during the cooldown waits for it; changing back during the cooldown cancels it.
- A key while lowering redirects the switch; a key while raising starts lowering again, adding to the time left.
- Empty slots, the current weapon's slot, and slots for weapons the player lacks are ignored.
- A shot stops at walls (not clip brushes), hits the nearest entity in front of them, and starts from the eye after the move.
- A shot fires `pellets` pellets, each within its spread, with the same results for the same seed.
