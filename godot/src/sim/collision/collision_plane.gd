class_name CollisionPlane
extends RefCounted
## A plane with a unit normal pointing out of the brush. Points with
## dot(p, normal) - dist > 0 are in front (outside). Named to avoid Godot's
## built-in 32-bit Plane. Ported from web/src/sim/collision/plane.ts.

var normal: Vec3
var dist: float


func _init(plane_normal: Vec3, plane_dist: float) -> void:
	normal = plane_normal
	dist = plane_dist


## The plane through three .map face points, or null if they are collinear.
## Adapted from ericw-tools qbsp/map.cc mapface_t::set_planepts (GPLv2 or later).
static func from_points(p0: Vec3, p1: Vec3, p2: Vec3) -> CollisionPlane:
	var n := p0.sub(p1).cross(p2.sub(p1))
	var len := n.length()
	if len < 1e-6:
		return null
	var unit := n.scaled(1.0 / len)
	return CollisionPlane.new(unit, p1.dot(unit))


func distance_to(p: Vec3) -> float:
	return p.dot(normal) - dist
