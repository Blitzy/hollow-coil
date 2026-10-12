class_name Trace
## Sweeping a box through the world's brushes. See docs/MOVEMENT.md, "Box trace".
## Adapted from Quake 2 qcommon/cmodel.c CM_ClipBoxToBrush, CM_TestBoxInBrush,
## and CM_BoxTrace (id Software, GPLv2 or later). Ported from web/src/sim/collision/trace.ts.

## Keeps traces from ending exactly on a surface, so the next move doesn't start touching it.
const DIST_EPSILON := 1.0 / 32.0


class Result:
	## How far along the move the box got, 0 to 1.
	var fraction := 1.0
	var endpos: Vec3
	## Normal of the plane that stopped the box, or zero if nothing was hit.
	var normal := Vec3.zero()
	var start_solid := false
	var all_solid := false


## The box corner that leads into a plane: its distance offset when the plane is pushed out by the box.
static func _box_offset(normal: Vec3, mins: Vec3, maxs: Vec3) -> float:
	return (
		(maxs.x if normal.x < 0 else mins.x) * normal.x
		+ (maxs.y if normal.y < 0 else mins.y) * normal.y
		+ (maxs.z if normal.z < 0 else mins.z) * normal.z
	)


static func _clip_box_to_brush(brush: Brush, start: Vec3, end: Vec3, mins: Vec3, maxs: Vec3, work: Result) -> void:
	var enter := -1.0
	var leave := 1.0
	var hit: CollisionPlane = null
	var start_out := false
	var end_out := false

	for plane in brush.planes:
		var dist := plane.dist - _box_offset(plane.normal, mins, maxs)
		var d1 := start.dot(plane.normal) - dist
		var d2 := end.dot(plane.normal) - dist
		if d2 > 0:
			end_out = true
		if d1 > 0:
			start_out = true
		if d1 > 0 and d2 >= d1:
			return # outside this face and not moving toward it
		if d1 <= 0 and d2 <= 0:
			continue # behind this face the whole way
		if d1 > d2:
			var f := (d1 - DIST_EPSILON) / (d1 - d2)
			if f > enter:
				enter = f
				hit = plane
		else:
			var f := (d1 + DIST_EPSILON) / (d1 - d2)
			if f < leave:
				leave = f

	if not start_out:
		work.start_solid = true
		if not end_out:
			work.all_solid = true
		return
	if enter < leave and enter > -1 and enter < work.fraction and hit != null:
		work.fraction = maxf(enter, 0.0)
		work.normal = hit.normal


static func _box_in_brush(brush: Brush, point: Vec3, mins: Vec3, maxs: Vec3) -> bool:
	for plane in brush.planes:
		if point.dot(plane.normal) - (plane.dist - _box_offset(plane.normal, mins, maxs)) > 0:
			return false
	return true


## True if the swept box's bounds (plus a unit of margin) can touch the brush's bounds.
static func _may_touch(brush: Brush, lo: Vec3, hi: Vec3) -> bool:
	return (
		lo.x <= brush.maxs.x + 1 and hi.x >= brush.mins.x - 1
		and lo.y <= brush.maxs.y + 1 and hi.y >= brush.mins.y - 1
		and lo.z <= brush.maxs.z + 1 and hi.z >= brush.mins.z - 1
	)


## Sweeps a box (mins/maxs relative to its origin) from start to end, against
## every brush whose contents match the mask. If start equals end, tests
## whether the box is inside a brush.
static func box(world: CollisionWorld, start: Vec3, end: Vec3, mins: Vec3, maxs: Vec3, mask: int) -> Result:
	var work := Result.new()
	var lo := Vec3.of(minf(start.x, end.x) + mins.x, minf(start.y, end.y) + mins.y, minf(start.z, end.z) + mins.z)
	var hi := Vec3.of(maxf(start.x, end.x) + maxs.x, maxf(start.y, end.y) + maxs.y, maxf(start.z, end.z) + maxs.z)

	if start.equals(end):
		work.endpos = start
		for brush in world.brushes:
			if (brush.contents & mask) == 0 or not _may_touch(brush, lo, hi):
				continue
			if _box_in_brush(brush, start, mins, maxs):
				work.fraction = 0.0
				work.start_solid = true
				work.all_solid = true
				return work
		return work

	for brush in world.brushes:
		if (brush.contents & mask) == 0 or not _may_touch(brush, lo, hi):
			continue
		_clip_box_to_brush(brush, start, end, mins, maxs, work)
	work.endpos = end if work.fraction == 1.0 else start.add_scaled(end.sub(start), work.fraction)
	return work
