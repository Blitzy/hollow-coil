class_name Brush
extends RefCounted
## A brush built from .map faces: planes, face windings, bounds, contents, and
## the bevel planes qbsp adds, so .map collision matches .bsp collision.
## See docs/MOVEMENT.md, "Brushes from a .map". Ported from web/src/sim/collision/brush.ts.

# Tolerances from ericw-tools (mathlib.hh and qbsp's epsilon setting).
const NORMAL_EPSILON := 1e-6
const DIST_EPSILON := 1e-4
const POINT_EPSILON := 1e-4
const MIN_EDGE_LENGTH := 0.5

## Every plane used for collision: the faces' planes plus bevels.
var planes: Array[CollisionPlane] = []
## The visible faces, with windings, for rendering. Bevels have no face.
var faces: Array[BrushFace] = []
var contents := SimConstants.CONTENTS_SOLID
var mins: Vec3
var maxs: Vec3


static func _planes_equal(a: CollisionPlane, b: CollisionPlane) -> bool:
	return (
		absf(a.normal.x - b.normal.x) < NORMAL_EPSILON
		and absf(a.normal.y - b.normal.y) < NORMAL_EPSILON
		and absf(a.normal.z - b.normal.z) < NORMAL_EPSILON
		and absf(a.dist - b.dist) < DIST_EPSILON
	)


## Snaps a unit vector to exactly axial if it is within epsilon of an axis.
static func _snap_to_axis(v: Vec3) -> Vec3:
	for axis in 3:
		var c := v.component(axis)
		if absf(c - 1.0) < NORMAL_EPSILON:
			return Vec3.axial(axis, 1.0)
		if absf(c + 1.0) < NORMAL_EPSILON:
			return Vec3.axial(axis, -1.0)
	return v


static func _is_axial(v: Vec3) -> bool:
	return absf(v.x) == 1.0 or absf(v.y) == 1.0 or absf(v.z) == 1.0


## Builds a brush from its .map faces, or returns null if the faces don't
## enclose a volume. Bevels adapted from ericw-tools 2.0.0-alpha11
## qbsp/map.cc AddBrushBevels (GPLv2 or later).
static func build(map_faces: Array[MapFace]) -> Brush:
	# Planes from points, dropping degenerate faces and exact duplicates.
	var candidate_planes: Array[CollisionPlane] = []
	var candidate_sources: Array[MapFace] = []
	for source in map_faces:
		var plane := CollisionPlane.from_points(source.points[0], source.points[1], source.points[2])
		if plane == null or candidate_planes.any(func(c: CollisionPlane) -> bool: return _planes_equal(c, plane)):
			continue
		candidate_planes.append(plane)
		candidate_sources.append(source)

	# Windings: clip each face's plane by every other plane. Faces that clip away are redundant.
	var brush := Brush.new()
	for i in candidate_planes.size():
		var plane := candidate_planes[i]
		var w := Winding.base(plane)
		for other in candidate_planes:
			if other == plane or w.is_empty():
				continue
			w = Winding.clip_back(w, other, 0.0)
		if not w.is_empty():
			brush.faces.append(BrushFace.new(plane, w, candidate_sources[i]))
	if brush.faces.size() < 4:
		return null

	var min_x := INF
	var min_y := INF
	var min_z := INF
	var max_x := -INF
	var max_y := -INF
	var max_z := -INF
	for face in brush.faces:
		for p in face.winding:
			min_x = minf(min_x, p.x)
			min_y = minf(min_y, p.y)
			min_z = minf(min_z, p.z)
			max_x = maxf(max_x, p.x)
			max_y = maxf(max_y, p.y)
			max_z = maxf(max_z, p.z)
	brush.mins = Vec3.of(min_x, min_y, min_z)
	brush.maxs = Vec3.of(max_x, max_y, max_z)

	# Windings parallel to planes: faces have one, bevels have none (an empty array).
	var windings: Array[Array] = []
	for face in brush.faces:
		brush.planes.append(face.plane)
		windings.append(face.winding)

	# Axial bevels: any axis direction no face already covers, placed at the bounds.
	for axis in 3:
		for dir: float in [-1.0, 1.0]:
			if brush.planes.any(func(p: CollisionPlane) -> bool: return p.normal.component(axis) == dir):
				continue
			var dist := brush.maxs.component(axis) if dir == 1.0 else 0.0 - brush.mins.component(axis)
			brush.planes.append(CollisionPlane.new(Vec3.axial(axis, dir), dist))
			windings.append([])

	# Edge bevels, for brushes that aren't pure boxes.
	if brush.planes.size() != 6:
		for face in brush.faces:
			if _is_axial(face.plane.normal):
				continue
			var w := face.winding
			for j in w.size():
				var edge := w[j].sub(w[(j + 1) % w.size()])
				var edge_length := edge.length()
				if edge_length < MIN_EDGE_LENGTH:
					continue
				var vec := _snap_to_axis(edge.scaled(1.0 / edge_length))
				if _is_axial(vec):
					continue

				for axis in 3:
					for dir: float in [-1.0, 1.0]:
						var n := vec.cross(Vec3.axial(axis, dir))
						var n_length := n.length()
						if n_length < NORMAL_EPSILON:
							continue # edge nearly parallel to this axis
						var normal := n.scaled(1.0 / n_length)
						var candidate := CollisionPlane.new(normal, w[j].dot(normal))

						# A proper bevel is new and has every point of the brush behind it.
						var rejected := false
						for k in brush.planes.size():
							if _planes_equal(brush.planes[k], candidate):
								rejected = true
								break
							for q: Vec3 in windings[k]:
								if q.dot(normal) - candidate.dist > POINT_EPSILON:
									rejected = true
									break
							if rejected:
								break
						if rejected:
							continue
						brush.planes.append(candidate)
						windings.append([])

	var face_contents := 0
	for face in brush.faces:
		face_contents |= face.source.contents
	brush.contents = SimConstants.CONTENTS_SOLID if face_contents == 0 else face_contents
	return brush
