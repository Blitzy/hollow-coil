extends Node3D
## Loads a map, runs the sim at its fixed tick rate, and renders between ticks.
## The Godot counterpart of web/src/main.ts.
##
## The sim steps in _physics_process, with Godot's physics rate set from
## SimConstants.TICK_RATE; _process interpolates the camera between the last two
## ticks. Pick the map with map_name in the inspector, or run with
## `-- --map=<name>` on the command line.

const HORIZONTAL_FOV := 90.0
## A mouse movement larger than this, in pixels, in one event is logged as a likely glitch.
const SUSPICIOUS_MOVEMENT := 300.0

const KEYS := {
	"forward": [KEY_W, KEY_UP],
	"back": [KEY_S, KEY_DOWN],
	"left": [KEY_A],
	"right": [KEY_D],
	"jump": [KEY_SPACE],
}

## maps/<map_name>.map, unless the command line says --map=<name>.
@export var map_name := "test_movement"
## Radians of turn per pixel of mouse movement.
@export var sensitivity := 0.0033

## The current sim state and the one before it, for interpolation.
var current: SimState
var previous: SimState
var level: Level

var _player: PlayerData
var _ctx: PlayerMovement.Context
var _yaw := 0.0
var _pitch := 0.0
var _pending_weapon := 0
var _camera: Camera3D
var _overlay: Label
var _error := ""


func _ready() -> void:
	Engine.physics_ticks_per_second = SimConstants.TICK_RATE
	_overlay = _make_overlay()
	_camera = Camera3D.new()
	_camera.keep_aspect = Camera3D.KEEP_WIDTH # fov below is horizontal, as in Quake
	_camera.fov = HORIZONTAL_FOV
	_camera.near = 1.0
	_camera.far = 8192.0
	add_child(_camera)
	var environment := WorldEnvironment.new()
	environment.environment = Environment.new()
	environment.environment.background_mode = Environment.BG_COLOR
	environment.environment.background_color = Color8(0x10, 0x10, 0x14)
	add_child(environment)

	var chosen := _map_from_command_line()
	var map_text := ContentPaths.read_text("maps/%s.map" % chosen)
	var player_text := ContentPaths.read_text("data/player.json")
	if map_text == "" or player_text == "":
		_error = "can't find maps/%s.map or data/player.json" % chosen
		return
	level = Level.from_map(map_text)
	if level.error != "":
		_error = "%s: %s" % [chosen, level.error]
		return
	map_name = chosen
	_player = PlayerData.from_dict(JSON.parse_string(player_text))
	_ctx = Sim.movement_context(level, _player)
	add_child(LevelMesh.build(level, LevelMesh.load_textures(LevelMesh.texture_names(level))))

	var origin := level.player_start_origin if level.player_start_origin != null else Vec3.of(0, 0, 24)
	var start_yaw := InputCommand.wrap_yaw(InputCommand.degrees_to_units(level.player_start_angle))
	_yaw = InputCommand.angle_to_radians(start_yaw)
	current = Sim.create(_player, origin, start_yaw)
	previous = current


func _map_from_command_line() -> String:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--map="):
			return arg.trim_prefix("--map=")
	return map_name


func _unhandled_input(event: InputEvent) -> void:
	var captured := Input.mouse_mode == Input.MOUSE_MODE_CAPTURED
	if event is InputEventMouseButton and event.pressed and not captured:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif event is InputEventKey and event.pressed and event.physical_keycode == KEY_ESCAPE:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	elif event is InputEventKey and event.pressed and event.physical_keycode >= KEY_1 and event.physical_keycode <= KEY_9:
		_pending_weapon = event.physical_keycode - KEY_0
	elif event is InputEventMouseMotion and captured:
		var motion: Vector2 = event.screen_relative # unscaled by window stretch, so sensitivity doesn't depend on window size
		if absf(motion.x) > SUSPICIOUS_MOVEMENT or absf(motion.y) > SUSPICIOUS_MOVEMENT:
			push_warning("large mouse movement in one event: %s" % motion)
		_yaw -= motion.x * sensitivity # moving right turns clockwise, toward lower yaw
		_pitch = clampf(_pitch - motion.y * sensitivity, -CommandBuilder.MAX_PITCH, CommandBuilder.MAX_PITCH)


func _held(action: String) -> bool:
	for key: Key in KEYS[action]:
		if Input.is_physical_key_pressed(key):
			return true
	return false


func _read_input() -> CommandBuilder.HeldInput:
	var input := CommandBuilder.HeldInput.new()
	input.yaw = _yaw
	input.pitch = _pitch
	if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		input.forward = _held("forward")
		input.back = _held("back")
		input.left = _held("left")
		input.right = _held("right")
		input.jump = _held("jump")
		input.attack = Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT)
	input.weapon = _pending_weapon # a weapon press is consumed by the first tick that reads it
	_pending_weapon = 0
	return input


func _physics_process(_delta: float) -> void:
	if current == null:
		return
	previous = current
	current = Sim.step(current, CommandBuilder.build(_read_input()), _ctx).state


func _process(_delta: float) -> void:
	if current == null:
		_overlay.text = "failed to start: %s" % _error
		return
	# Interpolate position between the last two ticks; view angles come straight from the mouse for low latency.
	var t := Engine.get_physics_interpolation_fraction()
	var a := previous.player.origin
	var b := current.player.origin
	var eye := Vec3.of(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t + _player.eye_height)
	_camera.position = QuakeCoords.to_godot(eye)
	_camera.rotation = QuakeCoords.camera_rotation(_yaw, _pitch)

	var p := current.player
	_overlay.text = "\n".join([
		"%s  %d fps  tick %d" % [map_name, Engine.get_frames_per_second(), current.tick],
		"pos %.1f %.1f %.1f" % [p.origin.x, p.origin.y, p.origin.z],
		"speed %.0f  %s" % [sqrt(p.velocity.x ** 2 + p.velocity.y ** 2), "ground" if p.on_ground else "air"],
		"" if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED else "click to play  (WASD, mouse, space; Esc frees the mouse)",
	])


func _make_overlay() -> Label:
	var layer := CanvasLayer.new()
	add_child(layer)
	var label := Label.new()
	label.position = Vector2(8, 8)
	label.add_theme_color_override("font_shadow_color", Color.BLACK)
	label.add_theme_constant_override("shadow_offset_x", 1)
	label.add_theme_constant_override("shadow_offset_y", 1)
	label.add_theme_font_size_override("font_size", 13)
	layer.add_child(label)
	return label
