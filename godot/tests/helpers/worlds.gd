class_name TestWorlds
## Small worlds built from boxes and ramps, for tests. Ported from web/src/sim/testing/worlds.ts.


static func _face(points: Array[Vec3], center: Vec3, contents: int) -> MapFace:
	var p0 := points[0]
	var p1 := points[1]
	var p2 := points[2]
	# Order the points so the plane faces away from the brush center.
	if p0.sub(p1).cross(p2.sub(p1)).dot(p0.sub(center)) < 0:
		var swap := p0
		p0 = p2
		p2 = swap
	var face := MapFace.new()
	face.points = [p0, p1, p2]
	face.texture = "dev/grid_grey"
	face.contents = contents
	return face


static func _brush_from(vertices: Array[Vec3], polygons: Array, contents: int) -> Brush:
	var c := Vec3.zero()
	for v in vertices:
		c = c.add(v)
	c = c.scaled(1.0 / vertices.size())
	var faces: Array[MapFace] = []
	for p: Array in polygons:
		faces.append(_face([vertices[p[0]], vertices[p[1]], vertices[p[2]]], c, contents))
	var brush := Brush.build(faces)
	assert(brush != null, "test brush does not enclose a volume")
	return brush


static func box(mins: Array, maxs: Array, contents := 0) -> Brush:
	var v: Array[Vec3] = []
	for x: float in [mins[0], maxs[0]]:
		for y: float in [mins[1], maxs[1]]:
			for z: float in [mins[2], maxs[2]]:
				v.append(Vec3.of(x, y, z))
	return _brush_from(v, [[0, 1, 3], [4, 5, 7], [0, 1, 5], [2, 3, 7], [0, 2, 6], [1, 3, 7]], contents)


## A ramp along x whose top rises from height h0 at x0 to h1 at x1, over a flat bottom.
static func ramp_x(x0: float, x1: float, y0: float, y1: float, bottom: float, h0: float, h1: float) -> Brush:
	var v: Array[Vec3] = [
		Vec3.of(x0, y0, bottom), Vec3.of(x1, y0, bottom), Vec3.of(x1, y1, bottom), Vec3.of(x0, y1, bottom),
		Vec3.of(x0, y0, h0), Vec3.of(x0, y1, h0), Vec3.of(x1, y0, h1), Vec3.of(x1, y1, h1),
	]
	return _brush_from(v, [[0, 1, 2], [0, 3, 5], [1, 2, 7], [0, 1, 6], [3, 2, 7], [4, 6, 7]], 0)


static func world(brushes: Array[Brush]) -> CollisionWorld:
	return CollisionWorld.new(brushes)


## Loads data/player.json the way the game does (the sim itself never reads files).
static func player_data() -> PlayerData:
	return PlayerData.from_dict(JSON.parse_string(ContentPaths.read_text("data/player.json")))
