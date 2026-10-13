class_name QuakeCoords
## Quake is Z-up; Godot is Y-up. Everything crosses between them here.
## The mapping (x, y, z) -> (x, z, -y) is a rotation, so triangle winding is
## preserved. Ported from web/src/render/coords.ts (Godot and Three.js share axes).


static func to_godot(v: Vec3) -> Vector3:
	return Vector3(v.x, v.z, -v.y)


## Camera Euler angles (Godot's default order, YXZ) for a Quake view direction in
## radians. A Godot camera looks down -Z, which is Quake's +y (yaw 90 degrees),
## so yaw is offset by a quarter turn.
static func camera_rotation(yaw: float, pitch: float) -> Vector3:
	return Vector3(pitch, yaw - PI / 2, 0)
