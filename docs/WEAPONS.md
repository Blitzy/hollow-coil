# Weapons Reference

The game implements the player's weapons exactly as described here, and so must any future port, so that engine differences never become behavior differences. When the code and this document disagree, fix one of them; don't let them drift. The code is `packages/sim/src/player/weapons.ts`.

## Sources

Adapted from Quake 3 `code/game/bg_pmove.c` (id Software, GPLv2 or later): `PM_Weapon`, `PM_BeginWeaponChange`, `PM_FinishWeaponChange`. Quake 3 counts milliseconds; we count ticks. The one deliberate difference is noted under [Per tick](#per-tick). See DECISIONS.md (2026-10-13, "Weapon switching follows Quake 3") for why.

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

## Events

Each shot emits `{ type: "fired", entity, weapon }`, with the player's entity id and the weapon id. Presentation (sound, muzzle flash) and tests consume it; scenarios count them as `shots`.

## Required tests

- Fire rate matches the data over a long hold, for every weapon.
- Tapping attack during the cooldown doesn't fire sooner.
- A switch takes `lower_time + raise_time`, with no firing until the new weapon is up.
- A switch requested during the cooldown waits for it; changing back during the cooldown cancels it.
- A key while lowering redirects the switch; a key while raising starts lowering again, adding to the time left.
- Empty slots, the current weapon's slot, and slots for weapons the player lacks are ignored.
