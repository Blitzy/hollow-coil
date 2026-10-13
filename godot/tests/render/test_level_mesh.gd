extends GdUnitTestSuite

## One 64-unit cube from (0, 0, 0), plus a player start, as .map text.
const CUBE_MAP := """{
"classname" "worldspawn"
{
( 0 0 0 ) ( 0 64 0 ) ( 0 0 64 ) dev/grid_grey [ 0 1 0 0 ] [ 0 0 -1 0 ] 0 1 1
( 64 0 0 ) ( 64 0 64 ) ( 64 64 0 ) dev/grid_grey [ 0 1 0 0 ] [ 0 0 -1 0 ] 0 1 1
( 0 0 0 ) ( 0 0 64 ) ( 64 0 0 ) dev/grid_light [ 1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1
( 0 64 0 ) ( 64 64 0 ) ( 0 64 64 ) dev/grid_light [ 1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1
( 0 0 0 ) ( 64 0 0 ) ( 0 64 0 ) dev/grid_dark [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1
( 0 0 64 ) ( 0 64 64 ) ( 64 0 64 ) dev/grid_dark [ 1 0 0 16 ] [ 0 -1 0 0 ] 0 1 1
}
}
"""


func _cube() -> Level:
	var level := Level.from_map(CUBE_MAP)
	assert_str(level.error).is_empty()
	return level


func _size(_name: String) -> Vector2i:
	return Vector2i(64, 32)


func test_lists_the_textures_once_each_sorted() -> void:
	assert_array(LevelMesh.texture_names(_cube())).is_equal(["dev/grid_dark", "dev/grid_grey", "dev/grid_light"])


func test_fans_each_face_into_triangles_batched_by_texture() -> void:
	var surfaces := LevelMesh.surfaces(_cube(), _size)
	assert_array(surfaces.keys()).contains_exactly_in_any_order(["dev/grid_dark", "dev/grid_grey", "dev/grid_light"])
	for name in surfaces:
		var s := surfaces[name]
		assert_int(s.positions.size()).is_equal(12) # two faces, two triangles each, three vertices each
		assert_int(s.uvs.size()).is_equal(12)
		assert_int(s.colors.size()).is_equal(12)


func test_winds_triangles_clockwise_seen_from_outside_godots_front_face() -> void:
	var center := QuakeCoords.to_godot(Vec3.of(32, 32, 32))
	for name in LevelMesh.surfaces(_cube(), _size).values():
		var p: PackedVector3Array = name.positions
		for i in range(0, p.size(), 3):
			var outward := (p[i] + p[i + 1] + p[i + 2]) / 3.0 - center
			# In right-handed coordinates, a clockwise triangle's cross product points away from the viewer.
			assert_float((p[i + 1] - p[i]).cross(p[i + 2] - p[i]).dot(outward)).is_less(0.0)


func test_gives_each_vertex_its_texture_uv_and_face_shade() -> void:
	var top := LevelMesh.surfaces(_cube(), _size)["dev/grid_dark"]
	for i in top.positions.size():
		var q := top.positions[i] # Godot coordinates: Quake (x, y, z) is (x, -z, y) here
		var quake := Vec3.of(q.x, -q.z, q.y)
		var expected_s := quake.x + (16.0 if quake.z == 64 else 0.0) # only the top face has an s offset
		assert_vector(top.uvs[i]).is_equal_approx(Vector2(expected_s / 64.0, -quake.y / 32.0), Vector2.ONE * 1e-6)
		var shade := LevelMesh.face_shade(Vec3.of(0, 0, 1 if quake.z == 64 else -1))
		assert_float(top.colors[i].r).is_equal_approx(shade, 1e-6)


func test_builds_a_mesh_with_one_named_surface_per_texture() -> void:
	var level := _cube()
	var instance := LevelMesh.build(level, LevelMesh.load_textures(LevelMesh.texture_names(level)))
	var mesh: ArrayMesh = instance.mesh
	assert_int(mesh.get_surface_count()).is_equal(3)
	var names := []
	for i in mesh.get_surface_count():
		names.append(mesh.surface_get_name(i))
		var material: StandardMaterial3D = mesh.surface_get_material(i)
		assert_object(material.albedo_texture).is_not_null()
	assert_array(names).contains_exactly_in_any_order(["dev/grid_dark", "dev/grid_grey", "dev/grid_light"])
	instance.free()


func test_loads_real_textures_and_substitutes_missing_ones() -> void:
	var textures := LevelMesh.load_textures(PackedStringArray(["dev/grid_grey", "dev/does_not_exist"]))
	assert_int(textures["dev/grid_grey"].get_width()).is_greater(2)
	assert_int(textures["dev/does_not_exist"].get_width()).is_equal(2) # the magenta and black checkerboard
