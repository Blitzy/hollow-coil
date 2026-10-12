extends GdUnitTestSuite
## Ported from web/src/sim/collision/trace.test.ts.

const ALL := SimConstants.CONTENTS_SOLID | SimConstants.CONTENTS_WINDOW | SimConstants.CONTENTS_PLAYERCLIP | SimConstants.CONTENTS_MONSTERCLIP

var PLAYER_MINS := Vec3.of(-16, -16, -24)
var PLAYER_MAXS := Vec3.of(16, 16, 32)
var ZERO := Vec3.zero()


func _cube() -> CollisionWorld:
	return TestWorlds.world([TestWorlds.box([0, 0, 0], [64, 64, 64])])


func test_stops_a_point_short_of_the_face_by_dist_epsilon_with_the_face_normal() -> void:
	var t := Trace.box(_cube(), Vec3.of(-100, 32, 32), Vec3.of(100, 32, 32), ZERO, ZERO, ALL)
	assert_float(t.endpos.x).is_equal_approx(-Trace.DIST_EPSILON, 1e-10)
	assert_bool(t.normal.equals(Vec3.of(-1, 0, 0))).is_true()
	assert_bool(t.start_solid).is_false()


func test_stops_a_box_by_its_extents() -> void:
	var t := Trace.box(_cube(), Vec3.of(-100, 32, 32), Vec3.of(100, 32, 32), PLAYER_MINS, PLAYER_MAXS, ALL)
	assert_float(t.endpos.x).is_equal_approx(-16 - Trace.DIST_EPSILON, 1e-10)
	assert_float(t.fraction).is_equal_approx((100 - 16 - Trace.DIST_EPSILON) / 200.0, 1e-10)


func test_reaches_the_end_when_nothing_is_in_the_way() -> void:
	var t := Trace.box(_cube(), Vec3.of(-100, 32, 200), Vec3.of(100, 32, 200), PLAYER_MINS, PLAYER_MAXS, ALL)
	assert_float(t.fraction).is_equal(1.0)
	assert_bool(t.endpos.equals(Vec3.of(100, 32, 200))).is_true()
	assert_bool(t.normal.equals(ZERO)).is_true()


func test_reports_starting_inside_and_being_inside_the_whole_way() -> void:
	var leaving := Trace.box(_cube(), Vec3.of(32, 32, 32), Vec3.of(200, 32, 32), ZERO, ZERO, ALL)
	assert_bool(leaving.start_solid).is_true()
	assert_bool(leaving.all_solid).is_false()
	var stuck := Trace.box(_cube(), Vec3.of(30, 32, 32), Vec3.of(34, 32, 32), ZERO, ZERO, ALL)
	assert_bool(stuck.all_solid).is_true()


func test_tests_position_when_start_equals_end() -> void:
	assert_bool(Trace.box(_cube(), Vec3.of(70, 32, 32), Vec3.of(70, 32, 32), PLAYER_MINS, PLAYER_MAXS, ALL).all_solid).is_true()
	var clear := Trace.box(_cube(), Vec3.of(90, 32, 32), Vec3.of(90, 32, 32), PLAYER_MINS, PLAYER_MAXS, ALL)
	assert_float(clear.fraction).is_equal(1.0)
	assert_bool(clear.all_solid).is_false()


func test_only_collides_with_brushes_whose_contents_match_the_mask() -> void:
	var clip := TestWorlds.world([TestWorlds.box([0, 0, 0], [64, 64, 64], SimConstants.CONTENTS_PLAYERCLIP)])
	var start := Vec3.of(-100, 32, 32)
	var end := Vec3.of(100, 32, 32)
	assert_float(Trace.box(clip, start, end, ZERO, ZERO, SimConstants.CONTENTS_SOLID | SimConstants.CONTENTS_PLAYERCLIP).fraction).is_less(1.0)
	assert_float(Trace.box(clip, start, end, ZERO, ZERO, SimConstants.CONTENTS_SOLID | SimConstants.CONTENTS_MONSTERCLIP).fraction).is_equal(1.0)


# A slope rising from 0 at x = 0 to 32 at x = 64.
func test_lands_a_dropped_point_on_a_slope_with_its_normal() -> void:
	var slope := TestWorlds.world([TestWorlds.ramp_x(0, 64, 0, 64, -16, 0, 32)])
	var nx := -32 / sqrt(32.0 * 32 + 64 * 64)
	var nz := 64 / sqrt(32.0 * 32 + 64 * 64)
	var t := Trace.box(slope, Vec3.of(32, 32, 100), Vec3.of(32, 32, -100), ZERO, ZERO, ALL)
	assert_float(t.normal.x).is_equal_approx(nx, 1e-10)
	assert_float(t.normal.z).is_equal_approx(nz, 1e-10)
	# The surface is at z = 16 here; the stand-off is along the normal, so slightly more than 1/32 vertically.
	assert_float(t.endpos.z).is_equal_approx(16 + Trace.DIST_EPSILON / nz, 1e-6)


func test_doesnt_snag_a_box_just_above_the_high_edge_of_a_slope() -> void:
	var ramp := TestWorlds.ramp_x(0, 64, 0, 64, -16, 0, 32)
	# The box's bottom is at 36, above the ramp's top at 32: clearly not touching.
	var p := Vec3.of(72, 32, 60)
	assert_bool(Trace.box(TestWorlds.world([ramp]), p, p, PLAYER_MINS, PLAYER_MAXS, ALL).all_solid).is_false()
	# Without the +z bevel, the pushed-out slope plane reaches up to z = 72 there and wrongly contains the box.
	# (Bounds are widened so the trace's bounding-box broad phase doesn't hide the planes' mistake.)
	var no_bevel := Brush.new()
	no_bevel.planes.assign(ramp.planes.filter(func(pl: CollisionPlane) -> bool: return pl.normal.z != 1.0))
	no_bevel.contents = ramp.contents
	no_bevel.mins = ramp.mins
	no_bevel.maxs = Vec3.of(ramp.maxs.x, ramp.maxs.y, 1000)
	assert_bool(Trace.box(TestWorlds.world([no_bevel]), p, p, PLAYER_MINS, PLAYER_MAXS, ALL).all_solid).is_true()
