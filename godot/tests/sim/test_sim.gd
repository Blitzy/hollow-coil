extends GdUnitTestSuite
## Ported from web/src/sim/sim.test.ts, plus hashes shared with the web build.

var player := TestWorlds.player_data()
var level := Level.from_map(ContentPaths.read_text("maps/test_movement.map"))
var ctx := Sim.movement_context(level, player)


## Inputs that exercise running, turning, strafing, and jumping (the same script as the web test).
func _script(tick: int) -> InputCommand:
	return InputCommand.make(127, 64 if tick % 120 < 60 else -64, InputCommand.BUTTON_JUMP if tick % 90 < 3 else 0, (tick * 97) % 65536)


## Steps from one tick to another; returns the final state and the hash after every tick.
func _simulate(start: SimState, from_tick: int, to_tick: int, script: Callable = _script) -> Array:
	var state := start
	var hashes := PackedStringArray()
	for t in range(from_tick, to_tick):
		state = Sim.step(state, script.call(t), ctx).state
		hashes.append(Snapshot.hash_state(state))
	return [state, hashes]


func _spawn_at_course_start() -> SimState:
	return Sim.create(player, level.markers["course_start"], 0, 0, 42)


# --- level ------------------------------------------------------------------


func test_level_reads_markers_and_the_player_start_from_the_map() -> void:
	assert_str(level.error).is_empty()
	assert_bool(level.markers["step18_start"].equals(Vec3.of(64, 144, 24))).is_true()
	assert_int(level.markers.size()).is_equal(6)
	assert_bool(level.player_start_origin.equals(Vec3.of(-64, -208, 24))).is_true()
	assert_float(level.player_start_angle).is_equal(0.0)
	assert_int(level.world.brushes.size()).is_equal(level.brushes.size())


func test_level_rejects_a_map_without_worldspawn_first() -> void:
	assert_str(Level.from_map('{\n"classname" "light"\n}\n').error).is_equal("the first entity must be worldspawn")
	assert_str(Level.from_map("{ oops").error).starts_with("line 1:")


# --- spawning ---------------------------------------------------------------


func test_spawning_raises_the_origin_and_settles_onto_the_floor_on_the_first_tick() -> void:
	var sim := _spawn_at_course_start()
	assert_int(sim.player.id).is_equal(SimState.PLAYER_ID)
	assert_bool(sim.player.on_ground).is_false()
	assert_int(sim.player.health).is_equal(player.health)
	assert_bool(sim.player.origin.equals(Vec3.of(-64, -208, 24 + Sim.SPAWN_RAISE))).is_true()
	var after := Sim.step(sim, InputCommand.neutral(), ctx).state
	assert_bool(after.player.on_ground).is_true()
	assert_float(after.player.origin.z).is_equal_approx(24 + Trace.DIST_EPSILON, 1e-10)
	assert_int(after.tick).is_equal(1)


func test_step_keeps_the_latest_commands_view_angles() -> void:
	var after := Sim.step(_spawn_at_course_start(), InputCommand.make(0, 0, 0, 16384, -2000), ctx).state
	assert_array([after.player.yaw, after.player.pitch]).is_equal([16384, -2000])


# --- determinism, snapshots, and hashes -------------------------------------


func test_produces_the_same_hash_every_tick_when_run_twice() -> void:
	assert_array(_simulate(_spawn_at_course_start(), 0, 600)[1]).is_equal(_simulate(_spawn_at_course_start(), 0, 600)[1])


func test_re_simulating_from_a_restored_snapshot_reproduces_the_same_hashes() -> void:
	var full := _simulate(_spawn_at_course_start(), 0, 600)
	var midway: SimState = _simulate(_spawn_at_course_start(), 0, 250)[0]
	var restored := Snapshot.restore(Snapshot.take(midway))
	assert_str(Snapshot.hash_state(restored)).is_equal(Snapshot.hash_state(midway))
	var resumed := _simulate(restored, 250, 600)
	var full_hashes: PackedStringArray = full[1]
	assert_array(resumed[1]).is_equal(full_hashes.slice(250))
	assert_array(Snapshot.take(resumed[0])).is_equal(Snapshot.take(full[0]))


func test_snapshots_restore_floats_exactly() -> void:
	# Godot's JSON parser reads this value back one bit off; snapshots must not.
	var sim := _spawn_at_course_start()
	sim.player.origin = Vec3.of(504.66885717102565, -1.0 / 3.0, 1e-300)
	var restored := Snapshot.restore(Snapshot.take(sim))
	assert_bool(restored.player.origin.equals(sim.player.origin)).is_true()
	assert_str(Snapshot.hash_state(restored)).is_equal(Snapshot.hash_state(sim))


func test_to_json_reads_like_the_web_snapshot() -> void:
	var json := Snapshot.to_json(_spawn_at_course_start())
	assert_str(json).starts_with('{"tick":0,"rng":42,"nextEntityId":2,"player":{"id":1,"origin":{"x":-64.0,"y":-208.0,"z":25.0}')


func test_changes_the_hash_when_any_value_changes() -> void:
	var base := Snapshot.hash_state(_spawn_at_course_start())
	var changed: Array[Callable] = [
		func(s: SimState) -> void: s.tick = 1,
		func(s: SimState) -> void: s.rng += 1,
		func(s: SimState) -> void: s.player.origin = Vec3.of(-64, -208, 25.000001),
		func(s: SimState) -> void: s.player.on_ground = true,
	]
	for change in changed:
		var s := _spawn_at_course_start()
		change.call(s)
		assert_str(Snapshot.hash_state(s)).is_not_equal(base)


func test_hash_doesnt_depend_on_key_order_and_treats_negative_zero_like_zero() -> void:
	var sim := _spawn_at_course_start()
	var d := sim.to_dict()
	var reordered := {"player": d["player"], "nextEntityId": d["nextEntityId"], "rng": d["rng"], "tick": d["tick"]}
	assert_str(Snapshot.hash_value(reordered)).is_equal(Snapshot.hash_state(sim))
	var negative_zero := _spawn_at_course_start()
	negative_zero.player.velocity = Vec3.of(-0.0, 0, -0.0)
	assert_str(Snapshot.hash_state(negative_zero)).is_equal(Snapshot.hash_state(sim))


# --- the same state hashes the same in both engines --------------------------
# Reference hashes from the web build (web/src/sim), for test_movement with seed 42.


func test_spawn_state_hashes_the_same_as_the_web_build() -> void:
	assert_str(Snapshot.hash_state(_spawn_at_course_start())).is_equal("2cc31886")


func test_running_and_jumping_east_matches_the_web_build_bit_for_bit() -> void:
	# Facing yaw 0 uses no trig rounding (cos 0 = 1, sin 0 = 0), so both engines' 64-bit math should agree exactly.
	var east := func(_t: int) -> InputCommand: return InputCommand.make(127)
	var east_jump := func(t: int) -> InputCommand: return InputCommand.make(127, 0, InputCommand.BUTTON_JUMP if t % 90 < 3 else 0)
	assert_str(Snapshot.hash_state(_simulate(_spawn_at_course_start(), 0, 120, east)[0])).is_equal("1102a7e6")
	assert_str(Snapshot.hash_state(_simulate(_spawn_at_course_start(), 0, 240, east_jump)[0])).is_equal("b377a361")
