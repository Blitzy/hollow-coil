extends GdUnitTestSuite
## Ported from web/src/render/render-helpers.test.ts.

var UP := Vec3.of(0, 0, 1)


func _face(format := MapFace.TextureFormat.STANDARD, rotation := 0.0, scale := [1.0, 1.0]) -> MapFace:
	var face := MapFace.new()
	face.points = [Vec3.of(0, 0, 0), Vec3.of(1, 0, 0), Vec3.of(0, 1, 0)]
	face.texture = "dev/grid_grey"
	face.format = format
	face.offset = PackedFloat64Array([0, 0])
	face.rotation = rotation
	face.scale = PackedFloat64Array(scale)
	return face


# --- coordinates ------------------------------------------------------------


func test_maps_quake_z_up_to_godot_y_up() -> void:
	assert_vector(QuakeCoords.to_godot(Vec3.of(1, 2, 3))).is_equal(Vector3(1, 3, -2))


func test_points_the_camera_along_the_quake_yaw() -> void:
	var camera := Node3D.new()
	for case: Array in [[0.0, Vector3(1, 0, 0)], [PI / 2, Vector3(0, 0, -1)]]: # Quake +x is Godot +X; Quake +y is Godot -Z
		camera.rotation = QuakeCoords.camera_rotation(case[0], 0)
		assert_vector(-camera.basis.z).is_equal_approx(case[1], Vector3.ONE * 1e-6)
	camera.rotation = QuakeCoords.camera_rotation(0, 0.5) # positive pitch looks up
	assert_float((-camera.basis.z).y).is_greater(0.0)
	camera.free()


# --- texture coordinates ----------------------------------------------------


func test_uses_valve_220_axes_offsets_and_scale() -> void:
	var valve := _face(MapFace.TextureFormat.VALVE, 0, [2.0, 0.5])
	valve.u = PackedFloat64Array([1, 0, 0, 8])
	valve.v = PackedFloat64Array([0, -1, 0, 4])
	assert_vector(TextureAxes.for_face(valve, UP).texel_coords(Vec3.of(16, 32, 0))).is_equal(Vector2(16.0 / 2 + 8, -32 / 0.5 + 4))


func test_derives_standard_format_axes_from_the_face_normal() -> void:
	var floor := _face(MapFace.TextureFormat.STANDARD, 0, [2.0, 1.0])
	floor.offset = PackedFloat64Array([8, 4])
	assert_vector(TextureAxes.for_face(floor, UP).texel_coords(Vec3.of(16, 32, 0))).is_equal(Vector2(16.0 / 2 + 8, -32 + 4))
	var east_wall := TextureAxes.for_face(_face(), Vec3.of(1, 0, 0))
	assert_vector(east_wall.texel_coords(Vec3.of(64, 16, 48))).is_equal(Vector2(16, -48))


func test_rotates_standard_format_axes_exactly_for_right_angles() -> void:
	var rotated := TextureAxes.for_face(_face(MapFace.TextureFormat.STANDARD, 90), UP)
	assert_bool(rotated.s.equals(Vec3.of(0, 1, 0))).is_true()
	assert_bool(rotated.t.equals(Vec3.of(1, 0, 0))).is_true()


# --- face shading -----------------------------------------------------------


func test_lights_floors_most_and_ceilings_least() -> void:
	assert_float(LevelMesh.face_shade(Vec3.of(0, 0, 1))).is_greater(LevelMesh.face_shade(Vec3.of(1, 0, 0)))
	assert_float(LevelMesh.face_shade(Vec3.of(1, 0, 0))).is_greater(LevelMesh.face_shade(Vec3.of(0, 0, -1)))
