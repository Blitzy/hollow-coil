class_name SimState
extends RefCounted
## The whole simulation state: plain data with stable entity ids. Treat as
## immutable: Sim.step returns a new state.
##
## to_dict() gives the same shape and key names as the web build's state, so a
## snapshot reads the same in both engines and equal states hash equally.

const PLAYER_ID := 1


class PlayerState:
	var id := PLAYER_ID
	var origin := Vec3.zero()
	var velocity := Vec3.zero()
	var on_ground := false
	var jump_held := false
	## View angles from the latest command, in angle units.
	var yaw := 0
	var pitch := 0
	var health := 0

	func body() -> PlayerBody:
		return PlayerBody.new(origin, velocity, on_ground, jump_held)

	func to_dict() -> Dictionary:
		return {
			"id": id,
			"origin": SimState._vec_dict(origin),
			"velocity": SimState._vec_dict(velocity),
			"onGround": on_ground,
			"jumpHeld": jump_held,
			"yaw": yaw,
			"pitch": pitch,
			"health": health,
		}

	static func from_dict(d: Dictionary) -> PlayerState:
		var p := PlayerState.new()
		p.id = int(d["id"])
		p.origin = SimState._dict_vec(d["origin"])
		p.velocity = SimState._dict_vec(d["velocity"])
		p.on_ground = bool(d["onGround"])
		p.jump_held = bool(d["jumpHeld"])
		p.yaw = int(d["yaw"])
		p.pitch = int(d["pitch"])
		p.health = int(d["health"])
		return p


## Ticks simulated so far.
var tick := 0
## The seeded RNG's state (see SimRandom).
var rng := 0
## Next id to hand out; ids are never reused.
var next_entity_id := PLAYER_ID + 1
var player := PlayerState.new()


func to_dict() -> Dictionary:
	return {"tick": tick, "rng": rng, "nextEntityId": next_entity_id, "player": player.to_dict()}


static func from_dict(d: Dictionary) -> SimState:
	var s := SimState.new()
	s.tick = int(d["tick"])
	s.rng = int(d["rng"])
	s.next_entity_id = int(d["nextEntityId"])
	s.player = PlayerState.from_dict(d["player"])
	return s


static func _vec_dict(v: Vec3) -> Dictionary:
	return {"x": v.x, "y": v.y, "z": v.z}


static func _dict_vec(d: Dictionary) -> Vec3:
	return Vec3.of(d["x"], d["y"], d["z"])
