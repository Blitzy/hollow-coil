extends GdUnitTestSuite
## Ported from web/src/sim/player/movement.test.ts.

const DT := 1.0 / SimConstants.TICK_RATE
# A standing player rests 1/32 above the floor (the trace stand-off), so their origin is at STAND_Z.
# A box exactly touching a surface counts as inside it.
const STAND_Z := 24 + Trace.DIST_EPSILON

var player := TestWorlds.player_data()
var mv := player.movement
var X := Vec3.of(1, 0, 0)
var Y := Vec3.of(0, 1, 0)
var ZERO := Vec3.zero()


func _context(brushes: Array[Brush]) -> PlayerMovement.Context:
	return PlayerMovement.Context.new(TestWorlds.world(brushes), player)


## A big floor whose top is at z = 0.
func _floor() -> Brush:
	return TestWorlds.box([-1024, -1024, -16], [1024, 1024, 0])


## 63 degrees: rises 128 over 64 from x = 256, then a 128-high block.
func _steep_slope() -> PlayerMovement.Context:
	return _context([_floor(), TestWorlds.ramp_x(256, 320, -512, 512, -16, 0, 128), TestWorlds.box([320, -512, 0], [640, 512, 128])])


func _body(origin: Vec3, velocity: Vec3 = Vec3.zero(), on_ground := false) -> PlayerBody:
	return PlayerBody.new(origin, velocity, on_ground)


func _mover(origin: Vec3, velocity: Vec3, on_ground: bool) -> PlayerMovement.Mover:
	return PlayerMovement.Mover.new(origin, velocity, on_ground)


func _run_east(_tick: int) -> InputCommand:
	return InputCommand.make(127)


func _neutral(_tick: int) -> InputCommand:
	return InputCommand.neutral()


func _hold_jump(_tick: int) -> InputCommand:
	return InputCommand.make(0, 0, InputCommand.BUTTON_JUMP)


## Runs movement for a number of seconds; returns every state, the start included.
func _run(ctx: PlayerMovement.Context, start: PlayerBody, seconds: float, cmd: Callable = _run_east) -> Array[PlayerBody]:
	var states: Array[PlayerBody] = [start]
	for tick in roundi(seconds * SimConstants.TICK_RATE):
		states.append(PlayerMovement.player_move(states.back(), cmd.call(tick), ctx))
	return states


func _max_z(states: Array[PlayerBody]) -> float:
	var top := -INF
	for s in states:
		top = maxf(top, s.origin.z)
	return top


func _assert_vec(actual: Vec3, expected: Vec3) -> void:
	assert_bool(actual.equals(expected)).override_failure_message("expected %s, got %s" % [expected, actual]).is_true()


# --- clip_velocity ----------------------------------------------------------


func test_clip_velocity_removes_the_part_going_into_a_floor_or_wall() -> void:
	_assert_vec(PlayerMovement.clip_velocity(Vec3.of(100, 0, -50), Vec3.of(0, 0, 1), 1), Vec3.of(100, 0, 0))
	_assert_vec(PlayerMovement.clip_velocity(Vec3.of(100, 50, 0), Vec3.of(-1, 0, 0), 1), Vec3.of(0, 50, 0))


func test_clip_velocity_snaps_tiny_components_to_zero() -> void:
	_assert_vec(PlayerMovement.clip_velocity(Vec3.of(100, 0.05, -10), Vec3.of(0, 0, 1), 1), Vec3.of(100, 0, 0))


# --- accelerate -------------------------------------------------------------


func test_accelerate_adds_accel_dt_wish_speed_per_tick_and_never_passes_the_wish_speed() -> void:
	var v := PlayerMovement.accelerate(ZERO, X, 320, 10)
	assert_float(v.x).is_equal_approx(10 * DT * 320, 1e-10)
	for i in 20:
		v = PlayerMovement.accelerate(v, X, 320, 10)
	assert_float(v.x).is_equal(320.0)


func test_accelerate_does_nothing_when_already_faster_than_the_wish_speed() -> void:
	_assert_vec(PlayerMovement.accelerate(Vec3.of(400, 0, 0), X, 320, 10), Vec3.of(400, 0, 0))


# --- air_accelerate ---------------------------------------------------------


func test_air_accelerate_caps_the_speed_gained_along_the_wish_direction() -> void:
	var v := PlayerMovement.air_accelerate(ZERO, X, 320, mv.air_accelerate, mv.air_wish_speed_cap)
	assert_float(v.x).is_equal(30.0)
	_assert_vec(PlayerMovement.air_accelerate(v, X, 320, mv.air_accelerate, mv.air_wish_speed_cap), v)


