class_name PlayerMovement
## Quake-style player movement. Follows docs/MOVEMENT.md, "Player movement".
## Adapted from QuakeWorld QW/client/pmove.c (id Software, GPLv2 or later), with
## edge friction from Quake WinQuake/sv_user.c SV_UserFriction and the slide
## move's same-plane nudge from Quake 3 code/game/bg_slidemove.c (both GPLv2 or later).
## Ported from web/src/sim/player/movement.ts.

const PLAYER_MASK := SimConstants.CONTENTS_SOLID | SimConstants.CONTENTS_WINDOW | SimConstants.CONTENTS_PLAYERCLIP

# Fixed parts of the algorithm (docs/MOVEMENT.md, "Constants"). Tunable values come from data.
const STOP_EPSILON := 0.1
const GROUND_NORMAL_Z := 0.7
const BUMP_COUNT := 4
const MAX_CLIP_PLANES := 5
const SAME_PLANE_DOT := 0.99
const AIRBORNE_SPEED := 180.0
const GROUND_PROBE := 1.0
const EDGE_PROBE_AHEAD := 16.0
const EDGE_PROBE_DOWN := 34.0

const DT := 1.0 / SimConstants.TICK_RATE


## What movement needs from the level and data.
class Context:
	var world: CollisionWorld
	var hull_mins: Vec3
	var hull_maxs: Vec3
	var movement: PlayerData.Movement

	func _init(context_world: CollisionWorld, player: PlayerData) -> void:
		world = context_world
		hull_mins = player.hull_mins
		hull_maxs = player.hull_maxs
		movement = player.movement


## The working copy one tick of movement updates in place.
class Mover:
	var origin: Vec3
	var velocity: Vec3
	var on_ground := false
	var jump_held := false
	## Normal of a surface too steep to stand on that the player is resting against, found by categorize_position.
	var steep_normal: Vec3 = null

	func _init(mover_origin: Vec3, mover_velocity: Vec3, mover_on_ground := false, mover_jump_held := false) -> void:
		origin = mover_origin
		velocity = mover_velocity
		on_ground = mover_on_ground
		jump_held = mover_jump_held


## A movement direction (unit length, or zero) and speed.
class Wish:
	var dir: Vec3
	var speed: float

	func _init(wish_dir: Vec3, wish_speed: float) -> void:
		dir = wish_dir
		speed = wish_speed


static func _trace_hull(ctx: Context, start: Vec3, end: Vec3) -> Trace.Result:
	return Trace.box(ctx.world, start, end, ctx.hull_mins, ctx.hull_maxs, PLAYER_MASK)


static func _horizontal_length(v: Vec3) -> float:
	return sqrt(v.x * v.x + v.y * v.y)


## Runs one tick of player movement and returns the new body.
static func player_move(body: PlayerBody, cmd: InputCommand, ctx: Context) -> PlayerBody:
	var m := Mover.new(body.origin, body.velocity, body.on_ground, body.jump_held)
	categorize_position(m, ctx)
	if cmd.buttons & InputCommand.BUTTON_JUMP:
		_jump(m, ctx)
	else:
		m.jump_held = false
	friction(m, ctx)
	_air_move(m, cmd, ctx)
	categorize_position(m, ctx)
	return PlayerBody.new(m.origin, m.velocity, m.on_ground, m.jump_held)


static func categorize_position(m: Mover, ctx: Context) -> void:
	m.steep_normal = null
	if m.velocity.z > AIRBORNE_SPEED:
		m.on_ground = false
		return
	var t := _trace_hull(ctx, m.origin, m.origin.sub(Vec3.of(0, 0, GROUND_PROBE)))
	m.on_ground = t.normal.z >= GROUND_NORMAL_Z # a miss has a zero normal, so it isn't ground
	if m.on_ground and not t.start_solid and not t.all_solid:
		m.origin = t.endpos
	if t.normal.z > 0 and t.normal.z < GROUND_NORMAL_Z:
		m.steep_normal = t.normal


static func _jump(m: Mover, ctx: Context) -> void:
	if not m.on_ground:
		return
	if m.jump_held:
		return # no pogo-sticking: release before jumping again
	m.on_ground = false
	m.velocity = Vec3.of(m.velocity.x, m.velocity.y, m.velocity.z + ctx.movement.jump_velocity)
	m.jump_held = true


