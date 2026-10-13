class_name LevelMesh
## A level's world brushes as a Godot mesh: one surface per texture. Faces get a
## flat shade by direction so shapes read clearly, until baked lightmaps arrive
## in M2. Ported from web/src/render/level-mesh.ts.
##
## Godot treats clockwise triangles as front faces (Three.js uses counterclockwise),
## so the winding test is the web version's, flipped.


## One texture's triangles, in Godot coordinates.
class Surface:
	var positions := PackedVector3Array()
	var uvs := PackedVector2Array()
	var colors := PackedColorArray()


## Brightness by face direction: floors brightest, ceilings darkest, walls in between.
static func face_shade(n: Vec3) -> float:
	return 0.7 + 0.2 * n.z + 0.08 * absf(n.x)


## Texture names used by the level's brushes, sorted.
static func texture_names(level: Level) -> PackedStringArray:
	var names := {}
	for brush in level.brushes:
		for face in brush.faces:
			names[face.source.texture] = true
	var out := PackedStringArray(names.keys())
	out.sort()
	return out


## Triangles for every brush face, by texture. texture_size(name) -> Vector2i gives each texture's size in pixels.
static func surfaces(level: Level, texture_size: Callable) -> Dictionary[String, Surface]:
	var out: Dictionary[String, Surface] = {}
	for brush in level.brushes:
		for face in brush.faces:
			var name := face.source.texture
			if not out.has(name):
				out[name] = Surface.new()
			var surface := out[name]
			var size: Vector2i = texture_size.call(name)
			var axes := TextureAxes.for_face(face.source, face.plane.normal)
			var shade := face_shade(face.plane.normal)
			var color := Color(shade, shade, shade)

			# Fan-triangulate, wound clockwise as seen from the front (Godot's front face).
			var w := face.winding.duplicate()
			if w.size() >= 3 and w[1].sub(w[0]).cross(w[2].sub(w[0])).dot(face.plane.normal) > 0:
				w.reverse()
			for i in range(1, w.size() - 1):
				for p: Vec3 in [w[0], w[i], w[i + 1]]:
					surface.positions.append(QuakeCoords.to_godot(p))
					var texel := axes.texel_coords(p)
					surface.uvs.append(Vector2(texel.x / size.x, texel.y / size.y))
					surface.colors.append(color)
	return out


## A mesh instance for the level, with unshaded, pixelated materials.
static func build(level: Level, textures: Dictionary[String, Texture2D]) -> MeshInstance3D:
	var size_of := func(name: String) -> Vector2i:
		var texture: Texture2D = textures.get(name)
		return Vector2i(texture.get_width(), texture.get_height()) if texture else Vector2i(64, 64)
	var mesh := ArrayMesh.new()
	var by_texture := surfaces(level, size_of)
	for name in by_texture:
		var surface := by_texture[name]
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = surface.positions
		arrays[Mesh.ARRAY_TEX_UV] = surface.uvs
		arrays[Mesh.ARRAY_COLOR] = surface.colors
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		var material := StandardMaterial3D.new()
		material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		material.vertex_color_use_as_albedo = true
		material.albedo_texture = textures.get(name)
		material.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST_WITH_MIPMAPS
		mesh.surface_set_material(mesh.get_surface_count() - 1, material)
		mesh.surface_set_name(mesh.get_surface_count() - 1, name)
	var instance := MeshInstance3D.new()
	instance.name = "Level"
	instance.mesh = mesh
	return instance


## Loads each texture from textures/<name>.png in the content directories, or a
## magenta and black checkerboard if it's missing.
static func load_textures(names: PackedStringArray) -> Dictionary[String, Texture2D]:
	var out: Dictionary[String, Texture2D] = {}
	for name in names:
		var path := ContentPaths.find("textures/%s.png" % name)
		var image := Image.load_from_file(path) if path != "" else null
		if image == null:
			push_warning("missing texture: %s" % name)
			image = _missing_image()
		image.generate_mipmaps()
		out[name] = ImageTexture.create_from_image(image)
	return out


static func _missing_image() -> Image:
	var image := Image.create(2, 2, false, Image.FORMAT_RGBA8)
	var magenta := Color(1, 0, 1)
	image.set_pixel(0, 0, magenta)
	image.set_pixel(1, 1, magenta)
	image.set_pixel(1, 0, Color.BLACK)
	image.set_pixel(0, 1, Color.BLACK)
	return image