func test_air_accelerate_uses_the_uncapped_wish_speed_for_the_rate_so_strafing_gains_speed() -> void:
	# Moving east at full speed, wishing north: the north component can grow by up to 30.
	var v := PlayerMovement.air_accelerate(Vec3.of(320, 0, 0), Y, 320, mv.air_accelerate, mv.air_wish_speed_cap)
	assert_float(v.y).is_equal(30.0) # rate 10 * 320 / 60 = 53.3 per tick, limited by the cap of 30
	assert_float(v.length()).is_greater(320.0)
	# With a small wish speed, the rate (10 * 60 / 60 = 10) is what limits it.
	assert_float(PlayerMovement.air_accelerate(ZERO, Y, 60, mv.air_accelerate, mv.air_wish_speed_cap).y).is_equal_approx(10, 1e-10)


# --- friction ---------------------------------------------------------------


func test_friction_slows_by_speed_times_friction_times_dt_above_the_stop_speed() -> void:
	var m := _mover(Vec3.of(0, 0, STAND_Z), Vec3.of(300, 0, 0), true)
	PlayerMovement.friction(m, _context([_floor()]))
	assert_float(m.velocity.x).is_equal_approx(300 - 300 * mv.friction * DT, 1e-10)


func test_friction_uses_the_stop_speed_as_a_floor_for_the_slowdown() -> void:
	var m := _mover(Vec3.of(0, 0, STAND_Z), Vec3.of(50, 0, 0), true)
	PlayerMovement.friction(m, _context([_floor()]))
	assert_float(m.velocity.x).is_equal_approx(50 - mv.stop_speed * mv.friction * DT, 1e-10)


func test_friction_stops_horizontal_movement_below_1_unit_per_second() -> void:
	var m := _mover(Vec3.of(0, 0, STAND_Z), Vec3.of(0.5, 0.5, 0), true)
	PlayerMovement.friction(m, _context([_floor()]))
	_assert_vec(m.velocity, ZERO)


func test_friction_doesnt_apply_in_the_air() -> void:
	var m := _mover(Vec3.of(0, 0, 200), Vec3.of(300, 0, 0), false)
	PlayerMovement.friction(m, _context([_floor()]))
	assert_float(m.velocity.x).is_equal(300.0)


func test_friction_doubles_near_a_drop_off_and_not_on_open_floor() -> void:
	var ledge := _context([TestWorlds.box([-512, -512, -16], [0, 512, 0])]) # floor ends at x = 0
	var near_edge := _mover(Vec3.of(-10, 0, STAND_Z), Vec3.of(300, 0, 0), true) # probe at x = 6 is over the drop
	var away_from_edge := _mover(Vec3.of(-40, 0, STAND_Z), Vec3.of(300, 0, 0), true) # probe at x = -24 is over floor
	PlayerMovement.friction(near_edge, ledge)
	PlayerMovement.friction(away_from_edge, ledge)
	assert_float(near_edge.velocity.x).is_equal_approx(300 - 300 * mv.friction * mv.edge_friction * DT, 1e-10)
	assert_float(away_from_edge.velocity.x).is_equal_approx(300 - 300 * mv.friction * DT, 1e-10)


# --- ground -----------------------------------------------------------------


func test_ground_counts_a_walkable_surface_and_settles_onto_it() -> void:
	var m := _mover(Vec3.of(0, 0, 24.5), ZERO, false)
	PlayerMovement.categorize_position(m, _context([_floor()]))
	assert_bool(m.on_ground).is_true()
	assert_float(m.origin.z).is_equal_approx(STAND_Z, 1e-10)


func test_ground_treats_a_box_exactly_touching_the_floor_as_stuck_in_it() -> void:
	var m := _mover(Vec3.of(0, 0, 24), ZERO, false)
	PlayerMovement.categorize_position(m, _context([_floor()]))
	assert_bool(m.on_ground).is_false() # the ground trace starts solid; spawning raises the origin to avoid this


func test_ground_is_never_on_ground_while_rising_faster_than_180() -> void:
	var m := _mover(Vec3.of(0, 0, 24.5), Vec3.of(0, 0, 200), true)
	PlayerMovement.categorize_position(m, _context([_floor()]))
	assert_bool(m.on_ground).is_false()