static func friction(m: Mover, ctx: Context) -> void:
	var v := m.velocity
	var speed := v.length()
	if speed < 1:
		m.velocity = Vec3.of(0, 0, v.z)
		return
	if not m.on_ground:
		return

	var f := ctx.movement.friction
	# Edge friction: stop faster when the leading edge is over a drop-off.
	var horizontal := _horizontal_length(v)
	if horizontal > 0:
		var start := Vec3.of(
			m.origin.x + (v.x / horizontal) * EDGE_PROBE_AHEAD,
			m.origin.y + (v.y / horizontal) * EDGE_PROBE_AHEAD,
			m.origin.z + ctx.hull_mins.z,
		)
		var down := Trace.box(ctx.world, start, start.sub(Vec3.of(0, 0, EDGE_PROBE_DOWN)), Vec3.zero(), Vec3.zero(), PLAYER_MASK)
		if down.fraction == 1.0:
			f *= ctx.movement.edge_friction

	var control := maxf(speed, ctx.movement.stop_speed)
	var new_speed := maxf(speed - control * f * DT, 0.0)
	m.velocity = v.scaled(new_speed / speed)


## Movement direction and speed the player is asking for, from the view's yaw.
static func wish(cmd: InputCommand, max_speed: float) -> Wish:
	var yaw := InputCommand.angle_to_radians(cmd.yaw)
	var forward := Vec3.of(cos(yaw), sin(yaw), 0)
	var right := Vec3.of(sin(yaw), -cos(yaw), 0)
	var wish_vel := forward.scaled((cmd.forward / 127.0) * max_speed).add_scaled(right, (cmd.side / 127.0) * max_speed)
	var speed := wish_vel.length()
	return Wish.new(wish_vel.scaled(1.0 / speed) if speed > 0 else Vec3.zero(), minf(speed, max_speed))


static func _air_move(m: Mover, cmd: InputCommand, ctx: Context) -> void:
	var mv := ctx.movement
	var w := wish(cmd, mv.max_ground_speed)
	if m.on_ground:
		m.velocity = Vec3.of(m.velocity.x, m.velocity.y, 0)
		m.velocity = accelerate(m.velocity, w.dir, w.speed, mv.ground_accelerate)
		# Cancelled straight away by ground_move; kept so the order matches QuakeWorld.
		m.velocity = Vec3.of(m.velocity.x, m.velocity.y, m.velocity.z - mv.gravity * DT)
		ground_move(m, ctx)
	else:
		if m.steep_normal != null:
			w = without_push_into(w.dir, w.speed, m.steep_normal)
		m.velocity = air_accelerate(m.velocity, w.dir, w.speed, mv.air_accelerate, mv.air_wish_speed_cap)
		m.velocity = Vec3.of(m.velocity.x, m.velocity.y, m.velocity.z - mv.gravity * DT)
		fly_move(m, ctx)


## Removes the horizontal part of a wish that pushes into a steep surface.
## Without this, air acceleration into a slope steeper than 45.6 degrees but
## shallower than about 66 degrees outweighs gravity and the player slowly
## climbs it. A deliberate departure from QuakeWorld; see docs/MOVEMENT.md.
static func without_push_into(dir: Vec3, speed: float, surface_normal: Vec3) -> Wish:
	var across := _horizontal_length(surface_normal)
	if across == 0 or speed == 0:
		return Wish.new(dir, speed)
	var out := Vec3.of(surface_normal.x / across, surface_normal.y / across, 0) # horizontal, pointing away from the surface
	var into := dir.dot(out)
	if into >= 0:
		return Wish.new(dir, speed)
	var kept := dir.add_scaled(out, -into).scaled(speed) # the wish with its into-surface part removed
	var kept_speed := kept.length()
	return Wish.new(kept.scaled(1.0 / kept_speed), kept_speed) if kept_speed > 0 else Wish.new(Vec3.zero(), 0.0)


static func accelerate(velocity: Vec3, wish_dir: Vec3, wish_speed: float, accel: float) -> Vec3:
	var add := wish_speed - velocity.dot(wish_dir)
	if add <= 0:
		return velocity
	return velocity.add_scaled(wish_dir, minf(accel * DT * wish_speed, add))


## The cap limits speed gained along the wish direction, but the rate uses the
## uncapped wish speed. That mismatch is what makes air strafing work; keep it.
static func air_accelerate(velocity: Vec3, wish_dir: Vec3, wish_speed: float, accel: float, cap: float) -> Vec3:
	var add := minf(wish_speed, cap) - velocity.dot(wish_dir)
	if add <= 0:
		return velocity
	return velocity.add_scaled(wish_dir, minf(accel * wish_speed * DT, add))


static func _snap(c: float) -> float:
	return 0.0 if c > -STOP_EPSILON and c < STOP_EPSILON else c


static func clip_velocity(v: Vec3, normal: Vec3, overbounce: float) -> Vec3:
	var backoff := v.dot(normal) * overbounce
	return Vec3.of(_snap(v.x - normal.x * backoff), _snap(v.y - normal.y * backoff), _snap(v.z - normal.z * backoff))


