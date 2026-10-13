class_name TextureAxes
extends RefCounted
## Texture coordinates for .map faces, matching how qbsp and TrenchBroom project
## textures. Valve 220 faces carry their axes; standard faces derive them from
## the face normal, then apply rotation. Adapted from ericw-tools qbsp/map.cc and
## Quake's TextureAxisFromPlane (GPLv2 or later). Ported from web/src/render/uv.ts.

## Texels per unit along each axis; already includes the face's scale.
var s: Vec3
var t: Vec3
var s_offset: float
var t_offset: float

# Quake's base axes: (normal, s axis, t axis), chosen by the face normal.
static var _base_axes: Array = [
	[Vec3.of(0, 0, 1), Vec3.of(1, 0, 0), Vec3.of(0, -1, 0)],
	[Vec3.of(0, 0, -1), Vec3.of(1, 0, 0), Vec3.of(0, -1, 0)],
	[Vec3.of(1, 0, 0), Vec3.of(0, 1, 0), Vec3.of(0, 0, -1)],
	[Vec3.of(-1, 0, 0), Vec3.of(0, 1, 0), Vec3.of(0, 0, -1)],
	[Vec3.of(0, 1, 0), Vec3.of(1, 0, 0), Vec3.of(0, 0, -1)],
	[Vec3.of(0, -1, 0), Vec3.of(1, 0, 0), Vec3.of(0, 0, -1)],
]


func _init(axis_s: Vec3, axis_t: Vec3, offset_s: float, offset_t: float) -> void:
	s = axis_s
	t = axis_t
	s_offset = offset_s
	t_offset = offset_t


static func _non_zero_axis(v: Vec3) -> int:
	return 0 if v.x != 0 else (1 if v.y != 0 else 2)


static func _with_component(v: Vec3, axis: int, value: float) -> Vec3:
	return Vec3.of(value if axis == 0 else v.x, value if axis == 1 else v.y, value if axis == 2 else v.z)


static func _standard(face: MapFace, normal: Vec3) -> TextureAxes:
	var best := 0
	var best_dot := 0.0
	for i in _base_axes.size():
		var d := normal.dot(_base_axes[i][0])
		if d > best_dot:
			best_dot = d
			best = i
	var s_axis: Vec3 = _base_axes[best][1]
	var t_axis: Vec3 = _base_axes[best][2]

	# Rotate both axes in their plane, with exact values for right angles.
	var r := face.rotation
	var sin_r: float
	var cos_r: float
	if r == 0:
		sin_r = 0; cos_r = 1
	elif r == 90:
		sin_r = 1; cos_r = 0
	elif r == 180:
		sin_r = 0; cos_r = -1
	elif r == 270:
		sin_r = -1; cos_r = 0
	else:
		sin_r = sin(deg_to_rad(r)); cos_r = cos(deg_to_rad(r))
	var sv := _non_zero_axis(s_axis)
	var tv := _non_zero_axis(t_axis)
	var rotate := func(v: Vec3) -> Vec3:
		var a := [v.x, v.y, v.z]
		return _with_component(_with_component(v, sv, cos_r * a[sv] - sin_r * a[tv]), tv, sin_r * a[sv] + cos_r * a[tv])
	s_axis = rotate.call(s_axis)
	t_axis = rotate.call(t_axis)

	var sx := face.scale[0] if face.scale[0] != 0 else 1.0
	var sy := face.scale[1] if face.scale[1] != 0 else 1.0
	return TextureAxes.new(s_axis.scaled(1.0 / sx), t_axis.scaled(1.0 / sy), face.offset[0], face.offset[1])


static func for_face(face: MapFace, normal: Vec3) -> TextureAxes:
	if face.format == MapFace.TextureFormat.STANDARD:
		return _standard(face, normal)
	var sx := face.scale[0] if face.scale[0] != 0 else 1.0
	var sy := face.scale[1] if face.scale[1] != 0 else 1.0
	return TextureAxes.new(
		Vec3.of(face.u[0] / sx, face.u[1] / sx, face.u[2] / sx),
		Vec3.of(face.v[0] / sy, face.v[1] / sy, face.v[2] / sy),
		face.u[3], face.v[3])


## Texture coordinates in texels for a point; divide by the texture size for
## UVs. t increases downward in the image, as Godot's UVs do.
func texel_coords(p: Vec3) -> Vector2:
	return Vector2(p.dot(s) + s_offset, p.dot(t) + t_offset)