func test_ground_stands_on_a_slope_with_normal_z_above_0_7_but_not_on_a_steeper_one() -> void:
	# Wide ramps with nothing below: 64 over 72 (normal z 0.747) and 64 over 60 (0.684).
	var gentle := _context([TestWorlds.ramp_x(-36, 36, -256, 256, -512, -32, 32)])
	var steep := _context([TestWorlds.ramp_x(-30, 30, -256, 256, -512, -32, 32)])
	var on_gentle: PlayerBody = _run(gentle, _body(Vec3.of(0, 0, 100)), 1, _neutral).back()
	var on_steep: PlayerBody = _run(steep, _body(Vec3.of(0, 0, 100)), 0.5, _neutral).back()
	assert_bool(on_gentle.on_ground).is_true()
	_assert_vec(on_gentle.velocity, ZERO)
	assert_bool(on_steep.on_ground).is_false()


# --- walking and steps ------------------------------------------------------


func _step_world(height: float) -> PlayerMovement.Context:
	return _context([_floor(), TestWorlds.box([256, -512, 0], [1024, 512, height])])


func _standing_at_64() -> PlayerBody:
	return _body(Vec3.of(64, 0, STAND_Z), ZERO, true)


func test_reaches_max_ground_speed_and_holds_it() -> void:
	var end: PlayerBody = _run(_context([_floor()]), _standing_at_64(), 1).back()
	assert_float(end.velocity.x).is_equal_approx(mv.max_ground_speed, 1e-6)
	assert_float(end.origin.z).is_equal_approx(STAND_Z, 1e-6)


func test_walks_up_an_18_unit_step() -> void:
	var end: PlayerBody = _run(_step_world(18), _standing_at_64(), 1.5).back()
	assert_float(end.origin.x).is_greater(256 + 16)
	assert_float(end.origin.z).is_equal_approx(18 + 24, 0.05)
	assert_bool(end.on_ground).is_true()


func test_is_blocked_by_a_20_unit_step() -> void:
	var end: PlayerBody = _run(_step_world(20), _standing_at_64(), 1.5).back()
	assert_float(end.origin.x).is_equal_approx(256 - 16 - Trace.DIST_EPSILON, 1e-6)
	assert_float(end.origin.z).is_equal_approx(STAND_Z, 1e-6)
	assert_float(end.velocity.x).is_equal(0.0)


func test_slides_smoothly_down_a_slope_too_steep_to_stand_on_without_stopping() -> void:
	# Sliding along it used to stop dead every so often, when rounding made the
	# slide hit the same plane twice (fixed with Quake 3's nudge).
	var states := _run(_steep_slope(), _body(Vec3.of(290, 0, 150)), 1, _neutral)
	var first_contact := -1
	var landed := -1
	for i in states.size():
		if first_contact < 0 and states[i].velocity.x < 0:
			first_contact = i
		if landed < 0 and states[i].on_ground:
			landed = i
	assert_int(first_contact).is_greater(0)
	assert_int(landed).is_greater(first_contact)
	for i in range(first_contact + 1, landed):
		assert_float(states[i].origin.z).override_failure_message("tick %d didn't descend" % i).is_less(states[i - 1].origin.z)
		assert_float(states[i].velocity.length()).override_failure_message("tick %d slowed down" % i) \
			.is_greater(states[i - 1].velocity.length() - 1e-9)


func test_refuses_to_step_onto_a_surface_too_steep_to_stand_on() -> void:
	var states := _run(_steep_slope(), _standing_at_64(), 2)
	assert_float(_max_z(states)).is_less(128.0)
	assert_float(states.back().origin.x).is_less(320.0)


# --- steep slopes (a deliberate departure from QuakeWorld) -----------------
# On a 63-degree slope, in QuakeWorld, holding forward slowly climbs it.


func _hold_forward(start: PlayerBody, seconds: float, side := 0) -> Array[PlayerBody]:
	return _run(_steep_slope(), start, seconds, func(_tick: int) -> InputCommand: return InputCommand.make(127, side))


func test_steep_slopes_cant_be_climbed_from_the_floor_the_player_stays_put_like_at_a_wall() -> void:
	var states := _hold_forward(_body(Vec3.of(200, 0, STAND_Z), ZERO, true), 4)
	assert_float(_max_z(states)).is_equal_approx(STAND_Z, 1e-6)
	for i in range(60, states.size()):
		assert_bool(states[i].on_ground).override_failure_message("hopped at tick %d" % i).is_true() # no hopping at the foot
	# Pressed against the slope's foot (x = 256), minus the hull's 16, give or take the sloped stand-off.
	assert_float(states.back().origin.x).is_equal_approx(240, 0.05)


