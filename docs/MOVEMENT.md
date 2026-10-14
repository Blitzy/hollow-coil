# Movement and Collision Reference

The game implements player movement and world collision exactly as described here, and so must any future port, so that engine differences never become behavior differences. (The Godot build followed this document through M1 and matched the web build bit for bit.) When the code and this document disagree, fix one of them; don't let them drift.

## Sources

The algorithms are adapted from GPL source code, which our GPLv3 license allows (see `CLAUDE.md`, Licensing). Credit the source in a comment next to code adapted from these:

- **Player movement:** QuakeWorld `QW/client/pmove.c` (id Software, GPLv2 or later): `PlayerMove`, `PM_CatagorizePosition`, `JumpButton`, `PM_Friction`, `PM_Accelerate`, `PM_AirAccelerate`, `PM_AirMove`, `PM_GroundMove`, `PM_FlyMove`, `PM_ClipVelocity`.
- **Edge friction:** Quake `WinQuake/sv_user.c` `SV_UserFriction` (id Software, GPLv2 or later).
- **Same-plane nudge in the slide move:** Quake 3 `code/game/bg_slidemove.c` `PM_SlideMove` (id Software, GPLv2 or later).
- **Box traces against brushes:** Quake 2 `qcommon/cmodel.c` (id Software, GPLv2 or later): `CM_ClipBoxToBrush`, `CM_TestBoxInBrush`, `CM_BoxTrace`.
- **Brush planes and bevels from .map files:** ericw-tools 2.0.0-alpha11 `qbsp/map.cc` (GPLv2 or later): `mapface_t::set_planepts`, `AddBrushBevels`.

Quake 1 and QuakeWorld are the reference for how movement *feels*. Quake 2 is the reference only for collision, because our .bsp files are Quake 2 format with brush data.

## Conventions

