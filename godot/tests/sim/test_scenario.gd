extends GdUnitTestSuite
## Ported from web/src/sim/scenario.test.ts.


func _base() -> Dictionary:
	return {
		"description": "test",
		"status": "unverified",
		"map": "test_movement",
		"duration": 0.5,
		"start": {"marker": "course_start", "yaw": 90},
		"inputs": [{"until": 0.1, "forward": 127}],
		"expect": [{"at": 0.5, "on_ground": true}],
	}


func _fields(cmd: InputCommand) -> Array:
	return [cmd.yaw, cmd.pitch, cmd.forward, cmd.side, cmd.buttons, cmd.weapon]


func test_rounds_seconds_to_the_nearest_tick() -> void:
	assert_int(SimConstants.seconds_to_ticks(0.1)).is_equal(6)
	assert_int(SimConstants.seconds_to_ticks(4.45)).is_equal(267) # 4.45 * 60 is 267.00000000000003 in floating point
	assert_int(SimConstants.seconds_to_ticks(1.0 / 120)).is_equal(1) # exactly half a tick rounds up


func test_converts_degrees_to_angle_units() -> void:
	assert_int(InputCommand.degrees_to_units(90)).is_equal(16384)
	assert_int(InputCommand.degrees_to_units(-45)).is_equal(-8192)
	assert_int(InputCommand.degrees_to_units(1)).is_equal(182) # 182.04 rounds down


func test_holds_each_segments_inputs_over_its_ticks_then_goes_neutral_with_the_view_held() -> void:
	var commands := Scenario.commands(_base())
	assert_int(commands.size()).is_equal(30)
	for i in 6:
		assert_array([commands[i].forward, commands[i].yaw]).is_equal([127, 16384])
	assert_array(_fields(commands[6])).is_equal([16384, 0, 0, 0, 0, 0])


func test_carries_view_angles_between_segments_but_resets_everything_else() -> void:
	var scenario := _base()
	scenario["inputs"] = [
		{"until": 0.1, "yaw": 180, "pitch": 10, "jump": true, "attack": true, "side": -127, "weapon": 2},
		{"until": 0.2, "forward": 50},
	]
	var commands := Scenario.commands(scenario)
	assert_array(_fields(commands[0])).is_equal([32768, 1820, 0, -127, InputCommand.BUTTON_JUMP | InputCommand.BUTTON_ATTACK, 2])
	assert_array(_fields(commands[6])).is_equal([32768, 1820, 50, 0, 0, 0])


func test_wraps_yaw_into_0_to_65535() -> void:
	var scenario := _base()
	scenario["start"] = {"marker": "course_start", "yaw": 359.999}
	assert_int(Scenario.commands(scenario)[0].yaw).is_equal(0)


func test_reports_a_missing_start_marker() -> void:
	var scenario := _base()
	scenario["start"] = {"marker": "nowhere", "yaw": 0}
	var level := Level.from_map(ContentPaths.read_text("maps/test_movement.map"))
	var result := Scenario.run(scenario, level, TestWorlds.player_data())
	assert_bool(result.passed).is_false()
	assert_str(result.error).is_equal('marker "nowhere" not found in test_movement')
