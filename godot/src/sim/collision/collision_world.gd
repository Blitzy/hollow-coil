class_name CollisionWorld
extends RefCounted
## Everything a box can collide with: the world's brushes. .map brushes now, .bsp brushes later.

var brushes: Array[Brush] = []


func _init(world_brushes: Array[Brush] = []) -> void:
	brushes = world_brushes
