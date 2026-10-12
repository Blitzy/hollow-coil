extends GdUnitTestSuite


func test_arithmetic() -> void:
	var a := Vec3.of(1, 2, 3)
	var b := Vec3.of(4, -5, 6)
	assert_bool(a.add(b).equals(Vec3.of(5, -3, 9))).is_true()
	assert_bool(a.sub(b).equals(Vec3.of(-3, 7, -3))).is_true()
	assert_bool(a.scaled(2).equals(Vec3.of(2, 4, 6))).is_true()
	assert_bool(a.add_scaled(b, 0.5).equals(Vec3.of(3, -0.5, 6))).is_true()
	assert_float(a.dot(b)).is_equal(12.0)
	assert_bool(Vec3.of(1, 0, 0).cross(Vec3.of(0, 1, 0)).equals(Vec3.of(0, 0, 1))).is_true()


func test_length_and_normalize() -> void:
	assert_float(Vec3.of(3, 4, 0).length()).is_equal(5.0)
	assert_bool(Vec3.of(0, 0, 9).normalized().equals(Vec3.of(0, 0, 1))).is_true()
	assert_bool(Vec3.zero().normalized().equals(Vec3.zero())).is_true()


func test_axial_and_component() -> void:
	assert_bool(Vec3.axial(1, -1).equals(Vec3.of(0, -1, 0))).is_true()
	assert_float(Vec3.of(7, 8, 9).component(2)).is_equal(9.0)


func test_keeps_64_bit_precision() -> void:
	# 0.1 + 0.2 isn't representable in 32 bits the same way; Vector3 would round it.
	var v := Vec3.of(0.1, 0, 0).add(Vec3.of(0.2, 0, 0))
	assert_float(v.x).is_equal(0.1 + 0.2)
	assert_bool(Vector3(0.1, 0, 0).x == 0.1).is_false()
