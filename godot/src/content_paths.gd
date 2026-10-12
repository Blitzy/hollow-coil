class_name ContentPaths
## Finds game files (maps/, textures/, data/) across content directories:
## first any listed in the HOLLOWCOIL_CONTENT environment variable (separated
## like PATH), then the repo root, which holds the free base content. Keeps a
## private content repo possible (docs/DECISIONS.md, "Keep a commercial option
## open"). Not sim code: the sim never touches files.

const ENV_VAR := "HOLLOWCOIL_CONTENT"


## The repo root: the folder above this Godot project.
static func repo_root() -> String:
	return ProjectSettings.globalize_path("res://").path_join("..").simplify_path()


## Content directories in search order.
static func roots() -> PackedStringArray:
	var out := PackedStringArray()
	var separator := ";" if OS.get_name() == "Windows" else ":"
	for entry in OS.get_environment(ENV_VAR).split(separator, false):
		out.append(entry.strip_edges().simplify_path())
	out.append(repo_root())
	return out


## Absolute path of the first match for a relative path such as
## "maps/test_movement.map", or "" if no content directory has it.
static func find(relative: String) -> String:
	for root in roots():
		var path := root.path_join(relative)
		if FileAccess.file_exists(path):
			return path
	return ""


## A file's text from the first content directory that has it, or "" if none does.
static func read_text(relative: String) -> String:
	var path := find(relative)
	return FileAccess.get_file_as_string(path) if path != "" else ""
