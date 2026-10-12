extends GdUnitTestSuite
## Enforces the simulation rules from CLAUDE.md on src/sim: no scene tree or
## nodes, no wall clock, no Godot randomness, no files, input, or rendering, and
## no 32-bit Vector3 math. The Godot counterpart of web/tests/sim-purity.test.ts.

const SIM_DIR := "res://src/sim"

const FORBIDDEN := [
	["\\bextends\\s+Node", "extends Node (sim classes are plain RefCounted data)"],
	["\\b(get_tree|get_node|add_child|queue_free)\\b", "the scene tree"],
	["\\b(randi|randf|randi_range|randf_range|randfn|randomize|seed)\\s*\\(", "Godot's global random functions (use the sim's seeded RNG)"],
	["\\bRandomNumberGenerator\\b", "RandomNumberGenerator (use the sim's seeded RNG)"],
	["\\b(Time|OS|Engine)\\.", "Time, OS, and Engine (the sim has no wall clock or environment)"],
	["\\b(Input|InputEvent\\w*)\\b", "input devices (the sim reads only input commands)"],
	["\\b(FileAccess|DirAccess|ResourceLoader|ProjectSettings)\\b", "files and resources (callers load data for the sim)"],
	["\\b(RenderingServer|PhysicsServer[23]D|AudioServer|DisplayServer)\\b", "engine servers"],
	["\\b(load|preload)\\s*\\(", "loading resources"],
	["\\bVector3\\b", "Vector3, which is 32-bit (use Vec3)"],
]

## Lines allowed to break a rule: Vec3's one conversion to Vector3 for rendering.
const ALLOWED := ["func to_vector3() -> Vector3:", "return Vector3(x, y, z)"]


func _sim_sources(dir: String) -> PackedStringArray:
	var out := PackedStringArray()
	for name in DirAccess.get_files_at(dir):
		if name.ends_with(".gd"):
			out.append(dir.path_join(name))
	for sub in DirAccess.get_directories_at(dir):
		out.append_array(_sim_sources(dir.path_join(sub)))
	return out


## Source with comments and strings removed, line by line, minus allowed lines.
func _code_lines(path: String) -> PackedStringArray:
	var out := PackedStringArray()
	var strip := RegEx.create_from_string("\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'|#.*$")
	for line in FileAccess.get_file_as_string(path).split("\n"):
		if ALLOWED.any(func(allowed: String) -> bool: return line.strip_edges() == allowed):
			continue
		out.append(strip.sub(line, "", true))
	return out


func test_finds_sim_sources() -> void:
	assert_array(_sim_sources(SIM_DIR)).is_not_empty()


func test_sim_avoids_engine_apis() -> void:
	var rules: Array[RegEx] = []
	for rule: Array in FORBIDDEN:
		rules.append(RegEx.create_from_string(rule[0]))
	for path in _sim_sources(SIM_DIR):
		var lines := _code_lines(path)
		for i in lines.size():
			for r in rules.size():
				assert_object(rules[r].search(lines[i])) \
					.override_failure_message("%s:%d uses %s: %s" % [path, i + 1, FORBIDDEN[r][1], lines[i].strip_edges()]) \
					.is_null()


func _caught(line: String) -> bool:
	return FORBIDDEN.any(func(rule: Array) -> bool: return RegEx.create_from_string(rule[0]).search(line) != null)


func test_the_check_catches_violations() -> void:
	for line in ["var r := randf()", "randomize()", "var v := Vector3.ZERO", "var t := Time.get_ticks_msec()",
			"extends Node3D", "if Input.is_action_pressed(\"jump\"):", "var f := FileAccess.open(p, FileAccess.READ)",
			"var s := preload(\"res://x.gd\")", "get_tree().quit()"]:
		assert_bool(_caught(line)).override_failure_message("not caught: " + line).is_true()


func test_the_check_allows_sim_code() -> void:
	for line in ["var origin := Vec3.of(0, 0, 24)", "var seed_value := state.rng", "func step(state: SimState) -> void:",
			"var input_command := commands[tick]", "return brush.planes.size()"]:
		assert_bool(_caught(line)).override_failure_message("wrongly caught: " + line).is_false()
