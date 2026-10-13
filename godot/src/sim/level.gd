class_name Level
extends RefCounted
## Static level data built from a map: the collision world, named markers, and
## the player start. Levels don't change during play, so they aren't part of
## the sim state or its snapshots. Ported from web/src/sim/level.ts.

var world: CollisionWorld
## World brushes with face windings, for rendering.
var brushes: Array[Brush] = []
var entities: Array[MapEntity] = []
## info_marker origins by name.
var markers: Dictionary[String, Vec3] = {}
## The first info_player_start's origin, or null if the map has none.
var player_start_origin: Vec3 = null
## Its facing, in degrees.
var player_start_angle := 0.0
## Why the level couldn't be built, or "" if it was.
var error := ""


static func _parse_origin(text: String) -> Vec3:
	var parts := text.replace("\t", " ").split_floats(" ", false)
	return Vec3.of(parts[0] if parts.size() > 0 else 0.0, parts[1] if parts.size() > 1 else 0.0, parts[2] if parts.size() > 2 else 0.0)


## Builds a level from .map text. Check error: when it isn't empty, the level is unusable.
static func from_map(text: String) -> Level:
	var level := Level.new()
	var parsed := MapParser.parse_map(text)
	if not parsed.ok():
		level.error = parsed.error
		return level
	level.entities = parsed.entities
	if level.entities.is_empty() or level.entities[0].properties.get("classname", "") != "worldspawn":
		level.error = "the first entity must be worldspawn"
		return level

	var worldspawn := level.entities[0]
	for i in worldspawn.brushes.size():
		var faces: Array[MapFace] = []
		faces.assign(worldspawn.brushes[i])
		var brush := Brush.build(faces)
		if brush == null:
			level.error = "world brush %d does not enclose a volume" % i
			return level
		level.brushes.append(brush)
	level.world = CollisionWorld.new(level.brushes)

	for entity in level.entities:
		var p := entity.properties
		var classname: String = p.get("classname", "")
		if classname == "info_marker" and p.has("name"):
			level.markers[p["name"]] = _parse_origin(p.get("origin", "0 0 0"))
		if classname == "info_player_start" and level.player_start_origin == null:
			level.player_start_origin = _parse_origin(p.get("origin", "0 0 0"))
			level.player_start_angle = float(p.get("angle", "0"))
	return level
