extends GdUnitTestSuite
## Ported from the buildCommand tests in web/src/game/game-helpers.test.ts.


func _held(changes: Dictionary = {}) -> CommandBuilder.HeldInput:
	var input := CommandBuilder.HeldInput.new()
	for key: String in changes:
		input.set(key, changes[key])
	return input


func test_quantizes_view_angles_to_65536_units_per_turn() -> void:
	assert_int(CommandBuilder.build(_held({"yaw": PI / 2})).yaw).is_equal(16384)
	assert_int(CommandBuilder.build(_held({"yaw": -PI / 2})).yaw).is_equal(49152) # wrapped into 0..65535
	assert_int(CommandBuilder.build(_held({"yaw": 4 * PI})).yaw).is_equal(0)
	assert_int(CommandBuilder.build(_held({"pitch": PI / 4})).pitch).is_equal(8192)


func test_clamps_pitch_short_of_straight_up_and_down() -> void:
	var expected := int(floor(CommandBuilder.MAX_PITCH * 65536 / TAU + 0.5))
	assert_int(CommandBuilder.build(_held({"pitch": 3.0})).pitch).is_equal(expected)
	assert_int(CommandBuilder.build(_held({"pitch": -3.0})).pitch).is_equal(-expected)


func test_maps_keys_to_movement_with_opposite_keys_cancelling() -> void:
	var cmd := CommandBuilder.build(_held({"forward": true, "right": true}))
	assert_array([cmd.forward, cmd.side]).is_equal([127, 127])
	cmd = CommandBuilder.build(_held({"back": true, "left": true}))
	assert_array([cmd.forward, cmd.side]).is_equal([-127, -127])
	assert_int(CommandBuilder.build(_held({"forward": true, "back": true})).forward).is_equal(0)


func test_sets_buttons_and_passes_the_weapon_slot_through() -> void:
	var cmd := CommandBuilder.build(_held({"jump": true, "attack": true, "weapon": 2}))
	assert_int(cmd.buttons).is_equal(InputCommand.BUTTON_JUMP | InputCommand.BUTTON_ATTACK)
	assert_int(cmd.weapon).is_equal(2)