func test_steep_slopes_cant_be_climbed_from_on_them_the_player_slides_down() -> void:
	var states := _hold_forward(_body(Vec3.of(290, 0, 150)), 3)
	assert_float(states.back().origin.z).is_equal_approx(STAND_Z, 1e-6)
	for i in range(states.size() - 60, states.size()):
		assert_bool(states[i].on_ground).is_true()


func test_steep_slopes_still_allow_moving_sideways_along_them() -> void:
	var end: PlayerBody = _hold_forward(_body(Vec3.of(290, 0, 150)), 2, 127).back()
	assert_float(end.origin.y).is_less(-200.0) # strafed right (toward -y) while sliding down


func test_without_push_into_removes_only_the_horizontal_push_into_the_surface() -> void:
	var slope := Vec3.of(-0.894, 0, 0.447) # faces -x and up
	assert_float(PlayerMovement.without_push_into(X, 320, slope).speed).is_equal(0.0)
	var diagonal := PlayerMovement.without_push_into(Vec3.of(sqrt(0.5), sqrt(0.5), 0), 320, slope)
	assert_float(diagonal.dir.x).is_equal_approx(0, 1e-10)
	assert_float(diagonal.dir.y).is_equal_approx(1, 1e-10)
	assert_float(diagonal.speed).is_equal_approx(320 * sqrt(0.5), 1e-10)
	var away := PlayerMovement.without_push_into(Vec3.of(-1, 0, 0), 320, slope) # moving away is untouched
	_assert_vec(away.dir, Vec3.of(-1, 0, 0))
	assert_float(away.speed).is_equal(320.0)


func test_as_wall_if_steep_flattens_only_too_steep_upward_surfaces() -> void:
	_assert_vec(PlayerMovement.as_wall_if_steep(Vec3.of(-0.894, 0, 0.447)), Vec3.of(-1, 0, 0))
	var walkable := Vec3.of(-0.447, 0, 0.894)
	assert_object(PlayerMovement.as_wall_if_steep(walkable)).is_same(walkable)
	var ceiling := Vec3.of(0, 0, -1)
	assert_object(PlayerMovement.as_wall_if_steep(ceiling)).is_same(ceiling)


# --- jumping ----------------------------------------------------------------


func _standing() -> PlayerBody:
	return _body(Vec3.of(0, 0, STAND_Z), ZERO, true)


func _jump_starts(states: Array[PlayerBody]) -> int:
	var count := 0
	for i in range(1, states.size()):
		if states[i].velocity.z > 0 and states[i - 1].velocity.z <= 0:
			count += 1
	return count


func test_jump_starts_with_jump_velocity_minus_one_tick_of_gravity() -> void:
	var first := _run(_context([_floor()]), _standing(), DT, _hold_jump)[1]
	assert_float(first.velocity.z).is_equal_approx(mv.jump_velocity - mv.gravity * DT, 1e-10)
	assert_bool(first.on_ground).is_false()


func test_doesnt_jump_again_while_jump_stays_held() -> void:
	assert_int(_jump_starts(_run(_context([_floor()]), _standing(), 2, _hold_jump))).is_equal(1)


func test_jumps_again_after_releasing_and_pressing() -> void:
	# Held for the first second, released for one tick, then held again.
	var cmd := func(tick: int) -> InputCommand:
		return InputCommand.make(0, 0, 0 if tick == SimConstants.TICK_RATE else InputCommand.BUTTON_JUMP)
	assert_int(_jump_starts(_run(_context([_floor()]), _standing(), 2, cmd))).is_equal(2)


func test_skips_friction_on_the_tick_a_jump_starts() -> void:
	var moving := _body(Vec3.of(0, 0, STAND_Z), Vec3.of(300, 0, 0), true)
	var jumped := _run(_context([_floor()]), moving, DT, _hold_jump)[1]
	var walked := _run(_context([_floor()]), moving, DT, _neutral)[1]
	assert_float(jumped.velocity.x).is_equal(300.0)
	assert_float(walked.velocity.x).is_equal_approx(300 - 300 * mv.friction * DT, 1e-10)


func test_clears_about_45_units_at_the_peak_of_a_jump() -> void:
	var cmd := func(tick: int) -> InputCommand: return InputCommand.make(0, 0, InputCommand.BUTTON_JUMP if tick == 0 else 0)
	var peak := _max_z(_run(_context([_floor()]), _standing(), 1, cmd)) - STAND_Z
	# v^2 / 2g = 270^2 / 1600 = 45.6, a little less with discrete ticks.
	assert_float(peak).is_greater(43.0)
	assert_float(peak).is_less(46.0)
