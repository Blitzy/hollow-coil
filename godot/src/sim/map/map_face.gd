class_name MapFace
extends RefCounted
## One face of a .map brush: three points defining its plane, plus texture and
## Quake 2 surface fields.

## How the face's texture is projected. (Not "Projection", which is a Godot built-in type.)
enum TextureFormat { VALVE, STANDARD }

## Three points on the face's plane, in .map order.
var points: Array[Vec3] = []
var texture := ""
var format := TextureFormat.STANDARD
## Valve 220 texture axes: x, y, z, offset. Empty for standard faces.
var u := PackedFloat64Array()
var v := PackedFloat64Array()
## Standard-format texture offset: s, t. Empty for Valve 220 faces.
var offset := PackedFloat64Array()
var rotation := 0.0
var scale := PackedFloat64Array([1.0, 1.0])
## Quake 2 contents bits from the face; 0 when absent.
var contents := 0
var surface_flags := 0
var value := 0
