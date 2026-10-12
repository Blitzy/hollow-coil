class_name Winding
## Windings: the convex polygon a brush face occupies on its plane, as an
## Array[Vec3]. Adapted from Quake's BaseWindingForPlane and ClipWinding
## (id Software, GPLv2 or later). Ported from web/src/sim/collision/winding.ts.

const BASE_WINDING_SIZE := float(1 << 17) # far beyond any map coordinate


## A huge square lying in the plane, to be clipped down to a face.
static func base(plane: CollisionPlane) -> Array[Vec3]:
	var n := plane.normal
	var ax := absf(n.x)
	var ay := absf(n.y)
	var az := absf(n.z)
	# Pick an "up" direction that isn't parallel to the normal.
	var up := Vec3.of(1, 0, 0) if az >= ax and az >= ay else Vec3.of(0, 0, 1)
	up = up.add_scaled(n, -up.dot(n)).normalized()
	var right := up.cross(n).scaled(BASE_WINDING_SIZE)
	up = up.scaled(BASE_WINDING_SIZE)
	var origin := n.scaled(plane.dist)
	return [
		origin.sub(right).add(up),
		origin.add(right).add(up),
		origin.add(right).sub(up),
		origin.sub(right).sub(up),
	]


## Keeps the part of the winding behind or on the plane. Returns an empty array
## if nothing remains. Points within epsilon of the plane count as on it.
static func clip_back(winding: Array[Vec3], plane: CollisionPlane, epsilon: float) -> Array[Vec3]:
	var dists := PackedFloat64Array()
	var sides := PackedInt32Array()
	var any_front := false
	var any_back := false
	for p in winding:
		var d := plane.distance_to(p)
		var side := 1 if d > epsilon else (-1 if d < -epsilon else 0)
		dists.append(d)
		sides.append(side)
		any_front = any_front or side == 1
		any_back = any_back or side == -1
	if not any_front:
		return winding # nothing in front
	if not any_back:
		return [] # nothing behind

	var out: Array[Vec3] = []
	var count := winding.size()
	for i in count:
		var p1 := winding[i]
		var side := sides[i]
		if side == 0:
			out.append(p1)
			continue
		if side == -1:
			out.append(p1)
		var j := (i + 1) % count
		var next_side := sides[j]
		if next_side == 0 or next_side == side:
			continue

		# The edge crosses the plane: add the crossing point, exact on axial planes.
		var p2 := winding[j]
		var t := dists[i] / (dists[i] - dists[j])
		var mid := PackedFloat64Array()
		for axis in 3:
			var n := plane.normal.component(axis)
			if n == 1.0:
				mid.append(plane.dist)
			elif n == -1.0:
				mid.append(0.0 - plane.dist) # 0 - x, not -x, so zero stays +0
			else:
				mid.append(p1.component(axis) + t * (p2.component(axis) - p1.component(axis)))
		out.append(Vec3.of(mid[0], mid[1], mid[2]))
	return out if out.size() >= 3 else []
