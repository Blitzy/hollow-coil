extends GdUnitTestSuite
## Smoke test: the main scene loads a map, builds its mesh, and runs the sim.


func test_main_scene_loads_the_map_and_steps_the_sim() -> void:
	var runner := scene_runner("res://scenes/main.tscn")
	# simulate_frames is declared abstract, so the analyzer can't see that it's a coroutine; the await is needed.
	@warning_ignore("redundant_await")
	await runner.simulate_frames(30, 20)
	var game: Node = runner.scene()
	assert_object(game.current).override_failure_message("the game didn't start").is_not_null()
	assert_str(game.level.error).is_empty()
	assert_int(game.current.tick).is_greater(0)
	assert_object(game.get_node_or_null("Level")).is_not_null()
	# With no input, the player settles onto the floor at the map's player start.
	assert_bool(game.current.player.on_ground).is_true()
	assert_float(game.current.player.origin.x).is_equal(game.level.player_start_origin.x)
	assert_int(Engine.physics_ticks_per_second).is_equal(SimConstants.TICK_RATE)
