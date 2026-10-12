extends GdUnitTestSuite
## Ported from web/src/sim/map/parse.test.ts.

const SAMPLE := """// Game: Hollow Coil
// Format: Quake2 (Valve)
// entity 0
{
"classname" "worldspawn"
"message" "Sample { with braces }"
// brush 0
{
( 0 0 0 ) ( 0 64 0 ) ( 0 0 64 ) dev/grid_grey [ 0 1 0 8 ] [ 0 0 -1 -4 ] 15 0.5 2 65536 4 7
( 64 0 0 ) ( 64 0 64 ) ( 64 64 0 ) {fence 16 32 0 1 1
( -1.5 2 3e1 ) ( 1 2 3 ) ( 4 5 6 ) *water [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1
}
}
// entity 1
{
"classname" "info_marker"
"name" "finish"
"origin" "2336 -208 56"
}
"""


func _sample() -> Array[MapEntity]:
	var result := MapParser.parse_map(SAMPLE)
	assert_str(result.error).is_empty()
	return result.entities


func _face(index: int) -> MapFace:
	return _sample()[0].brushes[0][index]


func test_reads_entities_properties_and_brushes() -> void:
	var entities := _sample()
	assert_int(entities.size()).is_equal(2)
	assert_dict(entities[0].properties).is_equal({"classname": "worldspawn", "message": "Sample { with braces }"})
	assert_int(entities[0].brushes.size()).is_equal(1)
	assert_int(entities[0].brushes[0].size()).is_equal(3)
	assert_str(entities[1].properties["name"]).is_equal("finish")
	assert_int(entities[1].brushes.size()).is_equal(0)


func test_reads_valve_220_faces_with_quake_2_fields() -> void:
	var face := _face(0)
	assert_bool(face.points[0].equals(Vec3.of(0, 0, 0))).is_true()
	assert_bool(face.points[1].equals(Vec3.of(0, 64, 0))).is_true()
	assert_bool(face.points[2].equals(Vec3.of(0, 0, 64))).is_true()
	assert_str(face.texture).is_equal("dev/grid_grey")
	assert_int(face.format).is_equal(MapFace.TextureFormat.VALVE)
	assert_array(face.u).is_equal([0.0, 1.0, 0.0, 8.0])
	assert_array(face.v).is_equal([0.0, 0.0, -1.0, -4.0])
	assert_float(face.rotation).is_equal(15.0)
	assert_array(face.scale).is_equal([0.5, 2.0])
	assert_array([face.contents, face.surface_flags, face.value]).is_equal([65536, 4, 7])


func test_reads_standard_faces_and_odd_texture_names() -> void:
	var face := _face(1)
	assert_str(face.texture).is_equal("{fence")
	assert_int(face.format).is_equal(MapFace.TextureFormat.STANDARD)
	assert_array(face.offset).is_equal([16.0, 32.0])
	assert_array([face.contents, face.surface_flags, face.value]).is_equal([0, 0, 0])


func test_reads_decimals_and_exponents_in_points() -> void:
	var face := _face(2)
	assert_str(face.texture).is_equal("*water")
	assert_bool(face.points[0].equals(Vec3.of(-1.5, 2, 30))).is_true()


func test_reports_the_line_of_a_syntax_error() -> void:
	var result := MapParser.parse_map('{\n"classname" "worldspawn"\n{\n( 0 0 0 ) ( 0 64 0 ) oops\n}\n}\n')
	assert_bool(result.ok()).is_false()
	assert_int(result.line).is_equal(4)
	assert_str(result.error).starts_with("line 4: expected '('")
	assert_array(result.entities).is_empty()


func test_rejects_unterminated_entities() -> void:
	var result := MapParser.parse_map('{\n"classname" "worldspawn"\n')
	assert_str(result.error).contains("unterminated entity")


func test_rejects_values_that_are_not_numbers() -> void:
	var result := MapParser.parse_map("{\n{\n( 0 0 x ) ( 0 64 0 ) ( 0 0 64 ) t 0 0 0 1 1\n}\n}\n")
	assert_str(result.error).is_equal("line 3: expected a number, found 'x'")


func test_parse_entities_reads_bsp_style_entity_text() -> void:
	var entities := MapParser.parse_entities('{\n"classname" "worldspawn"\n}\n{\n"classname" "light"\n"light" "300"\n}\n')
	assert_array(entities).is_equal([{"classname": "worldspawn"}, {"classname": "light", "light": "300"}])
