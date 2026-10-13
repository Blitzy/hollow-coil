class_name Scenario
## Runs the engine-neutral scenarios in /spec, following the conversion rules
## in spec/README.md. The caller loads the scenario JSON (as a Dictionary), the
## level, and the data. Ported from web/src/sim/scenario.ts.


class Check:
	var at: float
	var tick: int
	var note: String
	var passed: bool
	## One line per failed check, with the expected and actual values.
	var failures: PackedStringArray = []


class Result:
	var passed := true
	var checks: Array[Check] = []
	## State after every tick, starting with the spawn state (index = tick).
	var states: Array[SimState] = []
	## Set when the scenario can't run at all (such as a missing marker).
	var error := ""


static func _yaw_units(degrees: float) -> int:
	return InputCommand.wrap_yaw(InputCommand.degrees_to_units(degrees))


## The input command for every tick of the scenario, by the segment rules in spec/README.md.
static func commands(scenario: Dictionary, tick_rate := SimConstants.TICK_RATE) -> Array[InputCommand]:
	var total := SimConstants.seconds_to_ticks(scenario["duration"], tick_rate)
	var start: Dictionary = scenario["start"]
	var yaw := _yaw_units(start["yaw"])
	var pitch := InputCommand.degrees_to_units(start.get("pitch", 0.0))
	var out: Array[InputCommand] = []
	for segment: Dictionary in scenario["inputs"]:
		if segment.has("yaw"):
			yaw = _yaw_units(segment["yaw"])
		if segment.has("pitch"):
			pitch = InputCommand.degrees_to_units(segment["pitch"])
		var buttons := (InputCommand.BUTTON_JUMP if segment.get("jump", false) else 0) \
			| (InputCommand.BUTTON_ATTACK if segment.get("attack", false) else 0)
		var cmd := InputCommand.make(int(segment.get("forward", 0)), int(segment.get("side", 0)), buttons, yaw, pitch,
			int(segment.get("weapon", 0)))
		var end := mini(SimConstants.seconds_to_ticks(segment["until"], tick_rate), total)
		while out.size() < end:
			out.append(cmd)
	while out.size() < total:
		out.append(InputCommand.make(0, 0, 0, yaw, pitch))
	return out


static func _compare(label: String, expected: Array, actual: Vec3, tolerance: float, failures: PackedStringArray) -> void:
	for i in 3:
		if expected[i] == null:
			continue
		var want := float(expected[i])
		var got := actual.component(i)
		if absf(got - want) > tolerance:
			failures.append("%s.%s: expected %s ± %s, got %.3f" % [label, "xyz"[i], want, tolerance, got])


static func run(scenario: Dictionary, level: Level, player: PlayerData) -> Result:
	var result := Result.new()
	var start: Dictionary = scenario["start"]
	var marker: Vec3 = level.markers.get(start["marker"])
	if marker == null:
		result.passed = false
		result.error = 'marker "%s" not found in %s' % [start["marker"], scenario["map"]]
		return result

	var ctx := Sim.movement_context(level, player)
	result.states.append(Sim.create(player, marker, _yaw_units(start["yaw"]),
		InputCommand.degrees_to_units(start.get("pitch", 0.0)), int(scenario.get("seed", 0))))
	for cmd in commands(scenario):
		result.states.append(Sim.step(result.states.back(), cmd, ctx).state)

	for e: Dictionary in scenario["expect"]:
		var check := Check.new()
		check.at = e["at"]
		check.tick = SimConstants.seconds_to_ticks(e["at"])
		check.note = e.get("note", "")
		var p := result.states[check.tick].player
		var tolerance := float(e.get("tolerance", 0.0))
		if e.has("position"):
			_compare("position", e["position"], p.origin, tolerance, check.failures)
		if e.has("velocity"):
			_compare("velocity", e["velocity"], p.velocity, tolerance, check.failures)
		if e.has("on_ground") and p.on_ground != e["on_ground"]:
			check.failures.append("on_ground: expected %s, got %s" % [e["on_ground"], p.on_ground])
		if e.has("near_marker"):
			var near: Dictionary = e["near_marker"]
			var target: Vec3 = level.markers.get(near["name"])
			if target == null:
				check.failures.append('near_marker: marker "%s" not found in %s' % [near["name"], scenario["map"]])
			else:
				var distance := p.origin.sub(target).length()
				if distance > float(near["within"]):
					check.failures.append("near_marker %s: expected within %s, got %.1f" % [near["name"], near["within"], distance])
		check.passed = check.failures.is_empty()
		result.passed = result.passed and check.passed
		result.checks.append(check)
	return result
