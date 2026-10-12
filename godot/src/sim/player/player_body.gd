class_name PlayerBody
extends RefCounted
## The player's physical state between ticks. Treat as immutable: movement returns a new body.

var origin: Vec3
var velocity: Vec3
var on_ground := false
## Jump was held last tick; a new jump needs a release first.
var jump_held := false


func _init(body_origin: Vec3 = Vec3.zero(), body_velocity: Vec3 = Vec3.zero(), body_on_ground := false, body_jump_held := false) -> void:
	origin = body_origin
	velocity = body_velocity
	on_ground = body_on_ground
	jump_held = body_jump_held
