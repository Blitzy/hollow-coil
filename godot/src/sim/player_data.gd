class_name PlayerData
extends RefCounted
## data/player.json as the sim uses it. The caller loads and parses the JSON
## (validated by tools/validate.py) and passes it in; the sim never reads files
## itself. Ported from web/src/sim/data.ts.


## Quake-style movement constants, from player.json's "movement".
class Movement:
	var max_ground_speed: float
	var ground_accelerate: float
	var friction: float
	var edge_friction: float
	var stop_speed: float
	var air_accelerate: float
	var air_wish_speed_cap: float
	var gravity: float
	var jump_velocity: float
	var step_height: float


var health: int
var hull_mins: Vec3
var hull_maxs: Vec3
var eye_height: float
var weapons: PackedStringArray
var starting_weapon: String
var movement := Movement.new()


## Builds player data from parsed player.json.
static func from_dict(data: Dictionary) -> PlayerData:
	var player := PlayerData.new()
	player.health = int(data["health"])
	player.hull_mins = _vec3(data["hull"]["mins"])
	player.hull_maxs = _vec3(data["hull"]["maxs"])
	player.eye_height = float(data["eye_height"])
	player.weapons = PackedStringArray(data["weapons"])
	player.starting_weapon = String(data["starting_weapon"])
	var m: Dictionary = data["movement"]
	for key: String in ["max_ground_speed", "ground_accelerate", "friction", "edge_friction", "stop_speed",
			"air_accelerate", "air_wish_speed_cap", "gravity", "jump_velocity", "step_height"]:
		player.movement.set(key, float(m[key]))
	return player


static func _vec3(values: Array) -> Vec3:
	return Vec3.of(values[0], values[1], values[2])
