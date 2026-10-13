extends GdUnitTestSuite
## Runs every engine-neutral scenario in /spec against the Godot sim. The
## counterpart of web/tests/scenarios.test.ts. Expectations come from the
## scenario files and are never adjusted here (see spec/README.md, Status).

var _levels: Dictionary[String, Level] = {}


func _level(name: String) -> Level:
	if not _levels.has(name):
		_levels[name] = Level.from_map(ContentPaths.read_text("maps/%s.map" % name))
	return _levels[name]


func test_every_spec_scenario_passes() -> void:
	var spec_dir := ContentPaths.repo_root().path_join("spec")
	var files := Array(DirAccess.get_files_at(spec_dir)).filter(func(f: String) -> bool: return f.ends_with(".json"))
	assert_array(files).is_not_empty()
	var player := TestWorlds.player_data()
	for file: String in files:
		var scenario: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(spec_dir.path_join(file)))
		var level := _level(scenario["map"])
		assert_str(level.error).override_failure_message("%s: map %s: %s" % [file, scenario["map"], level.error]).is_empty()
		var result := Scenario.run(scenario, level, player)
		var report := PackedStringArray()
		if result.error != "":
			report.append(result.error)
		for check in result.checks:
			if not check.passed:
				report.append("at %ss (tick %d)%s:\n    %s" % [check.at, check.tick,
					" [%s]" % check.note if check.note != "" else "", "\n    ".join(check.failures)])
		assert_bool(result.passed) \
			.override_failure_message("%s (%s) failed:\n  %s" % [file, scenario["status"], "\n  ".join(report)]) \
			.is_true()
