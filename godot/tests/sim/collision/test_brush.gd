extends GdUnitTestSuite
## Ported from web/src/sim/collision/brush.test.ts.

const BEVEL_FIXTURES := "web/tests/fixtures/bevels"


func _face(points: Array, contents := 0) -> MapFace:
	var face := MapFace.new()
	for p: Array in points:
		face.points.append(Vec3.of(p[0], p[1], p[2]))
	face.texture = "dev/grid_grey"
	face.contents = contents
	return face


## Faces of an axis-aligned box, with points ordered so each plane faces outward.
func _box_faces(x0: float, y0: float, z0: float, x1: float, y1: float, z1: float, contents := 0) -> Array[MapFace]:
	return [
		_face([[x0, y0, z0], [x0, y1, z0], [x0, y0, z1]], contents),
		_face([[x1, y0, z0], [x1, y0, z1], [x1, y1, z0]], contents),
		_face([[x0, y0, z0], [x0, y0, z1], [x1, y0, z0]], contents),
		_face([[x0, y1, z0], [x1, y1, z0], [x0, y1, z1]], contents),
		_face([[x0, y0, z0], [x1, y0, z0], [x0, y1, z0]], contents),
		_face([[x0, y0, z1], [x0, y1, z1], [x1, y0, z1]], contents),
	]


func _bevel_count(brush: Brush) -> int:
	return brush.planes.size() - brush.faces.size()


func _read_repo_file(relative: String) -> String:
	return FileAccess.get_file_as_string(ContentPaths.repo_root().path_join(relative))


func _parse(relative: String) -> Array[MapEntity]:
	var result := MapParser.parse_map(_read_repo_file(relative))
	assert_str(result.error).is_empty()
	return result.entities


func test_plane_from_points_gives_an_outward_unit_normal_and_distance() -> void:
	var plane := CollisionPlane.from_points(Vec3.of(64, 0, 0), Vec3.of(64, 0, 64), Vec3.of(64, 64, 0))
	assert_bool(plane.normal.equals(Vec3.of(1, 0, 0))).is_true()
	assert_float(plane.dist).is_equal(64.0)


func test_plane_from_points_rejects_collinear_points() -> void:
	assert_object(CollisionPlane.from_points(Vec3.of(0, 0, 0), Vec3.of(1, 1, 1), Vec3.of(2, 2, 2))).is_null()


func test_builds_a_box_with_six_faces_no_bevels_and_its_bounds() -> void:
	var brush := Brush.build(_box_faces(0, 0, 0, 64, 32, 16))
	assert_int(brush.faces.size()).is_equal(6)
	assert_int(_bevel_count(brush)).is_equal(0)
	assert_bool(brush.mins.equals(Vec3.of(0, 0, 0))).is_true()
	assert_bool(brush.maxs.equals(Vec3.of(64, 32, 16))).is_true()
	assert_int(brush.contents).is_equal(SimConstants.CONTENTS_SOLID)
	for face in brush.faces:
		assert_int(face.winding.size()).is_equal(4)


func test_takes_contents_from_the_faces() -> void:
	var brush := Brush.build(_box_faces(0, 0, 0, 64, 64, 64, SimConstants.CONTENTS_PLAYERCLIP))
	assert_int(brush.contents).is_equal(SimConstants.CONTENTS_PLAYERCLIP)


func test_drops_a_redundant_face_and_duplicate_planes() -> void:
	var faces := _box_faces(0, 0, 0, 64, 64, 64)
	faces.append(_face([[100, 0, 0], [100, 0, 64], [100, 64, 0]]))
	faces.append(_box_faces(0, 0, 0, 64, 64, 64)[0])
	var brush := Brush.build(faces)
	assert_int(brush.faces.size()).is_equal(6)
	assert_int(brush.planes.size()).is_equal(6)


func test_rejects_faces_that_dont_enclose_a_volume() -> void:
	assert_object(Brush.build(_box_faces(0, 0, 0, 64, 64, 64).slice(0, 3))).is_null()


## shapes.map and expected.json come from web/tests/fixtures/bevels/generate.py, which
## compiles the shapes with the pinned qbsp and records the planes it stored.
func test_bevels_match_qbsp() -> void:
	var expected: Dictionary = JSON.parse_string(_read_repo_file(BEVEL_FIXTURES.path_join("expected.json")))
	var world := _parse(BEVEL_FIXTURES.path_join("shapes.map"))[0]
	var shape_brushes := world.brushes.slice(6) # after the six room walls, in the order of expected.json
	var names := expected.keys()
	assert_int(shape_brushes.size()).is_equal(names.size())
	for i in names.size():
		var name: String = names[i]
		var faces: Array[MapFace] = []
		faces.assign(shape_brushes[i])
		var brush := Brush.build(faces)
		var planes: Array = expected[name]
		assert_int(brush.planes.size()).override_failure_message("%s: plane count" % name).is_equal(planes.size())
		for plane: Array in planes:
			var found := brush.planes.any(func(p: CollisionPlane) -> bool:
				return (absf(p.normal.x - plane[0]) < 1e-5 and absf(p.normal.y - plane[1]) < 1e-5
					and absf(p.normal.z - plane[2]) < 1e-5 and absf(p.dist - plane[3]) < 2e-3))
			assert_bool(found).override_failure_message("%s: missing plane %s" % [name, plane]).is_true()


func test_every_brush_in_the_repo_maps_builds() -> void:
	var maps_dir := ContentPaths.repo_root().path_join("maps")
	var files := Array(DirAccess.get_files_at(maps_dir)).filter(func(f: String) -> bool: return f.ends_with(".map"))
	assert_array(files).is_not_empty()
	for file: String in files:
		var world := _parse("maps".path_join(file))[0]
		for brush_faces: Array in world.brushes:
			var faces: Array[MapFace] = []
			faces.assign(brush_faces)
			assert_object(Brush.build(faces)).override_failure_message("%s: a brush did not build" % file).is_not_null()


func test_test_movement_gets_the_3_bevels_qbsp_reports() -> void:
	var world := _parse("maps/test_movement.map")[0]
	var total := 0
	for brush_faces: Array in world.brushes:
		var faces: Array[MapFace] = []
		faces.assign(brush_faces)
		total += _bevel_count(Brush.build(faces))
	assert_int(total).is_equal(3)