## While walking, a surface too steep to stand on is treated as a vertical wall,
## so walking into it can't turn into upward motion (which made the player hop
## at the foot of steep slopes). A deliberate departure from QuakeWorld; see
## docs/MOVEMENT.md, Steep slopes.
static func as_wall_if_steep(normal: Vec3) -> Vec3:
	if normal.z <= 0 or normal.z >= GROUND_NORMAL_Z:
		return normal
	var across := _horizontal_length(normal)
	return Vec3.of(normal.x / across, normal.y / across, 0)


## Moves along the velocity for one tick, sliding along anything hit. Walking slides treat steep surfaces as walls.
static func fly_move(m: Mover, ctx: Context, walking := false) -> void:
	var original := m.velocity
	var primal := m.velocity
	var planes: Array[Vec3] = []
	var time_left := DT

	for bump in BUMP_COUNT:
		var t := _trace_hull(ctx, m.origin, m.origin.add_scaled(m.velocity, time_left))
		if t.start_solid or t.all_solid:
			m.velocity = Vec3.zero() # trapped
			return
		if t.fraction > 0:
			m.origin = t.endpos
			planes.clear()
		if t.fraction == 1.0:
			return

		time_left -= time_left * t.fraction
		if planes.size() >= MAX_CLIP_PLANES:
			m.velocity = Vec3.zero()
			return
		# Hitting a plane already hit during this move is a rounding artifact of
		# sliding along a sloped surface; nudge out along it instead of clipping
		# again, which would stop the player dead. From Quake 3 code/game/
		# bg_slidemove.c PM_SlideMove (id Software, GPLv2 or later).
		var normal := as_wall_if_steep(t.normal) if walking else t.normal
		if planes.any(func(p: Vec3) -> bool: return normal.dot(p) > SAME_PLANE_DOT):
			m.velocity = m.velocity.add(normal)
			continue
		planes.append(normal)

		# Find a plane whose clipped velocity doesn't push into any of the others.
		var found := false
		for i in planes.size():
			m.velocity = clip_velocity(original, planes[i], 1.0)
			found = true
			for j in planes.size():
				if j != i and m.velocity.dot(planes[j]) < 0:
					found = false
					break
			if found:
				break
		if not found:
			if planes.size() != 2:
				m.velocity = Vec3.zero()
				return
			var crease := planes[0].cross(planes[1]) # slide along the crease
			m.velocity = crease.scaled(crease.dot(m.velocity))
		if m.velocity.dot(primal) <= 0:
			m.velocity = Vec3.zero() # turned back on itself: stop dead to avoid jitter in corners
			return


## Walking: slides along the floor or steps up, whichever gets farther.
static func ground_move(m: Mover, ctx: Context) -> void:
	m.velocity = Vec3.of(m.velocity.x, m.velocity.y, 0)
	if m.velocity.x == 0 and m.velocity.y == 0:
		return

	var dest := Vec3.of(m.origin.x + m.velocity.x * DT, m.origin.y + m.velocity.y * DT, m.origin.z)
	var direct := _trace_hull(ctx, m.origin, dest)
	if direct.fraction == 1.0:
		m.origin = direct.endpos
		return

	var start_origin := m.origin
	var start_velocity := m.velocity
	var step := ctx.movement.step_height

	fly_move(m, ctx, true)
	var down_origin := m.origin
	var down_velocity := m.velocity

	m.origin = start_origin
	m.velocity = start_velocity
	var up := _trace_hull(ctx, m.origin, m.origin.add_scaled(Vec3.of(0, 0, 1), step))
	if not up.start_solid and not up.all_solid:
		m.origin = up.endpos
	fly_move(m, ctx, true)
	var down := _trace_hull(ctx, m.origin, m.origin.add_scaled(Vec3.of(0, 0, -1), step))
	if down.normal.z < GROUND_NORMAL_Z:
		# Stepped onto something too steep, or onto nothing: use the plain slide.
		m.origin = down_origin
		m.velocity = down_velocity
		return
	if not down.start_solid and not down.all_solid:
		m.origin = down.endpos
	var up_origin := m.origin

	var down_dist := (down_origin.x - start_origin.x) ** 2 + (down_origin.y - start_origin.y) ** 2
	var up_dist := (up_origin.x - start_origin.x) ** 2 + (up_origin.y - start_origin.y) ** 2
	if down_dist > up_dist:
		m.origin = down_origin
		m.velocity = down_velocity
	else:
		m.velocity = Vec3.of(m.velocity.x, m.velocity.y, down_velocity.z)
