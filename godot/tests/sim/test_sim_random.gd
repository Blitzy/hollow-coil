extends GdUnitTestSuite
## Ported from web/src/sim/rng.test.ts.


func _sequence(seed_value: int, count: int) -> Array[float]:
	var state := SimRandom.seed_state(seed_value)
	var values: Array[float] = []
	for i in count:
		var r := SimRandom.next(state)
		values.append(r.value)
		state = r.state
	return values


func _raw(values: Array[float]) -> Array[int]:
	var out: Array[int] = []
	for v in values:
		out.append(int(v * 4294967296.0))
	return out


func test_produces_values_in_0_to_1() -> void:
	for v in _sequence(12345, 1000):
		assert_float(v).is_greater_equal(0.0)
		assert_float(v).is_less(1.0)


func test_is_reproducible_from_the_seed_and_differs_between_seeds() -> void:
	assert_array(_sequence(7, 10)).is_equal(_sequence(7, 10))
	assert_array(_sequence(7, 10)).is_not_equal(_sequence(8, 10))


func test_matches_the_web_reference_sequence() -> void:
	# The raw 32-bit outputs from web/src/sim/rng.test.ts; both engines must produce these exactly.
	assert_array(_raw(_sequence(0, 5))).is_equal([1144304738, 1416247, 958946056, 627933444, 2007157716])
	assert_array(_raw(_sequence(1, 5))).is_equal([2693262067, 11749833, 2265367787, 4213581821, 4159151403])


func test_imul_matches_javascript_for_large_values() -> void:
	# Math.imul(0xFFFFFFFF, 0xFFFFFFFF) >>> 0 === 1, and Math.imul(0x12345678, 0x9ABCDEF0) >>> 0 === 0x242D2080.
	assert_int(SimRandom._imul(0xFFFFFFFF, 0xFFFFFFFF)).is_equal(1)
	assert_int(SimRandom._imul(0x12345678, 0x9ABCDEF0)).is_equal(0x242D2080)
