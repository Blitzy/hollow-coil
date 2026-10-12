class_name BrushFace
extends RefCounted
## A visible brush face: its plane, its polygon on that plane, and the .map face it came from.

var plane: CollisionPlane
var winding: Array[Vec3]
var source: MapFace


func _init(face_plane: CollisionPlane, face_winding: Array[Vec3], face_source: MapFace) -> void:
	plane = face_plane
	winding = face_winding
	source = face_source