- **Units:** Quake units. Z is up.
- **Time step:** `dt = 1 / TICK_RATE`, where `TICK_RATE` is the sim's single tick-rate constant (60). Never hardcode 1/60 elsewhere.
- **Angles:** the input command carries yaw and pitch as 16-bit angle units (65536 per turn). `radians = units * 2π / 65536`. Yaw 0 faces +x, increasing counterclockwise seen from above; pitch is positive looking up.
- **Constants:** tunable values come from `data/player.json` (named `player.movement.*` below). The fixed constants in [Constants](#constants) are part of the algorithm and live in sim code.
- **Precision:** use 64-bit floats for all sim math. On the web that is every JavaScript number. In an engine whose vectors are 32-bit (such as Godot's `Vector3`), the sim needs its own 64-bit vector type.

## Collision world

The world is a list of convex **brushes**. Each brush is a set of planes plus a contents bitfield. A plane is a unit `normal` pointing out of the brush and a `dist`: a point `p` is in front of (outside) the plane when `dot(p, normal) - dist > 0`. A point is inside the brush when it is behind or on every plane.

### Contents and masks

Contents use the Quake 2 bit values (they are what the .bsp and the .map face flags store):

| Name | Value | Blocks |
|---|---|---|
| `SOLID` | `1` | everyone |
| `WINDOW` | `2` | everyone |
| `PLAYERCLIP` | `0x10000` | the player |
| `MONSTERCLIP` | `0x20000` | enemies |

- Player trace mask: `SOLID | WINDOW | PLAYERCLIP`.
- Enemy trace mask: `SOLID | WINDOW | MONSTERCLIP`.
- A brush is tested only if `brush.contents & mask` is nonzero. Liquids, detail, and other contents are ignored for collision during the spike.

### Brushes from a .bsp

Read the `brushes` and `brush_sides` lumps (see `tools/bspdump.py` for the layout). Each brush side references a plane in the `planes` lump. These sides **already include bevel planes** added by qbsp, so use them as they are. Only use brushes belonging to the world model (model 0) for now.

### Brushes from a .map

Each brush face line gives three points `p0 p1 p2`. Then:

```
normal = normalize(cross(p0 - p1, p2 - p1))
dist   = dot(p1, normal)
```

The face's contents field (the first of the three numbers after the texture scale in the Quake 2 Valve format) gives the brush contents; a brush whose faces all have contents 0 is `SOLID`.

Then compute each face's **winding** (its polygon) and add **bevel planes**, as qbsp does, so .map and .bsp collision match:

**Windings.** For each face, start from a very large square lying in the face's plane and clip it by every other plane of the brush, keeping the part behind each plane. Faces whose winding clips away entirely are redundant; drop them. The windings also give the brush's bounds (and the render geometry in M1).

**Axial bevels.** For each axis (x, y, z) and direction (−1, +1): if no face has a normal whose component on that axis is exactly that direction, add a plane with that axial normal at the brush's bounds (`dist = bounds.max[axis]` for +1, `dist = -bounds.min[axis]` for −1). Axial faces built from integer points have exactly axial normals, so the exact comparison is safe.

**Edge bevels.** Skip this step if the brush has exactly six faces after the axial step (a pure box). Otherwise, for each face that is not axial and has a winding, for each edge from winding point `j` to the next point `k`:

1. `vec = p[j] - p[k]`; skip the edge if its length is below 0.5, else normalize it.
2. Snap `vec`: if a component is within `1e-6` of ±1, set that component to exactly ±1 and the others to 0. Skip the edge if `vec` is now axial.
3. For each axis and direction (six combinations), let `n = cross(vec, axialUnit(axis, dir))`. Skip if `|n| < 1e-6`, else normalize it. Let `d = dot(p[j], n)`.
4. Skip the candidate if any existing plane of the brush (including bevels added so far) equals it: normals within `1e-6` per component and dists within `1e-4`.
5. Skip the candidate if any winding point of any face is in front of it by more than `1e-4`.
6. Otherwise add `(n, d)` as a bevel plane (with no winding).

Bevels never change which points are inside a brush. They exist so that pushing every plane out by the box extents (below) produces the correct expanded shape near slanted edges.

### Box trace

`trace(start, end, mins, maxs, mask)` sweeps a box (`mins`/`maxs` relative to its origin) from `start` to `end` against every brush. Result:

- `fraction`: how far along the move the box got (0 to 1).
- `endpos = start + fraction * (end - start)` (exactly `end` when `fraction` is 1).
- `normal`: the plane that stopped it (zero vector if nothing was hit).
- `startsolid`: the box started inside a brush.
- `allsolid`: the box was inside a brush for the whole move.

Start with `fraction = 1`, then clip against each brush that passes the mask (a bounding-box test around the whole move is a fine broad phase; brute force over all brushes is fine for test maps). If `start == end`, run the position test instead.

**Clip a moving box against one brush** (`CM_ClipBoxToBrush`):

```
enter = -1, leave = 1, hitPlane = none
startOut = false, endOut = false
for each plane (normal, dist) of the brush:
    // push the plane out by the box corner that leads into it
    ofs = (normal.x < 0 ? maxs.x : mins.x,
           normal.y < 0 ? maxs.y : mins.y,
           normal.z < 0 ? maxs.z : mins.z)
    d = dist - dot(ofs, normal)
    d1 = dot(start, normal) - d
    d2 = dot(end, normal) - d
    if d2 > 0: endOut = true
    if d1 > 0: startOut = true
    if d1 > 0 and d2 >= d1: return            // moving away from or parallel to this face, outside it
    if d1 <= 0 and d2 <= 0: continue           // behind this plane the whole way
    if d1 > d2:                                 // entering
        f = (d1 - DIST_EPSILON) / (d1 - d2)
        if f > enter: enter = f, hitPlane = plane
    else:                                       // leaving
        f = (d1 + DIST_EPSILON) / (d1 - d2)
        if f < leave: leave = f
if not startOut:
    trace.startsolid = true
    if not endOut: trace.allsolid = true
    return
if enter < leave and enter > -1 and enter < trace.fraction:
    trace.fraction = max(enter, 0)
    trace.normal = hitPlane.normal
```

`DIST_EPSILON` (1/32) stops the box slightly short of the surface, so the next move doesn't start touching it.

**Position test** (`CM_TestBoxInBrush`), used when `start == end`: the box is inside the brush if, for every plane, `dot(start, normal) - (dist - dot(ofs, normal)) <= 0` (same `ofs` as above). If so, set `startsolid = allsolid = true` and `fraction = 0`.

## Player movement

The player has an origin, a velocity, an `onGround` flag, and a `jumpHeld` flag. The hull is `player.hull` (mins −16 −16 −24, maxs 16 16 32). All traces use the player hull and the player mask.

### Per tick

```
playerMove(cmd):
    categorizePosition()
    if cmd.buttons & JUMP: jump() else jumpHeld = false
    friction()
    airMove(cmd)          // handles both ground and air
    categorizePosition()
```

### Spawning

A box exactly touching a surface counts as inside it: the trace treats a distance of exactly 0 as behind the plane. Every move stops `DIST_EPSILON` short of surfaces, so a standing player rests at 24 + 1/32 above the floor, never exactly 24. But spawn points (`info_player_start`, `info_marker`) sit at exactly 24, so a player spawned there would start stuck. Spawn the player with its origin **raised by 1 unit** (Quake 2 raises spawns for the same reason), at rest, with `onGround` false. The first tick's `categorizePosition` settles it onto the floor.

Swimming, water jumps, and death handling from Quake are out of scope for the spike. QuakeWorld's `NudgePosition` is not used: it repairs origins quantized for networking, and our origins aren't quantized.

### Categorize position

```
categorizePosition():
    if velocity.z > 180:
        onGround = false
        return
    t = trace(origin, origin - (0, 0, 1))
    onGround = t.normal.z >= GROUND_NORMAL_Z      // a miss has normal (0,0,0), so it is not ground
    if onGround and not t.startsolid and not t.allsolid:
        origin = t.endpos                          // settle onto the floor
    steepNormal = (0 < t.normal.z < GROUND_NORMAL_Z) ? t.normal : none   // see Steep slopes
```

`steepNormal` starts each call as none (including the early return) and isn't part of the saved state: it's recomputed from the position every tick.

### Jump

```
jump():
    if not onGround: return
    if jumpHeld: return                            // no pogo-sticking: release before jumping again
    onGround = false
    velocity.z += player.movement.jump_velocity
    jumpHeld = true
```

Because `onGround` becomes false here, friction doesn't apply on the tick the jump starts.

### Friction

```
friction():
    speed = length(velocity)                       // all three components, as in QuakeWorld
    if speed < 1:
        velocity.x = 0, velocity.y = 0
        return
    if not onGround: return
    f = player.movement.friction
    // edge friction: if the leading edge is over a drop-off, stop faster
    hs = length(velocity.x, velocity.y)
    if hs > 0:
        ahead = origin + (velocity.x / hs * 16, velocity.y / hs * 16, 0)
        start = (ahead.x, ahead.y, origin.z + player.hull.mins.z)
        if trace(start, start - (0, 0, 34), zeroBox).fraction == 1:
            f *= player.movement.edge_friction
    control = max(speed, player.movement.stop_speed)
    newSpeed = max(speed - control * f * dt, 0)
    velocity *= newSpeed / speed
```

The edge check is a point trace (zero-size box), as in Quake's `SV_UserFriction`.

### Wish direction

The view's yaw alone sets the movement directions (Quake builds them from the full view angles and then flattens them, which gives the same result except when looking straight up or down):

```
forward = (cos(yaw), sin(yaw), 0)
right   = (sin(yaw), -cos(yaw), 0)
fmove = cmd.forward / 127 * player.movement.max_ground_speed
smove = cmd.side / 127 * player.movement.max_ground_speed
wishVel = forward * fmove + right * smove
wishSpeed = length(wishVel)
wishDir = wishSpeed > 0 ? wishVel / wishSpeed : (0, 0, 0)
wishSpeed = min(wishSpeed, player.movement.max_ground_speed)
```

### Air move (ground and air)

```
airMove(cmd):
    compute wishDir, wishSpeed
    if onGround:
        velocity.z = 0
        accelerate(wishDir, wishSpeed, player.movement.ground_accelerate)
        velocity.z -= player.movement.gravity * dt
        groundMove()
    else:
        if steepNormal: wishDir, wishSpeed = withoutPushInto(wishDir, wishSpeed, steepNormal)   // see Steep slopes
        airAccelerate(wishDir, wishSpeed, player.movement.air_accelerate)
        velocity.z -= player.movement.gravity * dt
        flyMove(walking = false)
```

On the ground, the gravity step is immediately cancelled by `groundMove` setting `velocity.z = 0`. It is kept so the order matches QuakeWorld exactly.

### Accelerate

```
accelerate(wishDir, wishSpeed, accel):
    add = wishSpeed - dot(velocity, wishDir)
    if add <= 0: return
    amount = min(accel * dt * wishSpeed, add)
    velocity += wishDir * amount

airAccelerate(wishDir, wishSpeed, accel):
    capped = min(wishSpeed, player.movement.air_wish_speed_cap)
    add = capped - dot(velocity, wishDir)
    if add <= 0: return
    amount = min(accel * wishSpeed * dt, add)      // uses the UNCAPPED wishSpeed
    velocity += wishDir * amount
```

The mismatch in `airAccelerate` is deliberate and is what makes air strafing work: the cap limits how much speed can be added *along* the wish direction, while the acceleration rate still uses the full wish speed. Keep it exactly as written.

### Clip velocity

```
clipVelocity(v, normal, overbounce):
    backoff = dot(v, normal) * overbounce
    out = v - normal * backoff
    for each component of out: if -STOP_EPSILON < c < STOP_EPSILON: c = 0
    return out
```

### Fly move (slide along surfaces)

```
flyMove(walking):
    original = velocity, primal = velocity
    planes = []
    timeLeft = dt
    repeat up to BUMP_COUNT times:
        end = origin + velocity * timeLeft
        t = trace(origin, end)
        if t.startsolid or t.allsolid:
            velocity = 0                            // trapped
            return
        if t.fraction > 0:
            origin = t.endpos
            planes = []
        if t.fraction == 1: return                  // moved the whole way
        timeLeft -= timeLeft * t.fraction
        if planes.length >= MAX_CLIP_PLANES:
            velocity = 0
            return
        normal = walking ? asWallIfSteep(t.normal) : t.normal   // see Steep slopes
        if dot(normal, p) > SAME_PLANE_DOT for any p in planes:
            velocity += normal                      // nudge out along it (see below)
            continue
        planes.push(normal)
        // find a plane whose clipped velocity doesn't push into any other plane
        found = false
        for each plane i in planes:
            velocity = clipVelocity(original, planes[i], 1)
            if dot(velocity, planes[j]) >= 0 for every other plane j:
                found = true, break
        if not found:
            if planes.length != 2:
                velocity = 0
                return
            dir = cross(planes[0], planes[1])       // slide along the crease
            velocity = dir * dot(dir, velocity)
        if dot(velocity, primal) <= 0:              // turned back on itself: stop dead
            velocity = 0
            return
```

`original` is the velocity at the start of the call and is not updated between bumps; this matches QuakeWorld.

The same-plane nudge is not in QuakeWorld; it comes from Quake 3, which pairs a slide loop like this one with brush collision like ours. After sliding along a sloped plane, the box rests `DIST_EPSILON` off it, and on the next bump rounding can make the trace report the same plane again with fraction 0. Without the nudge, the plane goes into the list twice, no clipped velocity satisfies both copies, the crease between a plane and itself is zero, and the player stops dead. This showed up as stuttering slides down steep slopes. Nudging the velocity out by the plane's normal (1 unit per second) and retrying avoids it.

### Ground move (walking, with step-up)

```
groundMove():
    velocity.z = 0
    if velocity is zero: return
    dest = origin + (velocity.x * dt, velocity.y * dt, 0)
    t = trace(origin, dest)
    if t.fraction == 1:
        origin = t.endpos
        return

    // try sliding along the floor, and stepping up then sliding; keep whichever goes farther
    startOrigin = origin, startVel = velocity

    flyMove(walking = true)
    downOrigin = origin, downVel = velocity

    origin = startOrigin, velocity = startVel
    t = trace(origin, origin + (0, 0, STEP))         // STEP = player.movement.step_height
    if not t.startsolid and not t.allsolid: origin = t.endpos
    flyMove(walking = true)
    t = trace(origin, origin - (0, 0, STEP))
    if t.normal.z < GROUND_NORMAL_Z:                 // stepped onto something too steep, or onto nothing
        origin = downOrigin, velocity = downVel
        return
    if not t.startsolid and not t.allsolid: origin = t.endpos
    upOrigin = origin

    downDist = horizontal distance² from startOrigin to downOrigin
    upDist   = horizontal distance² from startOrigin to upOrigin
    if downDist > upDist:
        origin = downOrigin, velocity = downVel
    else:
        velocity.z = downVel.z                       // keep the step result, with the slide's vertical speed
```

A step up succeeds when the box, raised by `STEP` (18), can move forward and then lands on a walkable surface. The 20-unit step in `test_movement` fails because the raised box still hits the step's face.

### Steep slopes (a departure from QuakeWorld)

A surface too steep to stand on (0 < normal z < 0.7, steeper than about 45.6°) is one the player slides down. In QuakeWorld, holding forward into one counts as air control: `airAccelerate` adds up to 30 u/s per tick into the slope, clipping turns part of that into up-slope motion, and on slopes shallower than `atan(air_wish_speed_cap * TICK_RATE / gravity)` (about 66° at 60 Hz) it outweighs gravity, so the player slowly crawls up. Walking into the foot of such a slope also turns forward speed into upward motion, making the player hop. We remove both, deliberately:

```
withoutPushInto(wishDir, wishSpeed, n):           // used in the air, when resting against a steep surface
    out = normalize(n.x, n.y, 0)                  // horizontal, pointing away from the surface
    into = dot(wishDir, out)
    if into >= 0: return wishDir, wishSpeed       // not pushing into it
    kept = (wishDir - out * into) * wishSpeed     // the wish without its into-surface part
    return normalize(kept), length(kept)          // (zero if nothing is left)

asWallIfSteep(n):                                 // used by walking slides
    if n.z <= 0 or n.z >= GROUND_NORMAL_Z: return n
    return normalize(n.x, n.y, 0)                 // treat it as a vertical wall
```

Both use only the horizontal part of the surface's normal. Clipping a horizontal wish against the full slope normal would tilt it up along the slope and bring the climb back. The result: holding forward against a steep slope stops the player at its foot like a wall, a player on the slope slides down even while holding forward, and sideways movement along it still works. Running into the slope at speed no longer bumps the player a few units up it.

## Constants

Tunable, in `data/player.json`:

| Name | Starting value | Use |
|---|---|---|
| `movement.max_ground_speed` | 320 | wish speed cap; scales input |
| `movement.ground_accelerate` | 10 | `accelerate` on the ground |
| `movement.air_accelerate` | 10 | `airAccelerate` |
| `movement.air_wish_speed_cap` | 30 | `airAccelerate` cap |
| `movement.friction` | 4 | ground friction |
| `movement.edge_friction` | 2 | friction multiplier over a drop-off |
| `movement.stop_speed` | 100 | friction control speed floor |
| `movement.gravity` | 800 | units/s² |
| `movement.jump_velocity` | 270 | jump impulse |
| `movement.step_height` | 18 | `STEP` in `groundMove` |
| `hull` | −16 −16 −24 to 16 16 32 | player box |

Fixed, in sim code (part of the algorithm, not tuning):

| Name | Value | Use |
|---|---|---|
| `DIST_EPSILON` | 1/32 | trace stand-off from surfaces |
| `STOP_EPSILON` | 0.1 | velocity components below this are zeroed after clipping |
| `GROUND_NORMAL_Z` | 0.7 | steepest walkable surface (about 45.6°) |
| `BUMP_COUNT` | 4 | `flyMove` iterations |
| `MAX_CLIP_PLANES` | 5 | `flyMove` plane limit |
| `SAME_PLANE_DOT` | 0.99 | `flyMove`: a hit this close to a plane already hit is the same plane |
| airborne speed | 180 | `categorizePosition`: rising faster than this is never on ground |
| ground probe | 1 | `categorizePosition` trace distance |
| edge probe | 16 ahead, 34 down | `friction` drop-off check |
| bevel epsilons | 0.5, 1e-6, 1e-4 | edge length, normal, and distance tolerances (from ericw-tools) |

## Required unit tests

Test these in isolation, in addition to the `/spec` scenarios:

- `clipVelocity`: sliding along a wall and a floor; tiny components snap to zero.
- `accelerate`: reaches but never exceeds the wish speed; no change when already faster.
- `airAccelerate`: the cap limits speed along the wish direction; acceleration uses the uncapped wish speed.
- `friction`: stop-speed floor; edge friction doubles near a drop-off and not on open floor; no friction in the air or on the jump tick.
- Brush building from a .map: plane equation from three points; a wedge gains the expected axial and edge bevels; a box gains none.
- Box trace: hit fraction and normal against a box and a slope; `startsolid` and `allsolid`; the 1/32 stand-off; a box sliding along a slope's edge doesn't snag (bevels working).
- Fly move: sliding down a slope too steep to stand on is continuous (height falls and speed never drops until landing).
- Steep slopes: holding forward neither climbs one (from its foot or from on it) nor hops at its foot; sideways movement along it still works; `withoutPushInto` and `asWallIfSteep` remove only the horizontal push into the surface.
- Step-up: 18 succeeds and 20 blocks (also covered by the scenarios); stepping onto a too-steep surface is refused.
- Ground: standing on a 0.7-normal slope counts as ground and a steeper one doesn't; rising faster than 180 is never on ground.
- Jump: holding jump doesn't re-jump on landing; releasing and pressing again does.
