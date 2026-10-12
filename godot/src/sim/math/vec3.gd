class_name Vec3
extends RefCounted
## An immutable 3D vector with 64-bit components, for the sim.
##
## Godot's Vector3 is 32-bit in official builds. The sim uses this instead so
## its math matches the web build's 64-bit numbers. Treat instances as
## immutable: every operation returns a new vector.

var x: float
var y: float
var z: float


func _init(px: float = 0.0, py: float = 0.0, pz: float = 0.0) -> void:
	x = px
	y = py
	z = pz


static func of(px: float, py: float, pz: float) -> Vec3:
	return Vec3.new(px, py, pz)


static func zero() -> Vec3:
	return Vec3.new()


## The unit vector along an axis (0, 1, 2) in a direction (-1 or +1).
static func axial(axis: int, dir: float) -> Vec3:
	return Vec3.new(dir if axis == 0 else 0.0, dir if axis == 1 else 0.0, dir if axis == 2 else 0.0)


func add(o: Vec3) -> Vec3:
	return Vec3.new(x + o.x, y + o.y, z + o.z)


func sub(o: Vec3) -> Vec3:
	return Vec3.new(x - o.x, y - o.y, z - o.z)


func scaled(s: float) -> Vec3:
	return Vec3.new(x * s, y * s, z * s)


## self + o * s
func add_scaled(o: Vec3, s: float) -> Vec3:
	return Vec3.new(x + o.x * s, y + o.y * s, z + o.z * s)


func dot(o: Vec3) -> float:
	return x * o.x + y * o.y + z * o.z


func cross(o: Vec3) -> Vec3:
	return Vec3.new(y * o.z - z * o.y, z * o.x - x * o.z, x * o.y - y * o.x)


func length() -> float:
	return sqrt(dot(self))


## Unit vector in the same direction, or zero if this has no length.
func normalized() -> Vec3:
	var len := length()
	return scaled(1.0 / len) if len > 0.0 else Vec3.new()


func component(axis: int) -> float:
	return x if axis == 0 else (y if axis == 1 else z)


func equals(o: Vec3) -> bool:
	return x == o.x and y == o.y and z == o.z


## For rendering only: Godot's 32-bit vector.
func to_vector3() -> Vector3:
	return Vector3(x, y, z)


func _to_string() -> String:
	return "(%s, %s, %s)" % [x, y, z]
